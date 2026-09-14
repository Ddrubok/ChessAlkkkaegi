-- Apply after the base profiles/match_history schema and 20260901_referral_system.sql.
BEGIN;

-- Preserve existing mode ratings; migrate legacy classic ratings only when adding a column.
DO $$
DECLARE column_definition record;
BEGIN
  FOR column_definition IN SELECT * FROM (VALUES
    ('classic_mmr', 'mmr', 1200), ('classic_wins', 'wins', 0),
    ('classic_losses', 'losses', 0), ('classic_draws', 'draws', 0),
    ('strategy_mmr', NULL, 1200), ('strategy_wins', NULL, 0),
    ('strategy_losses', NULL, 0), ('strategy_draws', NULL, 0)
  ) AS columns(name, legacy, initial)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass
      AND attname = column_definition.name AND NOT attisdropped) THEN
      EXECUTE format('ALTER TABLE public.profiles ADD COLUMN %I integer NOT NULL DEFAULT %s', column_definition.name, column_definition.initial);
      IF column_definition.legacy IS NOT NULL THEN
        EXECUTE format('UPDATE public.profiles SET %I = coalesce(%I, %s)', column_definition.name, column_definition.legacy, column_definition.initial);
      END IF;
    END IF;
    EXECUTE format('UPDATE public.profiles SET %I = %s WHERE %I IS NULL', column_definition.name, column_definition.initial, column_definition.name);
    EXECUTE format('ALTER TABLE public.profiles ALTER COLUMN %I SET DEFAULT %s, ALTER COLUMN %I SET NOT NULL', column_definition.name, column_definition.initial, column_definition.name);
  END LOOP;
END $$;

-- Scores and rewards are server-owned. Remove table AND prior column grants.
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
DO $$
DECLARE columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ') INTO columns
  FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.profiles FROM PUBLIC, anon, authenticated', columns, columns);
END $$;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT (id, nickname, referral_code) ON public.profiles TO authenticated;
GRANT UPDATE (id, nickname, referral_code, updated_at) ON public.profiles TO authenticated;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Older clients must fail closed instead of bypassing the new result protocol.
DO $$
DECLARE routine regprocedure;
BEGIN
  FOR routine IN SELECT p.oid::regprocedure FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'finish_match'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', routine);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.match_settlements (
  match_id text PRIMARY KEY CHECK (length(match_id) BETWEEN 1 AND 200),
  mode text NOT NULL CHECK (mode IN ('classic', 'strategy')),
  white_id uuid NOT NULL REFERENCES public.profiles(id),
  black_id uuid NOT NULL REFERENCES public.profiles(id),
  winner_id uuid REFERENCES public.profiles(id),
  white_confirmed boolean NOT NULL DEFAULT false,
  black_confirmed boolean NOT NULL DEFAULT false,
  white_delta integer NOT NULL DEFAULT 0,
  black_delta integer NOT NULL DEFAULT 0,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (white_id <> black_id),
  CHECK (winner_id IS NULL OR winner_id IN (white_id, black_id))
);
ALTER TABLE public.match_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.match_settlements TO authenticated;
DROP POLICY IF EXISTS "Participants read settlements" ON public.match_settlements;
CREATE POLICY "Participants read settlements" ON public.match_settlements
  FOR SELECT TO authenticated USING (auth.uid() IN (white_id, black_id));

ALTER TABLE public.match_history ADD COLUMN IF NOT EXISTS match_id text;
ALTER TABLE public.match_history ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'classic';
CREATE UNIQUE INDEX IF NOT EXISTS match_history_match_id_unique ON public.match_history(match_id);
REVOKE INSERT, UPDATE, DELETE ON public.match_history FROM PUBLIC, anon, authenticated;

