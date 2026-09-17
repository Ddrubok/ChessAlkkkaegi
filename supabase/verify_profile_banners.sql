-- Run after 20260917_profile_banners.sql in the project SQL Editor.
-- No account progress rows are read or changed.
WITH required(signature) AS (
  VALUES
    ('public.get_account_progress_v3(uuid,text)'),
    ('public.save_account_progress_v3(jsonb,bigint,uuid,text)'),
    ('public.get_player_banner(uuid)')
), checks AS (
  SELECT signature, to_regprocedure(signature) AS function_id FROM required
)
SELECT CASE WHEN bool_and(function_id IS NOT NULL
  AND has_function_privilege('authenticated', function_id, 'EXECUTE')
  AND NOT has_function_privilege('anon', function_id, 'EXECUTE'))
  THEN 'profile_banners_ready'
  ELSE 'profile_banners_not_ready'
END AS verification_status,
jsonb_agg(jsonb_build_object('function', signature,
  'exists', function_id IS NOT NULL,
  'authenticated_execute', coalesce(has_function_privilege('authenticated', function_id, 'EXECUTE'), false),
  'anon_execute', coalesce(has_function_privilege('anon', function_id, 'EXECUTE'), false))) AS checks
FROM checks;

-- Refresh PostgREST schema cache after function installation.
NOTIFY pgrst, 'reload schema';
