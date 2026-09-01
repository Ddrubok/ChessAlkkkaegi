-- ==============================================================================
-- [체스알까기] 친구 추천(Referral) 시스템 DB 스키마 및 원자적 보상 RPC 함수
-- ==============================================================================

-- 1. profiles 테이블에 고유 추천 코드 및 추천인, 코인 컬럼 보장
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS referral_code VARCHAR(36) UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS coins INT DEFAULT 10;

-- 기존 레코드 중 referral_code가 없는 행에 대해 고유 난수 코드 일괄 생성
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
    p_referrer_code VARCHAR
)
RETURNS JSONB AS $$
DECLARE
    v_referrer_id UUID;
    v_already_referred BOOLEAN;
    v_reward_amount INT := 5;
    v_clean_code VARCHAR;
BEGIN
    v_clean_code := UPPER(TRIM(p_referrer_code));

    -- 1. 추천인 코드(대소문자 무시) 또는 ID(UUID, 대소문자 무시)로 추천인 검색
    SELECT id INTO v_referrer_id 
    FROM public.profiles 
    WHERE UPPER(TRIM(COALESCE(referral_code, ''))) = v_clean_code
       OR LOWER(id::TEXT) = LOWER(TRIM(p_referrer_code));

    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 추천 코드입니다: ' || p_referrer_code);
    END IF;

    -- 2. 자가 추천(Self-Referral) 차단
    IF v_referrer_id = p_referee_id THEN
        RETURN jsonb_build_object('success', false, 'message', '자기 자신은 추천할 수 없습니다.');
    END IF;

    -- 3. 이미 추천 보상을 수령한 신규 가입자인지 검증
    SELECT EXISTS (
        SELECT 1 FROM public.referral_logs WHERE referee_id = p_referee_id
    ) INTO v_already_referred;

    IF v_already_referred THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 추천인 보상을 수령한 계정입니다.');
    END IF;

    -- 4. 추천 이력 로그 기록 (Realtime INSERT 이벤트 발생 -> 초대자 클라이언트에 실시간 전달)
    INSERT INTO public.referral_logs (referrer_id, referee_id, reward_coins)
    VALUES (v_referrer_id, p_referee_id, v_reward_amount);

    -- 5. 피초대자(신규 유저) 코인 지급 및 추천인 등록
    UPDATE public.profiles
    SET coins = COALESCE(coins, 0) + v_reward_amount,
        referred_by = v_referrer_id
    WHERE id = p_referee_id;

    -- 6. 초대자(기존 유저) DB 코인 지급
    UPDATE public.profiles
    SET coins = COALESCE(coins, 0) + v_reward_amount
    WHERE id = v_referrer_id;

    RETURN jsonb_build_object(
        'success', true, 
        'reward_coins', v_reward_amount,
        'referrer_id', v_referrer_id,
        'message', '추천인 등록 완료! 보너스 코인 5개가 지급되었습니다.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 초대한 유저(Referrer)의 추천 보상 조회 RPC (RLS 무관하게 100% 안전 조회)
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
