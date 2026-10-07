-- Apply after 20260914_secure_match_settlement.sql, before the matching client build.
-- Registration binds authenticated participants before settlement. It does NOT
-- prove that a game was played or prevent two cooperating accounts from lying.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ranked_match_sessions (
  match_id text PRIMARY KEY CHECK (length(match_id) BETWEEN 1 AND 200),
  mode text NOT NULL CHECK (mode IN ('classic', 'strategy')),
  white_id uuid NOT NULL REFERENCES public.profiles(id),
  black_id uuid NOT NULL REFERENCES public.profiles(id),
  white_ready boolean NOT NULL DEFAULT false,
  black_ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CHECK (white_id <> black_id)
);
ALTER TABLE public.ranked_match_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ranked_match_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ranked_match_sessions TO authenticated;
DROP POLICY IF EXISTS "Participants read ranked sessions" ON public.ranked_match_sessions;
CREATE POLICY "Participants read ranked sessions" ON public.ranked_match_sessions
  FOR SELECT TO authenticated USING (auth.uid() IN (white_id, black_id));

CREATE OR REPLACE FUNCTION public.register_ranked_match(
  p_match_id text, p_mode text, p_white_id uuid, p_black_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  registered public.ranked_match_sessions%ROWTYPE;
BEGIN
  IF caller IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    OR p_white_id IS NULL OR p_black_id IS NULL
    OR caller NOT IN (p_white_id, p_black_id) OR p_white_id = p_black_id THEN
    RAISE EXCEPTION 'Only distinct signed-in participants may register a ranked match' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL OR length(p_match_id) NOT BETWEEN 1 AND 200
    OR p_mode IS NULL OR p_mode NOT IN ('classic', 'strategy') THEN
    RAISE EXCEPTION 'Invalid ranked match' USING ERRCODE = '22023';
  END IF;
  -- Existing historical results must never become the identity of a new game.
  IF EXISTS (SELECT 1 FROM public.match_settlements WHERE match_id = p_match_id) THEN
    RAISE EXCEPTION 'Match result already reported' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ranked_match_sessions(match_id, mode, white_id, black_id)
    VALUES (p_match_id, p_mode, p_white_id, p_black_id)
    ON CONFLICT (match_id) DO NOTHING;
  SELECT * INTO STRICT registered FROM public.ranked_match_sessions WHERE match_id = p_match_id FOR UPDATE;
  IF registered.mode <> p_mode OR registered.white_id <> p_white_id OR registered.black_id <> p_black_id THEN
    RAISE EXCEPTION 'Conflicting ranked match' USING ERRCODE = '22023';
  END IF;
  IF registered.expires_at <= now() THEN
    RAISE EXCEPTION 'Ranked match expired' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ranked_match_sessions SET
    white_ready = white_ready OR caller = white_id,
    black_ready = black_ready OR caller = black_id
    WHERE match_id = p_match_id RETURNING * INTO registered;
  RETURN jsonb_build_object('status', CASE WHEN registered.white_ready AND registered.black_ready THEN 'ready' ELSE 'pending' END);
END $$;
REVOKE ALL ON FUNCTION public.register_ranked_match(text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_ranked_match(text, text, uuid, uuid) TO authenticated;

-- The settlement function below is the existing bilateral Elo calculation with
-- a registration gate. Historical settled receipts remain readable/idempotent.

CREATE OR REPLACE FUNCTION public.finish_match_v2(
  p_match_id text, p_mode text, p_white_id uuid, p_black_id uuid, p_winner_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  receipt public.match_settlements%ROWTYPE;
  registered public.ranked_match_sessions%ROWTYPE;
  white_rating integer;
  black_rating integer;
  delta integer;
  white_change integer;
  black_change integer;
  score numeric;
BEGIN
  IF caller IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    OR p_white_id IS NULL OR p_black_id IS NULL
    OR caller NOT IN (p_white_id, p_black_id) OR p_white_id = p_black_id THEN
    RAISE EXCEPTION 'Only distinct match participants may report a result' USING ERRCODE = '42501';
  END IF;
  IF p_match_id IS NULL OR length(p_match_id) NOT BETWEEN 1 AND 200
    OR p_mode IS NULL OR p_mode NOT IN ('classic', 'strategy')
    OR (p_winner_id IS NOT NULL AND p_winner_id NOT IN (p_white_id, p_black_id)) THEN
    RAISE EXCEPTION 'Invalid match result' USING ERRCODE = '22023';
  END IF;

  -- Preserve idempotent reads of results settled before this migration as well.
  SELECT * INTO receipt FROM public.match_settlements WHERE match_id = p_match_id;
  IF receipt.settled_at IS NOT NULL THEN
    IF receipt.mode <> p_mode OR receipt.white_id <> p_white_id OR receipt.black_id <> p_black_id
      OR receipt.winner_id IS DISTINCT FROM p_winner_id THEN
      RAISE EXCEPTION 'Conflicting match result' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('status', 'settled', 'white_delta', receipt.white_delta, 'black_delta', receipt.black_delta);
  END IF;
  SELECT * INTO registered FROM public.ranked_match_sessions WHERE match_id = p_match_id FOR UPDATE;
  IF NOT FOUND OR NOT (registered.white_ready AND registered.black_ready) THEN
    RAISE EXCEPTION 'Both participants must register before reporting a result' USING ERRCODE = '42501';
  END IF;
  IF registered.mode <> p_mode OR registered.white_id <> p_white_id OR registered.black_id <> p_black_id THEN
    RAISE EXCEPTION 'Result does not match registered participants and mode' USING ERRCODE = '22023';
  END IF;
  IF registered.expires_at <= now() THEN
    RAISE EXCEPTION 'Ranked match expired' USING ERRCODE = '22023';
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

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'ranked_match_registration_applied' AS status;
