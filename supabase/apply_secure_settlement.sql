-- Generated from 20260901_referral_system.sql and 20260914_secure_match_settlement.sql.
-- Run the ENTIRE file in the project's Supabase SQL Editor as postgres.
-- Existing profiles and match_history are required. Errors roll back all changes.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.match_history') IS NULL THEN
    RAISE EXCEPTION 'Required base tables profiles/match_history are missing. Check the selected project.';
  END IF;
END $$;

-- ==============================================================================
-- [체스알까기] 친구 추천(Referral) 시스템 DB 스키마 및 원자적 보상 RPC 함수
-- ==============================================================================

-- 1. profiles 테이블에 고유 추천 코드 및 추천인, 코인 컬럼 보장
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS referral_code VARCHAR(36) UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS coins INT DEFAULT 10;

UPDATE public.profiles
SET referral_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- 2. 추천 보상 지급 로그 테이블 (중복 지급 방지 & 실시간 알림 트리거)
CREATE TABLE IF NOT EXISTS public.referral_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    referee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    reward_coins INT DEFAULT 5 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 동일 신규 가입자에 대한 중복 보상 지급 방지
    CONSTRAINT unique_referee_reward UNIQUE (referee_id),
    -- 자기 자신 추천 방지 제약조건
    CONSTRAINT check_no_self_referral CHECK (referrer_id <> referee_id)
);

-- Realtime Publication에 referral_logs 및 profiles 추가 (실시간 구독 지원)
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.referral_logs;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

-- RLS 활성화 및 권한 정책 (SELECT 허용)
ALTER TABLE public.referral_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public select on referral_logs" ON public.referral_logs;
CREATE POLICY "Public select on referral_logs"
ON public.referral_logs FOR SELECT
USING (true);

-- 3. 원자적 추천 보상 처리 RPC 함수 (claim_referral_reward)
CREATE OR REPLACE FUNCTION claim_referral_reward(
    p_referee_id UUID,
    p_referrer_code VARCHAR,
    p_is_new_user BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    v_referrer_id UUID;
    v_already_referred BOOLEAN;
    v_reward_amount INT := 5;
    v_clean_code VARCHAR;
BEGIN
    v_clean_code := UPPER(TRIM(p_referrer_code));

    -- 1. 기존 회원이 링크로 접속한 경우 (신규 회원이 아님)
    IF NOT p_is_new_user THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_MEMBER',
            'message', '이미 가입된 회원이에요.'
        );
    END IF;

    -- 2. 추천인 코드(대소문자 무시) 또는 ID(UUID, 대소문자 무시)로 추천인 검색
    SELECT id INTO v_referrer_id
    FROM public.profiles
    WHERE UPPER(TRIM(COALESCE(referral_code, ''))) = v_clean_code
       OR LOWER(id::TEXT) = LOWER(TRIM(p_referrer_code));

    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_CODE',
            'message', '존재하지 않는 추천 코드입니다.'
        );
    END IF;

    -- 3. 자가 추천(Self-Referral) 차단
    IF v_referrer_id = p_referee_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'SELF_REFERRAL',
            'message', '자기 자신은 추천할 수 없습니다.'
        );
    END IF;

    -- 4. 이미 추천 보상을 수령한 신규 가입자인지 검증
    SELECT EXISTS (
        SELECT 1 FROM public.referral_logs WHERE referee_id = p_referee_id
    ) INTO v_already_referred;

    IF v_already_referred THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ALREADY_REFERRED',
            'message', '이미 가입된 회원이에요.'
        );
    END IF;

    -- 5. 추천 이력 로그 기록 (Realtime INSERT 이벤트 발생 -> 초대자 클라이언트에 실시간 전달)
    INSERT INTO public.referral_logs (referrer_id, referee_id, reward_coins)
    VALUES (v_referrer_id, p_referee_id, v_reward_amount);

    -- 6. 피초대자(신규 유저) 코인 지급 및 추천인 등록
    UPDATE public.profiles
    SET coins = COALESCE(coins, 0) + v_reward_amount,
        referred_by = v_referrer_id
    WHERE id = p_referee_id;

    -- 7. 초대자(기존 유저) DB 코인 지급
    UPDATE public.profiles
    SET coins = COALESCE(coins, 0) + v_reward_amount
    WHERE id = v_referrer_id;

    RETURN jsonb_build_object(
        'success', true,
        'reward_coins', v_reward_amount,
        'referrer_id', v_referrer_id,
        'message', '추천인 등록 완료! 가입 축하 보너스 코인 5개가 지급되었습니다.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 추천인 보상 조회 RPC (RLS 우회)
CREATE OR REPLACE FUNCTION check_and_claim_referrer_rewards(
    p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_total_rewards INT := 0;
    v_log_ids TEXT[];
BEGIN
    SELECT COALESCE(SUM(reward_coins), 0), COALESCE(array_agg(id::TEXT), ARRAY[]::TEXT[])
    INTO v_total_rewards, v_log_ids
    FROM public.referral_logs
    WHERE referrer_id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'total_referral_coins', v_total_rewards,
        'log_ids', v_log_ids
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply after the base profiles/match_history schema and 20260901_referral_system.sql.

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


DO $$ BEGIN
  IF NOT has_function_privilege('authenticated', 'public.finish_match_v2(text,text,uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.finish_match_v2(text,text,uuid,uuid,uuid)', 'EXECUTE')
    OR has_column_privilege('authenticated', 'public.profiles', 'classic_mmr', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'coins', 'UPDATE') THEN
    RAISE EXCEPTION 'Settlement permissions verification failed';
  END IF;
END $$;
COMMIT;
SELECT 'secure_settlement_applied' AS status;
