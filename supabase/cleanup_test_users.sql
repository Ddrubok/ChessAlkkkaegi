-- ==============================================================================
-- [체스알까기] Supabase 이메일에 'test'가 포함된 모든 테스트 유저 일괄 삭제 쿼리
-- Supabase Dashboard > SQL Editor 에 붙여넣고 [Run]을 누르면 즉시 실행됩니다.
-- ==============================================================================

-- 1. [확인용] 삭제 대상 유저 목록 미리보기 (필요시 먼저 실행해 확인 가능)
-- SELECT id, email, created_at FROM auth.users WHERE email ILIKE '%test%';

BEGIN;

-- 2. 추천 보상 로그 정리 (외래키 참조 무결성 보장)
DELETE FROM public.referral_logs
WHERE referrer_id IN (SELECT id FROM auth.users WHERE email ILIKE '%test%')
   OR referee_id IN (SELECT id FROM auth.users WHERE email ILIKE '%test%');

-- 3. 매칭 대기열 정리
DELETE FROM public.match_queue
WHERE player_id IN (SELECT id FROM auth.users WHERE email ILIKE '%test%');

-- 4. public.profiles 테이블에서 해당 유저 삭제
DELETE FROM public.profiles
WHERE id IN (SELECT id FROM auth.users WHERE email ILIKE '%test%');

-- 5. auth.users 시스템 계정 영구 삭제 (세션, 토큰, 비밀번호 등 일괄 삭제)
DELETE FROM auth.users
WHERE email ILIKE '%test%';

COMMIT;
