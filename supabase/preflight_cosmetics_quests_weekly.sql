-- Run BEFORE the three new migrations. This only inspects schema metadata.
WITH checks(check_name, ok) AS (
  VALUES
    ('auth_users', to_regclass('auth.users') IS NOT NULL),
    ('account_progress', to_regclass('public.account_progress') IS NOT NULL),
    ('banner_v3_get', to_regprocedure('public.get_account_progress_v3(uuid,text)') IS NOT NULL),
    ('banner_v3_save', to_regprocedure('public.save_account_progress_v3(jsonb,bigint,uuid,text)') IS NOT NULL),
    ('weekly_sha256', to_regprocedure('pg_catalog.sha256(bytea)') IS NOT NULL),
    ('weekly_random_uuid', to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL),
    ('settlement_columns', (SELECT count(*) = 5 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'match_settlements'
      AND column_name IN ('match_id','settled_at','winner_id','white_id','black_id')))
)
SELECT CASE WHEN bool_and(ok) THEN 'release_prerequisites_ready'
  ELSE 'release_prerequisites_missing' END AS verification_status,
  jsonb_object_agg(check_name, ok) AS checks
FROM checks;