-- ponytail: P2P outcomes require both authenticated players to agree. A trusted
-- game server is needed to adjudicate disconnects/disputes or prevent collusion.
CREATE OR REPLACE FUNCTION public.finish_match_v2(
  p_match_id text, p_mode text, p_white_id uuid, p_black_id uuid, p_winner_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  receipt public.match_settlements%ROWTYPE;
  white_rating integer;
  black_rating integer;
  delta integer;
  white_change integer;
  black_change integer;
  score numeric;
BEGIN
  IF caller IS NULL OR p_white_id IS NULL OR p_black_id IS NULL
    OR caller NOT IN (p_white_id, p_black_id) OR p_white_id = p_black_id THEN
    RAISE EXCEPTION 'Only distinct match participants may report a result' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL OR length(p_match_id) NOT BETWEEN 1 AND 200
    OR p_mode IS NULL OR p_mode NOT IN ('classic', 'strategy')
    OR (p_winner_id IS NOT NULL AND p_winner_id NOT IN (p_white_id, p_black_id)) THEN
    RAISE EXCEPTION 'Invalid match result' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.match_settlements(match_id, mode, white_id, black_id, winner_id)
    VALUES (p_match_id, p_mode, p_white_id, p_black_id, p_winner_id)
    ON CONFLICT (match_id) DO NOTHING;
  SELECT * INTO STRICT receipt FROM public.match_settlements WHERE match_id = p_match_id FOR UPDATE;
  IF receipt.mode <> p_mode OR receipt.white_id <> p_white_id OR receipt.black_id <> p_black_id
    OR receipt.winner_id IS DISTINCT FROM p_winner_id THEN
    RAISE EXCEPTION 'Conflicting match result' USING ERRCODE = '22023';
  END IF;
  IF receipt.settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'settled', 'white_delta', receipt.white_delta, 'black_delta', receipt.black_delta);
  END IF;
  UPDATE public.match_settlements SET
    white_confirmed = white_confirmed OR caller = white_id,
    black_confirmed = black_confirmed OR caller = black_id
    WHERE match_id = p_match_id RETURNING * INTO receipt;
  IF NOT (receipt.white_confirmed AND receipt.black_confirmed) THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  -- Lock both profiles in stable order, including when separate games finish together.
  PERFORM id FROM public.profiles WHERE id IN (p_white_id, p_black_id) ORDER BY id FOR UPDATE;
  SELECT CASE WHEN p_mode = 'strategy' THEN strategy_mmr ELSE classic_mmr END
    INTO STRICT white_rating FROM public.profiles WHERE id = p_white_id;
  SELECT CASE WHEN p_mode = 'strategy' THEN strategy_mmr ELSE classic_mmr END
    INTO STRICT black_rating FROM public.profiles WHERE id = p_black_id;
  score := CASE WHEN p_winner_id IS NULL THEN 0.5 WHEN p_winner_id = p_white_id THEN 1 ELSE 0 END;
  delta := round(32 * (score - 1 / (1 + power(10::numeric, (black_rating - white_rating)::numeric / 400))));
  white_change := greatest(100, white_rating + delta) - white_rating;
  black_change := greatest(100, black_rating - delta) - black_rating;

  UPDATE public.profiles SET
    classic_mmr = classic_mmr + CASE WHEN p_mode = 'classic' THEN CASE WHEN id = p_white_id THEN white_change ELSE black_change END ELSE 0 END,
    strategy_mmr = strategy_mmr + CASE WHEN p_mode = 'strategy' THEN CASE WHEN id = p_white_id THEN white_change ELSE black_change END ELSE 0 END,
    mmr = CASE WHEN p_mode = 'classic' THEN classic_mmr + CASE WHEN id = p_white_id THEN white_change ELSE black_change END ELSE mmr END,
    wins = coalesce(wins, 0) + CASE WHEN id = p_winner_id THEN 1 ELSE 0 END,
    losses = coalesce(losses, 0) + CASE WHEN p_winner_id IS NOT NULL AND id <> p_winner_id THEN 1 ELSE 0 END,
    draws = coalesce(draws, 0) + CASE WHEN p_winner_id IS NULL THEN 1 ELSE 0 END,
    classic_wins = classic_wins + CASE WHEN p_mode = 'classic' AND id = p_winner_id THEN 1 ELSE 0 END,
    classic_losses = classic_losses + CASE WHEN p_mode = 'classic' AND p_winner_id IS NOT NULL AND id <> p_winner_id THEN 1 ELSE 0 END,
    classic_draws = classic_draws + CASE WHEN p_mode = 'classic' AND p_winner_id IS NULL THEN 1 ELSE 0 END,
    strategy_wins = strategy_wins + CASE WHEN p_mode = 'strategy' AND id = p_winner_id THEN 1 ELSE 0 END,
    strategy_losses = strategy_losses + CASE WHEN p_mode = 'strategy' AND p_winner_id IS NOT NULL AND id <> p_winner_id THEN 1 ELSE 0 END,
    strategy_draws = strategy_draws + CASE WHEN p_mode = 'strategy' AND p_winner_id IS NULL THEN 1 ELSE 0 END,
    updated_at = now()
    WHERE id IN (p_white_id, p_black_id);
  INSERT INTO public.match_history(match_id, mode, white_player_id, black_player_id, winner_id, white_mmr_change, black_mmr_change)
    VALUES (p_match_id, p_mode, p_white_id, p_black_id, p_winner_id, white_change, black_change);
  UPDATE public.match_settlements SET settled_at = now(), white_delta = white_change, black_delta = black_change
    WHERE match_id = p_match_id;
  RETURN jsonb_build_object('status', 'settled', 'white_delta', white_change, 'black_delta', black_change);
