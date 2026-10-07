-- Read-only deployment checks; run as postgres after the 20261007 migration.
DO $$
BEGIN
  IF to_regclass('public.ranked_match_sessions') IS NULL
    OR to_regprocedure('public.register_ranked_match(text,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Ranked registration migration is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ranked_match_sessions'::regclass)
    OR has_table_privilege('authenticated', 'public.ranked_match_sessions', 'INSERT,UPDATE,DELETE')
    OR has_function_privilege('anon', 'public.register_ranked_match(text,text,uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.register_ranked_match(text,text,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.finish_match_v2(text,text,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Ranked registration permissions are incorrect';
  END IF;
  IF position('public.ranked_match_sessions' IN pg_get_functiondef('public.finish_match_v2(text,text,uuid,uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Settlement gate was not applied (or an older SQL overwrote it)';
  END IF;
END $$;
SELECT 'ranked_match_registration_ready' AS status;
