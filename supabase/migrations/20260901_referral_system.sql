-- ==============================================================================
-- [체스알까기] 친구 추천(Referral) 시스템 DB 스키마 및 원자적 보상 RPC 함수
-- ==============================================================================

-- 1. profiles 테이블에 고유 추천 코드 및 추천인 컬럼 추가
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id);

-- 기존 레코드 중 referral_code가 없는 행에 대해 고유 난수 코드 일괄 생성
UPDATE public.profiles
SET referral_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- 2. 추천 보상 지급 로그 테이블 (중복 지급 방지 & 어뷰징 추적)
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

-- RLS 활성화
ALTER TABLE public.referral_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users can view their own referral logs"
    ON public.referral_logs FOR SELECT
    USING (auth.uid() = referrer_id OR auth.uid() = referee_id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. 원자적 보상 처리 RPC 함수 (claim_referral_reward)
CREATE OR REPLACE FUNCTION claim_referral_reward(
    p_referee_id UUID,
    p_referrer_code VARCHAR
)
RETURNS JSONB AS $$
DECLARE
    v_referrer_id UUID;
    v_already_referred BOOLEAN;
    v_reward_amount INT := 5;
BEGIN
    -- 1. 추천인 코드 유효성 검증
    SELECT id INTO v_referrer_id 
    FROM public.profiles 
    WHERE referral_code = UPPER(TRIM(p_referrer_code));

    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '존재하지 않는 추천 코드입니다.');
    END IF;

    -- 2. 자가 추천(Self-Referral) 차단
    IF v_referrer_id = p_referee_id THEN
        RETURN jsonb_build_object('success', false, 'message', '자기 자신은 추천할 수 없습니다.');
    END IF;

    -- 3. 이미 추천 보상을 수령한 계정인지 검증
    SELECT EXISTS (
        SELECT 1 FROM public.referral_logs WHERE referee_id = p_referee_id
    ) INTO v_already_referred;

    IF v_already_referred THEN
        RETURN jsonb_build_object('success', false, 'message', '이미 추천인 보상을 수령한 계정입니다.');
    END IF;

    -- 4. 추천 이력 로그 기록
    INSERT INTO public.referral_logs (referrer_id, referee_id, reward_coins)
    VALUES (v_referrer_id, p_referee_id, v_reward_amount);

    -- 5. 피초대자(신규 유저) 코인 지급 및 추천인 등록
    UPDATE public.profiles
    SET coins = COALESCE(coins, 0) + v_reward_amount,
        referred_by = v_referrer_id
    WHERE id = p_referee_id;

    -- 6. 초대자(기존 유저) 코인 지급
    UPDATE public.profiles
    SET coins = COALESCE(coins, 0) + v_reward_amount
    WHERE id = v_referrer_id;

    RETURN jsonb_build_object(
        'success', true, 
        'reward_coins', v_reward_amount,
        'message', '추천인 등록 완료! 보너스 코인 5개가 지급되었습니다.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
