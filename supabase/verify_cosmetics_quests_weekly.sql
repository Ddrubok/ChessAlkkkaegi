-- Run AFTER all three migrations. No player data is read or changed.
WITH required(signature) AS (VALUES
 ('public.get_account_progress_v4(uuid,text)'),
 ('public.save_account_progress_v4(jsonb,bigint,uuid,text)'),
 ('public.get_player_cosmetics(uuid)'),
 ('public.get_quest_snapshot_v1(uuid)'),
 ('public.submit_quest_events_v1(jsonb,uuid)'),
 ('public.get_weekly_challenge_snapshot_v1(uuid)'),
 ('public.begin_weekly_challenge_attempt_v1(text,text,uuid,uuid,uuid)'),
 ('public.control_weekly_challenge_attempt_v1(uuid,text,bigint,uuid,uuid,uuid)'),
 ('public.append_weekly_challenge_attempt_events_v1(uuid,bigint,uuid,jsonb,uuid)')
), rpc_checks AS (
 SELECT signature AS check_name,
   coalesce(p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'),false) AS ok
 FROM required LEFT JOIN pg_proc p ON p.oid = to_regprocedure(signature)
), required_tables(name) AS (VALUES
 ('quest_periods'),('account_quest_events'),('account_quest_progress'),
 ('weekly_challenge_weeks'),('account_weekly_challenge_attempts'),
 ('account_weekly_challenge_attempt_events'),('account_weekly_challenge_records')
), table_checks AS (
 SELECT 'table:' || name AS check_name,
 coalesce(c.relrowsecurity
   AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),false) AS ok
 FROM required_tables LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || name)
), checks AS (SELECT * FROM rpc_checks UNION ALL SELECT * FROM table_checks)
SELECT CASE WHEN bool_and(ok) THEN 'cosmetics_quests_weekly_ready'
 ELSE 'cosmetics_quests_weekly_not_ready' END AS verification_status,
 jsonb_object_agg(check_name,ok) AS checks FROM checks;

NOTIFY pgrst, 'reload schema';
