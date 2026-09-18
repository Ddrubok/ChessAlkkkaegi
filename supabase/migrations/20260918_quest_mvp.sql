-- Daily and weekly quest MVP. Quest state is independent from account_progress.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quest_periods (
  period_id text PRIMARY KEY,
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  catalogue_version integer NOT NULL CHECK (catalogue_version = 1),
  definitions jsonb NOT NULL CHECK (jsonb_typeof(definitions) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.account_quest_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 160),
  canonical_input jsonb NOT NULL CHECK (jsonb_typeof(canonical_input) = 'object'),
  canonical_md5 text NOT NULL CHECK (canonical_md5 ~ '^[0-9a-f]{32}$'),
  received_at timestamptz NOT NULL,
  classification text NOT NULL CHECK (classification IN ('accepted', 'stale')),
  evidence_classification text NOT NULL CHECK (evidence_classification IN ('client-reported', 'settled-match')),
  period_acknowledgements jsonb NOT NULL CHECK (jsonb_typeof(period_acknowledgements) = 'array'),
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS public.account_quest_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES public.quest_periods(period_id) ON DELETE RESTRICT,
  quest_id text NOT NULL,
  condition_version integer NOT NULL CHECK (condition_version = 1),
  status text NOT NULL CHECK (status IN ('in-progress', 'completed', 'expired')),
  progress jsonb NOT NULL CHECK (jsonb_typeof(progress) = 'object'),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, period_id, quest_id, condition_version),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS account_quest_events_received_idx
  ON public.account_quest_events(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS account_quest_progress_period_idx
  ON public.account_quest_progress(user_id, period_id);

ALTER TABLE public.quest_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_quest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_quest_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quest_periods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.account_quest_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.account_quest_progress FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._quest_has_only_keys(p_value jsonb, p_allowed text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_value) AS key_name
    WHERE NOT (key_name = ANY (p_allowed))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_is_utc_iso(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NULL
     OR p_value !~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?Z$' THEN
    RETURN false;
  END IF;
  PERFORM p_value::timestamptz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_definitions(p_cadence text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_cadence = 'daily' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('id','daily-wins','conditionVersion',1,'cadence','daily','metric','wins','target',2),
      jsonb_build_object('id','daily-puzzle-clears','conditionVersion',1,'cadence','daily','metric','puzzle-clears','target',1),
      jsonb_build_object('id','daily-piece-types','conditionVersion',1,'cadence','daily','metric','piece-types','target',2)
    );
  ELSIF p_cadence = 'weekly' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('id','weekly-wins','conditionVersion',1,'cadence','weekly','metric','wins','target',10),
      jsonb_build_object('id','weekly-puzzle-clears','conditionVersion',1,'cadence','weekly','metric','puzzle-clears','target',5),
      jsonb_build_object('id','weekly-distinct-puzzles','conditionVersion',1,'cadence','weekly','metric','distinct-puzzles','target',3),
      jsonb_build_object('id','weekly-piece-types','conditionVersion',1,'cadence','weekly','metric','piece-types','target',6),
      jsonb_build_object('id','weekly-distinct-gold-puzzles','conditionVersion',1,'cadence','weekly','metric','distinct-gold-puzzles','target',3)
    );
  END IF;
  RAISE EXCEPTION 'Invalid quest cadence' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_period_id(p_cadence text, p_anchor date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_cadence || ':' || to_char(p_anchor, 'YYYY-MM-DD') || '@05:00:Asia/Seoul';
$$;

CREATE OR REPLACE FUNCTION public._quest_ensure_period(
  p_period_id text,
  p_cadence text,
  p_now timestamptz
)
RETURNS public.quest_periods
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_date_text text;
  v_anchor date;
  v_start timestamptz;
  v_end timestamptz;
  v_expected_id text;
  v_definitions jsonb;
  v_row public.quest_periods%ROWTYPE;
BEGIN
  IF p_cadence IS NULL OR p_cadence NOT IN ('daily','weekly') OR p_period_id IS NULL THEN
    RAISE EXCEPTION 'Invalid requested quest period' USING ERRCODE = '22023';
  END IF;
  v_prefix := p_cadence || ':';
  IF p_period_id !~ '^(daily|weekly):[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])@05:00:Asia/Seoul$'
     OR left(p_period_id, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Noncanonical requested quest period: %', p_period_id USING ERRCODE = '22023';
  END IF;
  v_date_text := substring(p_period_id FROM length(v_prefix) + 1 FOR 10);
  BEGIN
    v_anchor := v_date_text::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid requested quest period date' USING ERRCODE = '22023';
  END;
  IF to_char(v_anchor, 'YYYY-MM-DD') <> v_date_text
     OR (p_cadence = 'weekly' AND extract(isodow FROM v_anchor) <> 1) THEN
    RAISE EXCEPTION 'Noncanonical requested quest period date: %', p_period_id USING ERRCODE = '22023';
  END IF;
  v_expected_id := public._quest_period_id(p_cadence, v_anchor);
  IF v_expected_id <> p_period_id THEN
    RAISE EXCEPTION 'Noncanonical requested quest period identifier' USING ERRCODE = '22023';
  END IF;
  v_start := (v_anchor::timestamp + interval '5 hours') AT TIME ZONE 'Asia/Seoul';
  v_end := (
    (v_anchor + CASE p_cadence WHEN 'daily' THEN 1 ELSE 7 END)::timestamp + interval '5 hours'
  ) AT TIME ZONE 'Asia/Seoul';
  IF v_start > p_now THEN
    RAISE EXCEPTION 'Future quest periods are not accepted' USING ERRCODE = '22023';
  END IF;
  v_definitions := public._quest_definitions(p_cadence);

  INSERT INTO public.quest_periods(period_id,cadence,starts_at,ends_at,catalogue_version,definitions)
  VALUES (p_period_id,p_cadence,v_start,v_end,1,v_definitions)
  ON CONFLICT (period_id) DO NOTHING;

  SELECT * INTO STRICT v_row FROM public.quest_periods WHERE period_id = p_period_id;
  IF v_row.cadence IS DISTINCT FROM p_cadence
     OR v_row.starts_at IS DISTINCT FROM v_start
     OR v_row.ends_at IS DISTINCT FROM v_end
     OR v_row.catalogue_version IS DISTINCT FROM 1
     OR v_row.definitions IS DISTINCT FROM v_definitions THEN
    RAISE EXCEPTION 'Stored quest period catalogue is inconsistent: %', p_period_id USING ERRCODE = '22023';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_ensure_active_periods(p_now timestamptz)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_local_anchor date;
  v_week_anchor date;
  v_unused public.quest_periods%ROWTYPE;
BEGIN
  v_local_anchor := ((p_now AT TIME ZONE 'Asia/Seoul') - interval '5 hours')::date;
  v_week_anchor := v_local_anchor - (extract(isodow FROM v_local_anchor)::integer - 1);
  v_unused := public._quest_ensure_period(public._quest_period_id('daily',v_local_anchor),'daily',p_now);
  v_unused := public._quest_ensure_period(public._quest_period_id('weekly',v_week_anchor),'weekly',p_now);
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_ensure_progress(
  p_user_id uuid,
  p_period public.quest_periods,
  p_now timestamptz
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_definition jsonb;
  v_progress jsonb;
BEGIN
  FOR v_definition IN SELECT value FROM jsonb_array_elements(p_period.definitions)
  LOOP
    v_progress := CASE v_definition->>'metric'
      WHEN 'wins' THEN jsonb_build_object('kind','count','count',0,'eventIds','{}'::jsonb)
      WHEN 'puzzle-clears' THEN jsonb_build_object('kind','count','count',0,'eventIds','{}'::jsonb)
      ELSE jsonb_build_object('kind','distinct','targetIds','{}'::jsonb)
    END;
    INSERT INTO public.account_quest_progress(
      user_id,period_id,quest_id,condition_version,status,progress,completed_at,updated_at
    ) VALUES (
      p_user_id,p_period.period_id,v_definition->>'id',1,'in-progress',v_progress,NULL,p_now
    ) ON CONFLICT (user_id,period_id,quest_id,condition_version) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_apply_event(
  p_user_id uuid,
  p_period public.quest_periods,
  p_event jsonb,
  p_now timestamptz
)
RETURNS text[]
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_definition jsonb;
  v_metric text;
  v_quest_id text;
  v_target integer;
  v_kind text := p_event->>'kind';
  v_event_id text := p_event->>'eventId';
  v_occurred text := p_event->>'occurredAtClient';
  v_progress jsonb;
  v_status text;
  v_completed_at timestamptz;
  v_evidence jsonb;
  v_target_id text;
  v_entry jsonb;
  v_count integer;
  v_applied text[] := ARRAY[]::text[];
  v_matches boolean;
BEGIN
  PERFORM public._quest_ensure_progress(p_user_id,p_period,p_now);
  FOR v_definition IN SELECT value FROM jsonb_array_elements(p_period.definitions)
  LOOP
    v_metric := v_definition->>'metric';
    v_quest_id := v_definition->>'id';
    v_target := (v_definition->>'target')::integer;
    v_matches := (v_metric = 'wins' AND v_kind IN ('pve-win','pvp-win'))
      OR (v_metric = 'puzzle-clears' AND v_kind = 'puzzle-clear')
      OR (v_metric = 'piece-types' AND v_kind = 'piece-launch')
      OR (v_metric = 'distinct-puzzles' AND v_kind = 'puzzle-clear')
      OR (v_metric = 'distinct-gold-puzzles' AND v_kind = 'puzzle-clear' AND p_event->'payload'->>'medal' = '3');
    IF NOT v_matches THEN CONTINUE; END IF;
    v_applied := array_append(v_applied,v_quest_id);

    SELECT progress,status,completed_at INTO STRICT v_progress,v_status,v_completed_at
    FROM public.account_quest_progress
    WHERE user_id=p_user_id AND period_id=p_period.period_id AND quest_id=v_quest_id AND condition_version=1
    FOR UPDATE;
    IF v_status = 'completed' THEN CONTINUE; END IF;

    IF v_metric IN ('wins','puzzle-clears') THEN
      v_evidence := v_progress->'eventIds';
      IF NOT (v_evidence ? v_event_id) THEN
        v_count := (SELECT count(*) FROM jsonb_object_keys(v_evidence));
        IF v_count < v_target THEN
          v_evidence := v_evidence || jsonb_build_object(v_event_id,jsonb_build_object('at',v_occurred));
        END IF;
      END IF;
      v_count := (SELECT count(*) FROM jsonb_object_keys(v_evidence));
      v_progress := jsonb_build_object('kind','count','count',v_count,'eventIds',v_evidence);
    ELSE
      v_evidence := v_progress->'targetIds';
      v_target_id := CASE v_metric WHEN 'piece-types' THEN p_event->'payload'->>'pieceType' ELSE p_event->'payload'->>'puzzleId' END;
      IF NOT (v_evidence ? v_target_id) THEN
        v_count := (SELECT count(*) FROM jsonb_object_keys(v_evidence));
        IF v_count < v_target THEN
          v_entry := jsonb_build_object('eventId',v_event_id,'at',v_occurred);
          IF v_metric IN ('distinct-puzzles','distinct-gold-puzzles') THEN
            v_entry := v_entry || jsonb_build_object('puzzleRevision',(p_event->'payload'->>'puzzleRevision')::numeric);
          END IF;
          v_evidence := v_evidence || jsonb_build_object(v_target_id,v_entry);
        END IF;
      END IF;
      v_count := (SELECT count(*) FROM jsonb_object_keys(v_evidence));
      v_progress := jsonb_build_object('kind','distinct','targetIds',v_evidence);
    END IF;

    IF v_count >= v_target THEN
      v_status := 'completed';
      v_completed_at := v_occurred::timestamptz;
    END IF;
    UPDATE public.account_quest_progress
    SET progress=v_progress,status=v_status,completed_at=v_completed_at,updated_at=p_now
    WHERE user_id=p_user_id AND period_id=p_period.period_id AND quest_id=v_quest_id AND condition_version=1;
  END LOOP;
  RETURN v_applied;
END;
$$;

CREATE OR REPLACE FUNCTION public._quest_snapshot(p_user_id uuid, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_periods jsonb;
  v_progress jsonb;
  v_period public.quest_periods%ROWTYPE;
BEGIN
  PERFORM public._quest_ensure_active_periods(p_now);
  UPDATE public.account_quest_progress qp
  SET status='expired',updated_at=p_now
  FROM public.quest_periods qper
  WHERE qp.user_id=p_user_id AND qp.period_id=qper.period_id
    AND qp.status='in-progress' AND qper.ends_at <= p_now;

  FOR v_period IN
    SELECT * FROM public.quest_periods
    WHERE starts_at <= p_now AND ends_at > p_now AND cadence IN ('daily','weekly')
    ORDER BY CASE cadence WHEN 'daily' THEN 1 ELSE 2 END
  LOOP
    PERFORM public._quest_ensure_progress(p_user_id,v_period,p_now);
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'periodId',period_id,'cadence',cadence,'startsAt',to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endsAt',to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'catalogueVersion',catalogue_version,'definitions',definitions
  ) ORDER BY CASE cadence WHEN 'daily' THEN 1 ELSE 2 END),'[]'::jsonb)
  INTO v_periods FROM public.quest_periods
  WHERE starts_at <= p_now AND ends_at > p_now AND cadence IN ('daily','weekly');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'periodId',qp.period_id,'questId',qp.quest_id,'conditionVersion',qp.condition_version,
    'status',qp.status,'progress',qp.progress,
    'completedAt',CASE WHEN qp.completed_at IS NULL THEN NULL ELSE to_char(qp.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'updatedAt',to_char(qp.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) ORDER BY qper.starts_at,qp.quest_id),'[]'::jsonb)
  INTO v_progress
  FROM public.account_quest_progress qp
  JOIN public.quest_periods qper ON qper.period_id=qp.period_id
  WHERE qp.user_id=p_user_id AND qper.starts_at <= p_now AND qper.ends_at > p_now;

  RETURN jsonb_build_object(
    'schemaVersion',1,
    'serverNow',to_char(p_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'periods',v_periods,
    'progress',v_progress
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quest_snapshot_v1(p_expected_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_anon boolean := coalesce((auth.jwt()->>'is_anonymous')::boolean,false);
  v_now timestamptz := now();
BEGIN
  IF v_caller IS NULL OR v_is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may access quests' USING ERRCODE='42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Account changed during quest request' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_caller::text,7319));
  RETURN public._quest_snapshot(v_caller,v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_quest_events_v1(p_events jsonb, p_expected_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_anon boolean := coalesce((auth.jwt()->>'is_anonymous')::boolean,false);
  v_now timestamptz := now();
  v_event jsonb;
  v_event_id text;
  v_kind text;
  v_source text;
  v_identity jsonb;
  v_payload jsonb;
  v_requested jsonb;
  v_requested_item jsonb;
  v_period public.quest_periods%ROWTYPE;
  v_period_acks jsonb;
  v_ack jsonb;
  v_acks jsonb := '[]'::jsonb;
  v_stored_input jsonb;
  v_stored_ack jsonb;
  v_classification text;
  v_evidence_classification text;
  v_any_active boolean;
  v_applied text[];
  v_run_id text;
  v_match_id text;
  v_attempt_id text;
  v_expected_event_id text;
  v_seen_daily boolean;
  v_seen_weekly boolean;
BEGIN
  IF v_caller IS NULL OR v_is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may submit quests' USING ERRCODE='42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Account changed during quest request' USING ERRCODE='42501';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Quest event batch must be a JSON array' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_events) NOT BETWEEN 1 AND 32 OR octet_length(p_events::text) > 65536 THEN
    RAISE EXCEPTION 'Quest event batch is invalid or exceeds bounds' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_caller::text,7319));
  PERFORM public._quest_ensure_active_periods(v_now);

  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events)
  LOOP
    IF NOT public._quest_has_only_keys(v_event,ARRAY['schemaVersion','eventId','kind','source','requestedPeriods','occurredAtClient','identity','payload'])
       OR NOT (v_event ?& ARRAY['schemaVersion','eventId','kind','source','requestedPeriods','occurredAtClient','identity','payload']) THEN
      RAISE EXCEPTION 'Malformed quest event envelope' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(v_event->'schemaVersion') IS DISTINCT FROM 'number'
       OR v_event->'schemaVersion' IS DISTINCT FROM '1'::jsonb
       OR jsonb_typeof(v_event->'eventId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_event->'kind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_event->'source') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_event->'occurredAtClient') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_event->'identity') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_event->'payload') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_event->'requestedPeriods') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Quest event required fields have invalid JSON types' USING ERRCODE='22023';
    END IF;
    v_event_id := v_event->>'eventId';
    IF length(v_event_id) NOT BETWEEN 1 AND 160 OR octet_length(v_event_id) > 160 THEN
      RAISE EXCEPTION 'Quest event identifier exceeds bounds' USING ERRCODE='22023';
    END IF;

    SELECT canonical_input,period_acknowledgements INTO v_stored_input,v_stored_ack
    FROM public.account_quest_events WHERE user_id=v_caller AND event_id=v_event_id FOR UPDATE;
    IF FOUND THEN
      IF v_stored_input IS DISTINCT FROM v_event THEN
        RAISE EXCEPTION 'Conflicting canonical content for quest event %',v_event_id USING ERRCODE='22023';
      END IF;
      SELECT classification INTO STRICT v_classification FROM public.account_quest_events
      WHERE user_id=v_caller AND event_id=v_event_id;
      v_ack := jsonb_build_object('eventId',v_event_id,'disposition',v_classification,'duplicate',true,'periods',v_stored_ack);
      v_acks := v_acks || jsonb_build_array(v_ack);
      CONTINUE;
    END IF;

    v_kind := v_event->>'kind';
    v_source := v_event->>'source';
    v_identity := v_event->'identity';
    v_payload := v_event->'payload';
    v_requested := v_event->'requestedPeriods';
    IF v_kind IS NULL OR v_kind NOT IN ('pve-win','pvp-win','puzzle-clear','piece-launch')
       OR v_source IS NULL OR v_source NOT IN ('stage','online','tutorial','puzzle')
       OR NOT public._quest_is_utc_iso(v_event->>'occurredAtClient')
       OR octet_length(v_payload::text) > 2048
       OR jsonb_array_length(v_requested) NOT BETWEEN 1 AND 2 THEN
      RAISE EXCEPTION 'Malformed quest event fields' USING ERRCODE='22023';
    END IF;

    IF v_kind = 'pve-win' THEN
      IF v_source IS DISTINCT FROM 'stage'
         OR NOT public._quest_has_only_keys(v_identity,ARRAY['runId','stageNumber','resultIndex'])
         OR NOT (v_identity ?& ARRAY['runId','stageNumber','resultIndex'])
         OR v_payload IS DISTINCT FROM '{}'::jsonb THEN
        RAISE EXCEPTION 'Invalid PVE win quest event shape' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(v_identity->'runId') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_identity->'stageNumber') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_identity->'resultIndex') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid PVE win quest event field types' USING ERRCODE='22023';
      END IF;
      IF (v_identity->>'runId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR (v_identity->>'stageNumber') !~ '^([1-9]|10)$'
         OR v_identity->'resultIndex' IS DISTINCT FROM '1'::jsonb THEN
        RAISE EXCEPTION 'Invalid PVE win quest event values' USING ERRCODE='22023';
      END IF;
      v_run_id := v_identity->>'runId';
      v_expected_event_id := 'quest:pve-win:'||v_run_id||':stage:'||(v_identity->>'stageNumber')||':1';
    ELSIF v_kind = 'pvp-win' THEN
      IF v_source IS DISTINCT FROM 'online'
         OR NOT public._quest_has_only_keys(v_identity,ARRAY['matchId'])
         OR NOT (v_identity ? 'matchId') OR v_payload IS DISTINCT FROM '{}'::jsonb THEN
        RAISE EXCEPTION 'Invalid PVP win quest event shape' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(v_identity->'matchId') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid PVP win match identifier type' USING ERRCODE='22023';
      END IF;
      IF (v_identity->>'matchId') !~ '^[A-Za-z0-9-]{8,128}$' THEN
        RAISE EXCEPTION 'Invalid PVP win match identifier' USING ERRCODE='22023';
      END IF;
      v_match_id := v_identity->>'matchId';
      v_expected_event_id := 'quest:pvp-win:'||v_match_id;
      IF NOT EXISTS (
        SELECT 1 FROM public.match_settlements
        WHERE match_id=v_match_id AND settled_at IS NOT NULL AND winner_id=v_caller
          AND v_caller IN (white_id,black_id)
      ) THEN
        RAISE EXCEPTION 'PVP quest event is not a settled win for this account' USING ERRCODE='22023';
      END IF;
    ELSIF v_kind = 'puzzle-clear' THEN
      IF v_source IS DISTINCT FROM 'puzzle' OR NOT public._quest_has_only_keys(v_identity,ARRAY['attemptId'])
         OR NOT (v_identity ? 'attemptId')
         OR NOT public._quest_has_only_keys(v_payload,ARRAY['puzzleId','puzzleRevision','medal'])
         OR NOT (v_payload ?& ARRAY['puzzleId','puzzleRevision','medal']) THEN
        RAISE EXCEPTION 'Invalid puzzle clear quest event shape' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(v_identity->'attemptId') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_payload->'puzzleId') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_payload->'puzzleRevision') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_payload->'medal') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid puzzle clear quest event field types' USING ERRCODE='22023';
      END IF;
      IF (v_identity->>'attemptId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR (v_payload->>'puzzleId') NOT IN ('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12')
         OR (v_payload->>'puzzleRevision') !~ '^[1-9][0-9]*$'
         OR (v_payload->>'puzzleRevision')::numeric > 9007199254740991
         OR (v_payload->>'medal') NOT IN ('1','2','3') THEN
        RAISE EXCEPTION 'Invalid puzzle clear quest event values' USING ERRCODE='22023';
      END IF;
      v_attempt_id := v_identity->>'attemptId';
      v_expected_event_id := 'quest:puzzle:'||v_attempt_id||':terminal';
    ELSE
      IF v_source NOT IN ('stage','online','tutorial','puzzle')
         OR NOT public._quest_has_only_keys(v_payload,ARRAY['pieceType']) OR NOT (v_payload ? 'pieceType') THEN
        RAISE EXCEPTION 'Invalid piece launch quest event shape' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(v_payload->'pieceType') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Invalid piece launch type field' USING ERRCODE='22023';
      END IF;
      IF (v_payload->>'pieceType') NOT IN ('Pawn','Knight','Bishop','Rook','Queen','King') THEN
        RAISE EXCEPTION 'Invalid piece launch type value' USING ERRCODE='22023';
      END IF;
      IF v_source = 'online' THEN
        IF NOT public._quest_has_only_keys(v_identity,ARRAY['matchId','turnIndex'])
           OR NOT (v_identity ?& ARRAY['matchId','turnIndex']) THEN
          RAISE EXCEPTION 'Invalid online piece launch identity shape' USING ERRCODE='22023';
        END IF;
        IF jsonb_typeof(v_identity->'matchId') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_identity->'turnIndex') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'Invalid online piece launch identity field types' USING ERRCODE='22023';
        END IF;
        IF (v_identity->>'matchId') !~ '^[A-Za-z0-9-]{8,128}$'
           OR (v_identity->>'turnIndex') !~ '^(0|[1-9][0-9]*)$'
           OR (v_identity->>'turnIndex')::numeric > 2147483647 THEN
          RAISE EXCEPTION 'Invalid online piece launch identity values' USING ERRCODE='22023';
        END IF;
        v_expected_event_id := 'quest:online-launch:'||(v_identity->>'matchId')||':'||(v_identity->>'turnIndex');
      ELSE
        IF NOT public._quest_has_only_keys(v_identity,ARRAY['runId','launchOrdinal'])
           OR NOT (v_identity ?& ARRAY['runId','launchOrdinal']) THEN
          RAISE EXCEPTION 'Invalid local piece launch identity shape' USING ERRCODE='22023';
        END IF;
        IF jsonb_typeof(v_identity->'runId') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_identity->'launchOrdinal') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'Invalid local piece launch identity field types' USING ERRCODE='22023';
        END IF;
        IF (v_identity->>'runId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR (v_identity->>'launchOrdinal') !~ '^[1-9][0-9]*$'
           OR (v_identity->>'launchOrdinal')::numeric > 9007199254740991 THEN
          RAISE EXCEPTION 'Invalid local piece launch identity values' USING ERRCODE='22023';
        END IF;
        v_expected_event_id := 'quest:launch:'||(v_identity->>'runId')||':'||(v_identity->>'launchOrdinal');
      END IF;
    END IF;
    IF v_event_id IS DISTINCT FROM v_expected_event_id
       OR length(v_expected_event_id) > 160 OR octet_length(v_expected_event_id) > 160 THEN
      RAISE EXCEPTION 'Quest event identifier is not canonical' USING ERRCODE='22023';
    END IF;

    v_period_acks := '[]'::jsonb;
    v_any_active := false;
    v_seen_daily := false;
    v_seen_weekly := false;
    FOR v_requested_item IN SELECT value FROM jsonb_array_elements(v_requested)
    LOOP
      IF NOT public._quest_has_only_keys(v_requested_item,ARRAY['periodId','cadence'])
         OR NOT (v_requested_item ?& ARRAY['periodId','cadence']) THEN
        RAISE EXCEPTION 'Malformed requested quest period' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(v_requested_item->'periodId') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_requested_item->'cadence') IS DISTINCT FROM 'string'
         OR (v_requested_item->>'cadence') NOT IN ('daily','weekly') THEN
        RAISE EXCEPTION 'Requested quest period fields have invalid JSON types or values' USING ERRCODE='22023';
      END IF;
      IF ((v_requested_item->>'cadence') = 'daily' AND v_seen_daily)
         OR ((v_requested_item->>'cadence') = 'weekly' AND v_seen_weekly) THEN
        RAISE EXCEPTION 'Requested quest period cadences must be unique' USING ERRCODE='22023';
      END IF;
      v_seen_daily := v_seen_daily OR (v_requested_item->>'cadence') = 'daily';
      v_seen_weekly := v_seen_weekly OR (v_requested_item->>'cadence') = 'weekly';
      v_period := public._quest_ensure_period(v_requested_item->>'periodId',v_requested_item->>'cadence',v_now);
      IF (v_event->>'occurredAtClient')::timestamptz < v_period.starts_at
         OR (v_event->>'occurredAtClient')::timestamptz >= v_period.ends_at THEN
        RAISE EXCEPTION 'Quest event timestamp does not belong to requested period %',v_period.period_id USING ERRCODE='22023';
      END IF;
      IF v_period.starts_at <= v_now AND v_period.ends_at > v_now THEN
        v_any_active := true;
        v_applied := public._quest_apply_event(v_caller,v_period,v_event,v_now);
        v_period_acks := v_period_acks || jsonb_build_array(jsonb_build_object(
          'periodId',v_period.period_id,'disposition','applied','appliedQuestIds',to_jsonb(v_applied),'reason',NULL
        ));
      ELSE
        v_period_acks := v_period_acks || jsonb_build_array(jsonb_build_object(
          'periodId',v_period.period_id,'disposition','stale','appliedQuestIds','[]'::jsonb,'reason','period-closed'
        ));
      END IF;
    END LOOP;
    v_classification := CASE WHEN v_any_active THEN 'accepted' ELSE 'stale' END;
    v_evidence_classification := CASE WHEN v_kind = 'pvp-win' THEN 'settled-match' ELSE 'client-reported' END;
    INSERT INTO public.account_quest_events(
      user_id,event_id,canonical_input,canonical_md5,received_at,classification,evidence_classification,period_acknowledgements
    ) VALUES (
      v_caller,v_event_id,v_event,md5(v_event::text),v_now,v_classification,v_evidence_classification,v_period_acks
    );
    v_ack := jsonb_build_object('eventId',v_event_id,'disposition',v_classification,'duplicate',false,'periods',v_period_acks);
    v_acks := v_acks || jsonb_build_array(v_ack);
  END LOOP;

  RETURN public._quest_snapshot(v_caller,v_now) || jsonb_build_object('acknowledgements',v_acks);
END;
$$;

REVOKE ALL ON FUNCTION public._quest_has_only_keys(jsonb,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_is_utc_iso(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_definitions(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_period_id(text,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_ensure_period(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_ensure_active_periods(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_ensure_progress(uuid,public.quest_periods,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_apply_event(uuid,public.quest_periods,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quest_snapshot(uuid,timestamptz) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_quest_snapshot_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quest_snapshot_v1(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_quest_events_v1(jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quest_events_v1(jsonb,uuid) TO authenticated;

SELECT 'quest_mvp_applied' AS migration_status;

COMMIT;