END $$;
REVOKE ALL ON FUNCTION public.finish_match_v2(text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match_v2(text, text, uuid, uuid, uuid) TO authenticated;

-- Keep the existing referral API, but derive eligibility from the authenticated
-- account and server timestamps instead of trusting p_is_new_user alone.
CREATE OR REPLACE FUNCTION public.claim_referral_reward(
  p_referee_id uuid, p_referrer_code varchar, p_is_new_user boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE referrer uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_referee_id THEN
    RAISE EXCEPTION 'Only the authenticated referee may claim' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(p_is_new_user, false) OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_referee_id AND created_at >= now() - interval '1 day'
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_MEMBER');
  END IF;
  SELECT id INTO referrer FROM public.profiles
    WHERE upper(trim(referral_code)) = upper(trim(p_referrer_code)) OR id::text = lower(trim(p_referrer_code));
  IF referrer IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'INVALID_CODE'); END IF;
  IF referrer = p_referee_id THEN RETURN jsonb_build_object('success', false, 'code', 'SELF_REFERRAL'); END IF;
  PERFORM id FROM public.profiles WHERE id IN (p_referee_id, referrer) ORDER BY id FOR UPDATE;
  INSERT INTO public.referral_logs(referrer_id, referee_id, reward_coins) VALUES (referrer, p_referee_id, 5)
    ON CONFLICT (referee_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'ALREADY_REFERRED'); END IF;
  UPDATE public.profiles SET coins = coalesce(coins, 0) + 5 WHERE id IN (referrer, p_referee_id);
  UPDATE public.profiles SET referred_by = referrer WHERE id = p_referee_id;
  RETURN jsonb_build_object('success', true, 'reward_coins', 5, 'referrer_id', referrer);
END $$;
REVOKE ALL ON FUNCTION public.claim_referral_reward(uuid, varchar, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(uuid, varchar, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_and_claim_referrer_rewards(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the authenticated referrer may read rewards' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('success', true, 'total_referral_coins', coalesce(sum(reward_coins), 0),
    'log_ids', coalesce(array_agg(id::text), ARRAY[]::text[])) FROM public.referral_logs WHERE referrer_id = p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.check_and_claim_referrer_rewards(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_and_claim_referrer_rewards(uuid) TO authenticated;
REVOKE ALL ON public.referral_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.referral_logs TO authenticated;
DROP POLICY IF EXISTS "Public select on referral_logs" ON public.referral_logs;
DROP POLICY IF EXISTS "Participants read referrals" ON public.referral_logs;
CREATE POLICY "Participants read referrals" ON public.referral_logs
  FOR SELECT TO authenticated USING (auth.uid() IN (referrer_id, referee_id));

COMMIT;
