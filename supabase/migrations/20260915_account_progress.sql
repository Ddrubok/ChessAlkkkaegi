-- ==============================================================================
-- [체스알까기] 계정별 진행 상황 스냅샷 마이그레이션 (2026-09-15)
-- 인증된 비익명(non-anonymous) 사용자의 로컬 진행도 클라우드 동기화 스토리지 및 CAS RPC
-- ==============================================================================

BEGIN;

-- 1. 진행 상황 스냅샷 테이블 생성
CREATE TABLE IF NOT EXISTS public.account_progress (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. 권한 및 Row Level Security (RLS) 설정
-- 직접 INSERT / UPDATE / DELETE 차단, 본인 SELECT만 허용 (인증된 비익명 사용자 전용)
ALTER TABLE public.account_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_progress TO authenticated;

DROP POLICY IF EXISTS "Users can select own account progress" ON public.account_progress;
CREATE POLICY "Users can select own account progress" ON public.account_progress
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
  );

-- 3. 계정 진행도 조회 RPC (public.get_account_progress)
-- 행이 없을 경우 빈 객체와 revision 0 반환
CREATE OR REPLACE FUNCTION public.get_account_progress(p_expected_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_data jsonb;
  v_revision bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);

  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may access account progress' USING ERRCODE = '42501';
  END IF;

  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;

  SELECT data, revision INTO v_data, v_revision
  FROM public.account_progress
  WHERE user_id = caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'data', '{}'::jsonb,
      'revision', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'data', v_data,
    'revision', v_revision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_progress(uuid) TO authenticated;

-- 4. 계정 진행도 저장 RPC (public.save_account_progress)
-- 원자적 Compare-And-Swap (CAS) revision 제어 및 페이로드 검증
CREATE OR REPLACE FUNCTION public.save_account_progress(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  k text;
  v jsonb;
  v_str text;
  v_parsed jsonb;
  v_points_num numeric;
  v_stage_int integer;
  v_result_data jsonb;
  v_result_rev bigint;
BEGIN
  -- 인증 및 비익명 계정 확인
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);

  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;

  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;

  -- 페이로드 기본 형식 검증
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;

  -- 최대 용량 검증 (256KB = 262,144 bytes)
  IF octet_length(p_data::text) > 262144 THEN
    RAISE EXCEPTION 'Progress payload exceeds maximum allowed size of 262144 bytes' USING ERRCODE = '22023';
  END IF;

  -- 원자성 검증: points와 upgrades는 반드시 둘 다 존재하거나 둘 다 없어야 함
  IF (p_data ? 'chessAlkkagi.meta.points') <> (p_data ? 'chessAlkkagi.meta.upgrades') THEN
    RAISE EXCEPTION 'Points and upgrades must be both present or both absent to keep atomicity' USING ERRCODE = '22023';
  END IF;

  -- 키 및 값 유효성 검증 루프
  FOR k, v IN SELECT * FROM jsonb_each(p_data)
  LOOP
    -- 허용된 키 목록 화이트리스트 검사
    IF k NOT IN (
      'chessAlkkagi.meta.maxStage',
      'chessAlkkagi.meta.points',
      'chessAlkkagi.meta.upgrades',
      'has_completed_tutorial',
      'has_completed_adv_tutorial',
      'ca_puzzle_cleared_v1',
      'ca_puzzle_medals_v1',
      'ca_puzzle_progress_v1'
    ) THEN
      RAISE EXCEPTION 'Disallowed key in progress snapshot: %', k USING ERRCODE = '22023';
    END IF;

    -- 모든 값은 localStorage 호환 문자열(string) 형태여야 함
    IF jsonb_typeof(v) <> 'string' THEN
      RAISE EXCEPTION 'All progress snapshot values must be strings: %', k USING ERRCODE = '22023';
    END IF;

    v_str := v #>> '{}';

    -- 각 키별 세부 도메인 검증
    IF k = 'chessAlkkagi.meta.points' THEN
      IF v_str !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Invalid points format: must be non-negative integer digits' USING ERRCODE = '22023';
      END IF;
      v_points_num := v_str::numeric;
      IF v_points_num < 0 OR v_points_num > 9007199254740991 THEN
        RAISE EXCEPTION 'Points out of safe integer range (0..9007199254740991)' USING ERRCODE = '22023';
      END IF;

    ELSIF k = 'chessAlkkagi.meta.maxStage' THEN
      IF v_str !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Invalid maxStage format: must be digits' USING ERRCODE = '22023';
      END IF;
      v_stage_int := v_str::integer;
      IF v_stage_int < 0 OR v_stage_int > 10 THEN
        RAISE EXCEPTION 'maxStage out of range (0..10)' USING ERRCODE = '22023';
      END IF;

    ELSIF k IN ('has_completed_tutorial', 'has_completed_adv_tutorial') THEN
      IF v_str NOT IN ('true', 'started', 'skipped') THEN
        RAISE EXCEPTION 'Invalid tutorial completion value: %', v_str USING ERRCODE = '22023';
      END IF;

    ELSIF k = 'chessAlkkagi.meta.upgrades' THEN
      BEGIN
        v_parsed := v_str::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON format for meta.upgrades' USING ERRCODE = '22023';
      END;
      IF jsonb_typeof(v_parsed) <> 'object' THEN
        RAISE EXCEPTION 'meta.upgrades must parse to a JSON object' USING ERRCODE = '22023';
      END IF;

    ELSIF k = 'ca_puzzle_cleared_v1' THEN
      BEGIN
        v_parsed := v_str::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON format for ca_puzzle_cleared_v1' USING ERRCODE = '22023';
      END;
      IF jsonb_typeof(v_parsed) <> 'array' THEN
        RAISE EXCEPTION 'ca_puzzle_cleared_v1 must parse to a JSON array' USING ERRCODE = '22023';
      END IF;

    ELSIF k = 'ca_puzzle_medals_v1' THEN
      BEGIN
        v_parsed := v_str::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON format for ca_puzzle_medals_v1' USING ERRCODE = '22023';
      END;
      IF jsonb_typeof(v_parsed) <> 'object' THEN
        RAISE EXCEPTION 'ca_puzzle_medals_v1 must parse to a JSON object' USING ERRCODE = '22023';
      END IF;

    ELSIF k = 'ca_puzzle_progress_v1' THEN
      BEGIN
        v_parsed := v_str::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON format for ca_puzzle_progress_v1' USING ERRCODE = '22023';
      END;
      IF jsonb_typeof(v_parsed) <> 'object' THEN
        RAISE EXCEPTION 'ca_puzzle_progress_v1 must parse to a JSON object' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- CAS 원자적 삽입 / 갱신 처리
  IF p_expected_revision = 0 THEN
    -- 신규 행 생성 시도: 기존 데이터가 없어야 함
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, p_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    -- 기존 행 갱신 시도: revision 일치 조건 검사
    UPDATE public.account_progress
    SET data = p_data,
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', v_result_data,
    'revision', v_result_rev
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_account_progress(jsonb, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_account_progress(jsonb, bigint, uuid) TO authenticated;

-- 실행 완료 마커 반환
SELECT 'account_progress_applied' AS migration_status;

COMMIT;
