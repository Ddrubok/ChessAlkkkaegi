-- Client-reported telemetry. These rows are not evidence of a competitive result.
BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_events (
  event_id uuid PRIMARY KEY,
  name text NOT NULL,
  occurred_at timestamptz NOT NULL,
  analytics_id uuid NOT NULL,
  session_id uuid NOT NULL,
  environment text NOT NULL,
  platform text NOT NULL,
  build text NOT NULL,
  mode text NOT NULL,
  match_id text,
  campaign jsonb,
  details jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_events_recorded_at_idx ON public.marketing_events(recorded_at);
CREATE INDEX IF NOT EXISTS marketing_events_analytics_idx ON public.marketing_events(analytics_id, occurred_at);
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_events TO service_role;

-- Never export this table with event reports. auth.uid() binds the session
-- account, but analytics_id is client supplied and is not verified identity.
CREATE TABLE IF NOT EXISTS public.marketing_identity_links (
  analytics_id uuid NOT NULL,
  user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (analytics_id, user_id)
);
CREATE INDEX IF NOT EXISTS marketing_identity_links_recorded_at_idx ON public.marketing_identity_links(recorded_at);
ALTER TABLE public.marketing_identity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_identity_links FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_marketing_events(p_events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb;
  c jsonb;
  d jsonb;
  k text;
  accepted integer := 0;
  event_uuid uuid;
  actor uuid := auth.uid();
  event_analytics uuid;
  timestamp_text text;
  event_time timestamptz;
BEGIN
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid marketing event batch' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_events) NOT BETWEEN 1 AND 50 OR octet_length(p_events::text) > 65536 THEN
    RAISE EXCEPTION 'Invalid marketing event batch' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid marketing event fields' USING ERRCODE = '22023';
    END IF;
    IF NOT (e ?& ARRAY['event_id','name','occurred_at','analytics_id','session_id','environment','platform','build','mode','match_id','campaign','details']) OR
      (SELECT count(*) FROM jsonb_object_keys(e)) <> 12 THEN
      RAISE EXCEPTION 'Invalid marketing event fields' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e->'event_id') <> 'string' OR e->>'event_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(e->'analytics_id') <> 'string' OR e->>'analytics_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(e->'session_id') <> 'string' OR e->>'session_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(e->'name') <> 'string'
      OR jsonb_typeof(e->'environment') <> 'string'
      OR jsonb_typeof(e->'platform') <> 'string'
      OR jsonb_typeof(e->'mode') <> 'string'
      OR e->>'name' NOT IN ('session_start','game_ready','first_shot','tutorial_complete','match_start','match_end','match_abort','invite_created','invite_joined','rematch_start')
      OR e->>'environment' NOT IN ('production','development','qa')
      OR e->>'platform' NOT IN ('web','android')
      OR e->>'mode' NOT IN ('menu','ai','friend','hotseat','tutorial','puzzle','weekly','ranked')
      OR jsonb_typeof(e->'build') <> 'string' OR length(e->>'build') NOT BETWEEN 1 AND 80
      OR (jsonb_typeof(e->'match_id') <> 'null' AND
        (jsonb_typeof(e->'match_id') <> 'string' OR e->>'match_id' !~* '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|m-[0-9a-f]{64})$'))
      OR (e->>'name' IN ('session_start','game_ready') AND e->>'mode' <> 'menu')
      OR (e->>'name' = 'tutorial_complete' AND e->>'mode' <> 'tutorial')
      OR (e->>'name' IN ('match_start','match_end','match_abort','rematch_start') AND e->>'mode' NOT IN ('ai','friend','hotseat','ranked'))
      OR (e->>'name' IN ('invite_created','invite_joined') AND e->>'mode' <> 'friend')
      OR (e->>'name' = 'first_shot' AND e->>'mode' = 'menu')
      OR (e->>'name' IN ('session_start','game_ready','tutorial_complete') AND jsonb_typeof(e->'match_id') <> 'null')
      OR (e->>'name' IN ('match_start','match_end','match_abort','rematch_start','invite_created','invite_joined') AND jsonb_typeof(e->'match_id') <> 'string') THEN
      RAISE EXCEPTION 'Invalid marketing event value' USING ERRCODE = '22023';
    END IF;
    timestamp_text := e->>'occurred_at';
    IF jsonb_typeof(e->'occurred_at') <> 'string' OR
      timestamp_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN
      RAISE EXCEPTION 'Expected ISO UTC occurred_at' USING ERRCODE = '22023';
    END IF;
    event_time := timestamp_text::timestamptz;
    IF event_time > now() + interval '5 minutes' OR event_time < now() - interval '90 days' THEN
      RAISE EXCEPTION 'Marketing event outside retention window' USING ERRCODE = '22023';
    END IF;
    c := e->'campaign';
    IF c <> 'null'::jsonb THEN
      IF jsonb_typeof(c) <> 'object' THEN
        RAISE EXCEPTION 'Invalid campaign' USING ERRCODE = '22023';
      END IF;
      IF (SELECT count(*) FROM jsonb_object_keys(c) key WHERE key NOT IN ('source','campaign','content')) > 0 THEN
        RAISE EXCEPTION 'Invalid campaign' USING ERRCODE = '22023';
      END IF;
      FOR k IN SELECT jsonb_object_keys(c) LOOP
        IF jsonb_typeof(c->k) <> 'string' OR length(c->>k) NOT BETWEEN 1 AND 64
          OR c->>k !~ '^[A-Za-z0-9_.-]+$' THEN
          RAISE EXCEPTION 'Invalid campaign value' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    d := e->'details';
    IF jsonb_typeof(d) <> 'object' THEN
      RAISE EXCEPTION 'Invalid details' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(d) key WHERE key NOT IN ('outcome','resigned','reason','tutorial','previous_match_id','first_session')) > 0
        OR (d ? 'first_session' AND (jsonb_typeof(d->'first_session') <> 'boolean' OR e->>'name' <> 'session_start'))
        OR (d ? 'outcome' AND (jsonb_typeof(d->'outcome') <> 'string' OR d->>'outcome' NOT IN ('win','loss','draw')))
        OR (d ? 'resigned' AND jsonb_typeof(d->'resigned') <> 'boolean')
        OR (d ? 'reason' AND (jsonb_typeof(d->'reason') <> 'string' OR d->>'reason' NOT IN ('menu_exit','restart','disconnected','error')))
        OR (d ? 'tutorial' AND (jsonb_typeof(d->'tutorial') <> 'string' OR d->>'tutorial' NOT IN ('basic','advanced')))
        OR (d ? 'previous_match_id' AND (jsonb_typeof(d->'previous_match_id') <> 'string' OR d->>'previous_match_id' !~* '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|m-[0-9a-f]{64})$'))
        OR (e->>'name' = 'match_end' AND (NOT (d ? 'outcome') OR NOT (d ? 'resigned')))
        OR (e->>'name' = 'match_abort' AND NOT (d ? 'reason'))
        OR (e->>'name' = 'tutorial_complete' AND NOT (d ? 'tutorial'))
        OR (e->>'name' = 'rematch_start' AND NOT (d ? 'previous_match_id')) THEN
      RAISE EXCEPTION 'Invalid details' USING ERRCODE = '22023';
    END IF;
    event_uuid := (e->>'event_id')::uuid;
    event_analytics := (e->>'analytics_id')::uuid;
    INSERT INTO public.marketing_events(event_id,name,occurred_at,analytics_id,session_id,environment,platform,build,mode,match_id,campaign,details)
    VALUES (event_uuid,e->>'name',event_time,event_analytics,(e->>'session_id')::uuid,
      e->>'environment',e->>'platform',e->>'build',e->>'mode',e->>'match_id',c,d)
    ON CONFLICT (event_id) DO NOTHING;
    IF FOUND THEN accepted := accepted + 1; END IF;
    -- A guest retry after login may bind the same analytics ID, but an event ID
    -- collision cannot bind somebody else's analytics ID.
    IF actor IS NOT NULL AND EXISTS
      (SELECT 1 FROM public.marketing_events WHERE event_id = event_uuid AND analytics_id = event_analytics) THEN
      INSERT INTO public.marketing_identity_links(analytics_id,user_id) VALUES (event_analytics,actor)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN accepted;
END $$;
REVOKE ALL ON FUNCTION public.record_marketing_events(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_marketing_events(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.record_marketing_events(jsonb) TO authenticated;

-- Call from a service-role scheduler at least daily. pg_cron is optional.
CREATE OR REPLACE FUNCTION public.purge_marketing_events()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE deleted integer;
BEGIN
  IF current_setting('role', true) <> 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.marketing_events WHERE occurred_at < now() - interval '90 days'
    OR recorded_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  DELETE FROM public.marketing_identity_links WHERE recorded_at < now() - interval '90 days';
  RETURN deleted;
END $$;
REVOKE ALL ON FUNCTION public.purge_marketing_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_marketing_events() TO service_role;

COMMIT;

-- Schedule only where pg_cron is already installed; rerunning this migration
-- does not create duplicate jobs. A project without pg_cron must call the RPC.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge_marketing_events_daily') THEN
      PERFORM cron.schedule('purge_marketing_events_daily', '17 3 * * *', 'SELECT public.purge_marketing_events()');
    END IF;
  END IF;
END $$;
