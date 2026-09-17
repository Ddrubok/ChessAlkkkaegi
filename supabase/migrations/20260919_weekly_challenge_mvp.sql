begin;

do $preflight$
begin
  if pg_catalog.to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception using errcode = '0A000', message = 'weekly challenge requires pg_catalog.sha256(bytea)';
  end if;
  if pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception using errcode = '0A000', message = 'weekly challenge requires pg_catalog.gen_random_uuid()';
  end if;
end
$preflight$;

create table if not exists public.weekly_challenge_weeks (
  week_id text primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  definition_id text not null,
  definition_revision integer not null,
  ruleset_version text not null,
  stage_layout_version text not null,
  physics_version text not null,
  ai_version text not null,
  definition_hash text not null unique,
  stage_count integer not null,
  player_side text not null,
  research_enabled boolean not null,
  card_effect_scale numeric not null,
  enemy_stage_buff_scale numeric not null,
  priority_slots jsonb not null,
  fallback_order jsonb not null,
  definition jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint weekly_challenge_weeks_interval check (ends_at > starts_at),
  constraint weekly_challenge_weeks_hash check (definition_hash ~ '^[0-9a-f]{64}$'),
  constraint weekly_challenge_weeks_fixed check (
    definition_id = 'W01' and definition_revision = 1 and
    ruleset_version = 'weekly-w01-r1' and stage_count = 10 and
    player_side = 'white' and research_enabled = false and
    card_effect_scale = 1 and enemy_stage_buff_scale = 1
  ),
  constraint weekly_challenge_weeks_definition_size check (pg_catalog.octet_length(definition::text) <= 16384)
);

create table if not exists public.account_weekly_challenge_attempts (
  attempt_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id text not null references public.weekly_challenge_weeks(week_id),
  definition_id text not null,
  definition_revision integer not null,
  definition_hash text not null,
  status text not null,
  revision bigint not null default 0,
  owner_session_id uuid,
  owner_fence bigint not null default 0,
  current_stage integer not null default 1,
  completed_stages integer not null default 0,
  completed_stage_own_turns bigint not null default 0,
  acknowledged_stage_own_turns integer not null default 0,
  acknowledged_action_count integer not null default 0,
  pending_action jsonb,
  boundary_checkpoint jsonb not null,
  finished_at timestamptz,
  ended_by text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint account_weekly_attempt_status check (status in ('ready-for-stage','awaiting-card','playing','pending-action','finished','terminated','expired')),
  constraint account_weekly_attempt_revision check (revision between 0 and 2147483647),
  constraint account_weekly_attempt_fence check (owner_fence between 0 and 2147483647),
  constraint account_weekly_attempt_stage check (current_stage between 1 and 10),
  constraint account_weekly_attempt_score check (completed_stages between 0 and 10 and completed_stage_own_turns between 0 and 2147483647),
  constraint account_weekly_attempt_stage_counts check (acknowledged_stage_own_turns between 0 and 2147483647 and acknowledged_action_count between 0 and 2147483647),
  constraint account_weekly_attempt_pending check ((status = 'pending-action') = (pending_action is not null)),
  constraint account_weekly_attempt_ended check (ended_by is null or ended_by in ('white-win','black-win','draw','terminated')),
  constraint account_weekly_attempt_checkpoint_size check (pg_catalog.octet_length(boundary_checkpoint::text) <= 8192),
  constraint account_weekly_attempt_pending_size check (pending_action is null or pg_catalog.octet_length(pending_action::text) <= 3072)
);

create unique index if not exists account_weekly_challenge_one_active
  on public.account_weekly_challenge_attempts(user_id)
  where status in ('ready-for-stage','awaiting-card','playing','pending-action');
create index if not exists account_weekly_challenge_attempt_user_week
  on public.account_weekly_challenge_attempts(user_id, week_id, created_at desc);

create table if not exists public.account_weekly_challenge_attempt_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  attempt_id uuid references public.account_weekly_challenge_attempts(attempt_id) on delete cascade,
  operation text not null,
  sequence integer,
  canonical_input jsonb not null,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, client_request_id),
  constraint account_weekly_event_operation check (operation in ('begin','control','action-begin','action-ack','stage-result','card-pick')),
  constraint account_weekly_event_sequence check (sequence is null or sequence between 0 and 2147483647),
  constraint account_weekly_event_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint account_weekly_event_input_size check (pg_catalog.octet_length(canonical_input::text) <= 4096),
  constraint account_weekly_event_receipt_size check (pg_catalog.octet_length(receipt::text) <= 8192)
);

create index if not exists account_weekly_challenge_events_attempt
  on public.account_weekly_challenge_attempt_events(user_id, attempt_id, created_at);

create table if not exists public.account_weekly_challenge_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id text not null references public.weekly_challenge_weeks(week_id),
  definition_hash text not null,
  completed_stages integer not null,
  completed_stage_own_turns bigint not null,
  source_attempt_id uuid not null references public.account_weekly_challenge_attempts(attempt_id),
  achieved_at timestamptz not null,
  primary key (user_id, week_id, definition_hash),
  constraint account_weekly_record_score check (completed_stages between 1 and 10 and completed_stage_own_turns between 0 and 2147483647),
  constraint account_weekly_record_hash check (definition_hash ~ '^[0-9a-f]{64}$')
);

alter table public.weekly_challenge_weeks enable row level security;
alter table public.account_weekly_challenge_attempts enable row level security;
alter table public.account_weekly_challenge_attempt_events enable row level security;
alter table public.account_weekly_challenge_records enable row level security;

create or replace function public._weekly_challenge_deny_week_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'weekly challenge definitions are immutable';
end
$function$;

create or replace function public._weekly_challenge_validate_event(p_event jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare v_kind text; v_action_kind text;
begin
  if p_event is null or pg_catalog.jsonb_typeof(p_event) is distinct from 'object'
     or pg_catalog.octet_length(p_event::text)>3072
     or not public._weekly_challenge_is_uuid(p_event->'clientEventId')
     or pg_catalog.jsonb_typeof(p_event->'kind') is distinct from 'string' then
    raise exception using errcode='22023', message='malformed weekly challenge event';
  end if;
  v_kind:=p_event->>'kind';
  if v_kind='action-begin' then
    if not public._weekly_challenge_json_keys(p_event,array['clientEventId','kind','actionId','actionKind','stage','playerTurn','commandId'])
       or not public._weekly_challenge_is_uuid(p_event->'actionId') or not public._weekly_challenge_is_uuid(p_event->'commandId')
       or pg_catalog.jsonb_typeof(p_event->'actionKind') is distinct from 'string'
       or not public._weekly_challenge_is_int(p_event->'stage',1,10) or not (p_event ? 'playerTurn') then
      raise exception using errcode='22023', message='malformed action-begin event';
    end if;
    v_action_kind:=p_event->>'actionKind';
    if v_action_kind not in ('launch','king-swap','king-defense')
       or (v_action_kind='launch' and not public._weekly_challenge_is_int(p_event->'playerTurn',1,2147483647))
       or (v_action_kind<>'launch' and pg_catalog.jsonb_typeof(p_event->'playerTurn') is distinct from 'null') then
      raise exception using errcode='22023', message='invalid action-begin scalar';
    end if;
  elsif v_kind='action-ack' then
    if not public._weekly_challenge_json_keys(p_event,array['clientEventId','kind','actionId','stage','playerTurn','forced','postStateHash'])
       or not public._weekly_challenge_is_uuid(p_event->'actionId') or not public._weekly_challenge_is_int(p_event->'stage',1,10)
       or not (p_event ? 'playerTurn') or not (p_event ? 'forced')
       or pg_catalog.jsonb_typeof(p_event->'playerTurn') not in ('number','null')
       or pg_catalog.jsonb_typeof(p_event->'forced') not in ('boolean','null') then
      raise exception using errcode='22023', message='malformed action-ack event';
    end if;
    if pg_catalog.jsonb_typeof(p_event->'playerTurn')='number' and not public._weekly_challenge_is_int(p_event->'playerTurn',1,2147483647) then
      raise exception using errcode='22023', message='invalid action-ack player turn';
    end if;
    if p_event ? 'postStateHash' and (pg_catalog.jsonb_typeof(p_event->'postStateHash') is distinct from 'string' or (p_event->>'postStateHash') !~ '^[0-9a-f]{64}$') then
      raise exception using errcode='22023', message='invalid action-ack state hash';
    end if;
  elsif v_kind='stage-result' then
    if not public._weekly_challenge_json_keys(p_event,array['clientEventId','kind','stage','outcome'])
       or not public._weekly_challenge_is_int(p_event->'stage',1,10)
       or pg_catalog.jsonb_typeof(p_event->'outcome') is distinct from 'string'
       or (p_event->>'outcome') not in ('white-win','black-win','draw') then
      raise exception using errcode='22023', message='malformed stage-result event';
    end if;
  elsif v_kind='card-pick' then
    if not public._weekly_challenge_json_keys(p_event,array['clientEventId','kind','completedStage','offerId','cardId'])
       or not public._weekly_challenge_is_int(p_event->'completedStage',1,9)
       or not public._weekly_challenge_is_uuid(p_event->'offerId')
       or pg_catalog.jsonb_typeof(p_event->'cardId') is distinct from 'string'
       or (p_event->>'cardId') not in ('force','weight','size','giantPawn','proneStart') then
      raise exception using errcode='22023', message='malformed card-pick event';
    end if;
  else
    raise exception using errcode='22023', message='unknown weekly challenge event kind';
  end if;
  return v_kind;
end
$function$;

create or replace function public._weekly_challenge_event_receipt(p_core jsonb, p_index integer, p_duplicate boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('eventIndex',p_index,'clientEventId',p_core->>'clientEventId',
    'disposition',case when p_duplicate then 'duplicate' else 'applied' end,
    'revisionAfter',(p_core->>'revisionAfter')::bigint,'result',p_core->>'result',
    'checkpointSeq',(p_core->>'checkpointSeq')::integer,'score',p_core->'score')
$function$;

create or replace function public.append_weekly_challenge_attempt_events_v1(
  p_attempt_id uuid, p_expected_revision bigint, p_client_session_id uuid, p_events jsonb, p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid; v_now timestamptz := pg_catalog.clock_timestamp();
  v_attempt public.account_weekly_challenge_attempts; v_existing public.account_weekly_challenge_attempt_events;
  v_event jsonb; v_canonical jsonb; v_core jsonb; v_receipts jsonb := '[]'::jsonb;
  v_seen jsonb := '{}'::jsonb; v_new_ids jsonb := '{}'::jsonb; v_duplicate_receipts jsonb := '[]'::jsonb;
  v_event_id text; v_index integer; v_count integer; v_new_count integer:=0; v_first_new_index integer; v_kind text; v_code text;
  v_checkpoint_seq integer; v_checkpoint jsonb; v_score jsonb; v_pending jsonb; v_offer jsonb; v_offer_id uuid; v_cards jsonb;
  v_new_completed integer; v_new_turns bigint; v_revision bigint; v_result text;
  v_action_kind text; v_player_turn integer; v_record public.account_weekly_challenge_records;
begin
  v_user:=public._weekly_challenge_auth(p_expected_user_id);
  if p_attempt_id is null or p_client_session_id is null or p_expected_revision is null
     or p_expected_revision not between 0 and 2147483647
     or p_events is null or pg_catalog.jsonb_typeof(p_events) is distinct from 'array'
     or pg_catalog.octet_length(p_events::text)>24576 then
    raise exception using errcode='22023', message='invalid weekly challenge event batch';
  end if;
  v_count:=pg_catalog.jsonb_array_length(p_events);
  if v_count not between 1 and 8 then raise exception using errcode='22023', message='weekly challenge batch must contain 1 to 8 events'; end if;

  -- Full shape and ledger-collision preflight precedes every mutation.
  for v_index in 0..v_count-1 loop
    v_event:=p_events->v_index;
    v_kind:=public._weekly_challenge_validate_event(v_event);
    v_event_id:=(v_event->>'clientEventId')::uuid::text;
    v_canonical:=pg_catalog.jsonb_build_object('operation',v_kind,'attemptId',p_attempt_id::text,'event',v_event);
    if v_seen ? v_event_id then
      if v_seen->v_event_id is distinct from v_canonical then
        return pg_catalog.jsonb_build_object('ok',false,'code','EVENT_ID_PAYLOAD_MISMATCH','serverNow',public._weekly_challenge_iso(v_now),
          'rejectedEventIndex',v_index,'receipts','[]'::jsonb,'snapshot',null);
      end if;
    else
      v_seen:=pg_catalog.jsonb_set(v_seen,array[v_event_id],v_canonical,true);
    end if;
    select * into v_existing from public.account_weekly_challenge_attempt_events
      where user_id=v_user and client_request_id=v_event_id::uuid;
    if found then
      if v_existing.canonical_input is distinct from v_canonical then
        return pg_catalog.jsonb_build_object('ok',false,'code','EVENT_ID_PAYLOAD_MISMATCH','serverNow',public._weekly_challenge_iso(v_now),
          'rejectedEventIndex',v_index,'receipts','[]'::jsonb,'snapshot',null);
      end if;
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,91374621));
  v_now:=pg_catalog.clock_timestamp();
  -- Recheck under the per-account lock to close the concurrent first-insert race.
  v_seen:='{}'::jsonb; v_new_ids:='{}'::jsonb; v_new_count:=0; v_first_new_index:=null;
  for v_index in 0..v_count-1 loop
    v_event:=p_events->v_index;
    v_kind:=v_event->>'kind'; v_event_id:=(v_event->>'clientEventId')::uuid::text;
    v_canonical:=pg_catalog.jsonb_build_object('operation',v_kind,'attemptId',p_attempt_id::text,'event',v_event);
    if v_seen ? v_event_id then
      if v_seen->v_event_id is distinct from v_canonical then
        return pg_catalog.jsonb_build_object('ok',false,'code','EVENT_ID_PAYLOAD_MISMATCH','serverNow',public._weekly_challenge_iso(v_now),
          'rejectedEventIndex',v_index,'receipts','[]'::jsonb,'snapshot',null);
      end if;
    else
      v_seen:=pg_catalog.jsonb_set(v_seen,array[v_event_id],v_canonical,true);
    end if;
    select * into v_existing from public.account_weekly_challenge_attempt_events
      where user_id=v_user and client_request_id=v_event_id::uuid;
    if found and v_existing.canonical_input is distinct from v_canonical then
      return pg_catalog.jsonb_build_object('ok',false,'code','EVENT_ID_PAYLOAD_MISMATCH','serverNow',public._weekly_challenge_iso(v_now),
        'rejectedEventIndex',v_index,'receipts','[]'::jsonb,'snapshot',null);
    end if;
    if found then
      v_duplicate_receipts:=v_duplicate_receipts || pg_catalog.jsonb_build_array(public._weekly_challenge_event_receipt(v_existing.receipt,v_index,true));
    elsif not (v_new_ids ? v_event_id) then
      v_new_ids:=pg_catalog.jsonb_set(v_new_ids,array[v_event_id],'true'::jsonb,true);
      v_new_count:=v_new_count+1;
      if v_first_new_index is null then v_first_new_index:=v_index; end if;
    end if;
  end loop;
  select * into v_attempt from public.account_weekly_challenge_attempts where attempt_id=p_attempt_id and user_id=v_user for update;
  if v_new_count=0 then
    return pg_catalog.jsonb_build_object('ok',true,'code','OK','serverNow',public._weekly_challenge_iso(v_now),'data',
      pg_catalog.jsonb_build_object('receipts',v_duplicate_receipts,'snapshot',case when v_attempt.attempt_id is null then null else public._weekly_challenge_attempt_wire(v_attempt) end));
  end if;

  perform public._weekly_challenge_expire(v_user,v_now);
  select * into v_attempt from public.account_weekly_challenge_attempts where attempt_id=p_attempt_id and user_id=v_user for update;
  if not found then v_code:='ATTEMPT_NOT_FOUND';
  elsif v_attempt.status='expired' then v_code:='WEEK_EXPIRED';
  elsif v_attempt.status in ('finished','terminated') then v_code:='ATTEMPT_FINISHED';
  elsif v_attempt.revision is distinct from p_expected_revision then v_code:='STALE_REVISION';
  elsif v_attempt.owner_session_id is distinct from p_client_session_id then v_code:='NOT_ATTEMPT_OWNER'; end if;
  if v_code is null and v_attempt.revision + v_new_count > 2147483647 then v_code:='INVALID_TRANSITION'; end if;
  if v_code is not null then
    return pg_catalog.jsonb_build_object('ok',false,'code',v_code,'serverNow',public._weekly_challenge_iso(v_now),
      'rejectedEventIndex',v_first_new_index,'receipts',v_duplicate_receipts,
      'snapshot',case when v_attempt.attempt_id is null then null else public._weekly_challenge_attempt_wire(v_attempt) end);
  end if;

  for v_index in 0..v_count-1 loop
    v_event:=p_events->v_index; v_kind:=v_event->>'kind';
    v_canonical:=pg_catalog.jsonb_build_object('operation',v_kind,'attemptId',p_attempt_id::text,'event',v_event);
    select * into v_existing from public.account_weekly_challenge_attempt_events
      where user_id=v_user and client_request_id=(v_event->>'clientEventId')::uuid;
    if found then
      v_receipts:=v_receipts || pg_catalog.jsonb_build_array(public._weekly_challenge_event_receipt(v_existing.receipt,v_index,true));
      continue;
    end if;
    v_code:=null; v_result:=null;

    if v_kind='action-begin' then
      v_action_kind:=v_event->>'actionKind';
      if v_attempt.status='pending-action' then v_code:='PENDING_ACTION';
      elsif v_attempt.status not in ('ready-for-stage','playing') then v_code:='INVALID_TRANSITION';
      elsif (v_event->>'stage')::integer is distinct from v_attempt.current_stage then v_code:='INVALID_TRANSITION';
      elsif v_action_kind='launch' and (v_event->>'playerTurn')::bigint is distinct from v_attempt.acknowledged_stage_own_turns::bigint+1 then v_code:='INVALID_TRANSITION';
      end if;
      if v_code is null then
        v_pending:=pg_catalog.jsonb_build_object('actionId',v_event->>'actionId','beginRequestId',v_event->>'clientEventId',
          'kind',v_action_kind,'stage',v_attempt.current_stage,'playerTurn',v_event->'playerTurn',
          'commandId',v_event->>'commandId','begunAt',public._weekly_challenge_iso(v_now));
        update public.account_weekly_challenge_attempts set status='pending-action',pending_action=v_pending,
          revision=revision+1,updated_at=v_now where attempt_id=p_attempt_id returning * into v_attempt;
        v_result:='action-begun';
      end if;
    elsif v_kind='action-ack' then
      if v_attempt.status<>'pending-action' or v_attempt.pending_action is null then v_code:='INVALID_TRANSITION';
      elsif v_event->>'actionId' is distinct from v_attempt.pending_action->>'actionId'
         or (v_event->>'stage')::integer is distinct from (v_attempt.pending_action->>'stage')::integer
         or v_event->'playerTurn' is distinct from v_attempt.pending_action->'playerTurn' then v_code:='INVALID_TRANSITION';
      elsif v_attempt.pending_action->>'kind'='launch' and pg_catalog.jsonb_typeof(v_event->'forced') is distinct from 'boolean' then v_code:='INVALID_TRANSITION';
      elsif v_attempt.pending_action->>'kind'<>'launch' and pg_catalog.jsonb_typeof(v_event->'forced') is distinct from 'null' then v_code:='INVALID_TRANSITION';
      elsif v_attempt.acknowledged_action_count=2147483647 then v_code:='INVALID_TRANSITION';
      end if;
      if v_code is null then
        v_player_turn:=case when v_attempt.pending_action->>'kind'='launch' then (v_attempt.pending_action->>'playerTurn')::integer else 0 end;
        update public.account_weekly_challenge_attempts set status='playing',pending_action=null,
          acknowledged_action_count=acknowledged_action_count+1,
          acknowledged_stage_own_turns=case when v_player_turn>0 then v_player_turn else acknowledged_stage_own_turns end,
          revision=revision+1,updated_at=v_now where attempt_id=p_attempt_id returning * into v_attempt;
        v_result:='action-acknowledged';
      end if;
    elsif v_kind='stage-result' then
      if v_attempt.status='pending-action' then v_code:='PENDING_ACTION';
      elsif v_attempt.status not in ('ready-for-stage','playing') or (v_event->>'stage')::integer is distinct from v_attempt.current_stage then v_code:='INVALID_STAGE_RESULT';
      elsif v_event->>'outcome'='white-win' and v_attempt.acknowledged_stage_own_turns<1 then v_code:='INVALID_STAGE_RESULT';
      end if;
      if v_code is null and v_event->>'outcome'='white-win' then
        v_new_completed:=v_attempt.completed_stages+1;
        v_new_turns:=v_attempt.completed_stage_own_turns+v_attempt.acknowledged_stage_own_turns;
        if v_new_turns>2147483647 then v_code:='INVALID_STAGE_RESULT';
        elsif v_attempt.current_stage=10 then
          update public.account_weekly_challenge_attempts set status='finished',completed_stages=v_new_completed,
            completed_stage_own_turns=v_new_turns,revision=revision+1,finished_at=v_now,ended_by='white-win',updated_at=v_now
            where attempt_id=p_attempt_id returning * into v_attempt;
          v_result:='attempt-finished';
        else
          v_cards:=v_attempt.boundary_checkpoint->'cards';
          v_offer:=public._weekly_challenge_offer(v_cards,v_attempt.current_stage);
          if pg_catalog.jsonb_array_length(v_offer)=0 then
            v_checkpoint_seq:=(v_attempt.boundary_checkpoint->>'checkpointSeq')::integer+1;
            v_checkpoint:=pg_catalog.jsonb_build_object('schemaVersion',1,'checkpointSeq',v_checkpoint_seq,'boundary','ready-for-stage',
              'stageToPlay',v_attempt.current_stage+1,'score',pg_catalog.jsonb_build_object('completedStages',v_new_completed,'completedStageOwnTurns',v_new_turns),
              'cards',v_cards,'pendingOffer',null);
            update public.account_weekly_challenge_attempts set status='ready-for-stage',current_stage=current_stage+1,
              completed_stages=v_new_completed,completed_stage_own_turns=v_new_turns,acknowledged_stage_own_turns=0,
              acknowledged_action_count=0,boundary_checkpoint=v_checkpoint,revision=revision+1,updated_at=v_now
              where attempt_id=p_attempt_id returning * into v_attempt;
          else
            v_offer_id:=pg_catalog.gen_random_uuid();
            v_checkpoint_seq:=(v_attempt.boundary_checkpoint->>'checkpointSeq')::integer+1;
            v_checkpoint:=pg_catalog.jsonb_build_object('schemaVersion',1,'checkpointSeq',v_checkpoint_seq,'boundary','awaiting-card',
              'stageToPlay',v_attempt.current_stage,'score',pg_catalog.jsonb_build_object('completedStages',v_new_completed,'completedStageOwnTurns',v_new_turns),
              'cards',v_cards,'pendingOffer',pg_catalog.jsonb_build_object('offerId',v_offer_id::text,'completedStage',v_attempt.current_stage,'choices',v_offer));
            update public.account_weekly_challenge_attempts set status='awaiting-card',completed_stages=v_new_completed,
              completed_stage_own_turns=v_new_turns,boundary_checkpoint=v_checkpoint,revision=revision+1,updated_at=v_now
              where attempt_id=p_attempt_id returning * into v_attempt;
          end if;
          v_result:='stage-cleared';
        end if;
        if v_code is null then
          insert into public.account_weekly_challenge_records(user_id,week_id,definition_hash,completed_stages,completed_stage_own_turns,source_attempt_id,achieved_at)
          values(v_user,v_attempt.week_id,v_attempt.definition_hash,v_attempt.completed_stages,v_attempt.completed_stage_own_turns,v_attempt.attempt_id,v_now)
          on conflict (user_id,week_id,definition_hash) do update set
            completed_stages=excluded.completed_stages,completed_stage_own_turns=excluded.completed_stage_own_turns,
            source_attempt_id=excluded.source_attempt_id,achieved_at=excluded.achieved_at
          where excluded.completed_stages>public.account_weekly_challenge_records.completed_stages
             or (excluded.completed_stages=public.account_weekly_challenge_records.completed_stages
                 and excluded.completed_stage_own_turns<public.account_weekly_challenge_records.completed_stage_own_turns);
        end if;
      elsif v_code is null then
        update public.account_weekly_challenge_attempts set status='finished',revision=revision+1,finished_at=v_now,
          ended_by=v_event->>'outcome',owner_session_id=null,updated_at=v_now where attempt_id=p_attempt_id returning * into v_attempt;
        v_result:='stage-finished';
      end if;
    else
      if v_attempt.status<>'awaiting-card' then v_code:='INVALID_TRANSITION';
      elsif (v_event->>'completedStage')::integer is distinct from v_attempt.current_stage
         or v_event->>'offerId' is distinct from v_attempt.boundary_checkpoint#>>'{pendingOffer,offerId}'
         or not ((v_attempt.boundary_checkpoint#>'{pendingOffer,choices}') ? (v_event->>'cardId')) then v_code:='INVALID_CARD_PICK';
      end if;
      if v_code is null then
        v_cards:=public._weekly_challenge_apply_card(v_attempt.boundary_checkpoint->'cards',v_event->>'cardId');
        if v_cards is null then v_code:='INVALID_CARD_PICK';
        else
          v_checkpoint_seq:=(v_attempt.boundary_checkpoint->>'checkpointSeq')::integer+1;
          v_checkpoint:=pg_catalog.jsonb_build_object('schemaVersion',1,'checkpointSeq',v_checkpoint_seq,'boundary','ready-for-stage',
            'stageToPlay',v_attempt.current_stage+1,'score',v_attempt.boundary_checkpoint->'score','cards',v_cards,'pendingOffer',null);
          update public.account_weekly_challenge_attempts set status='ready-for-stage',current_stage=current_stage+1,
            acknowledged_stage_own_turns=0,acknowledged_action_count=0,boundary_checkpoint=v_checkpoint,
            revision=revision+1,updated_at=v_now where attempt_id=p_attempt_id returning * into v_attempt;
          v_result:='card-picked';
        end if;
      end if;
    end if;

    if v_code is not null then
      return pg_catalog.jsonb_build_object('ok',false,'code',v_code,'serverNow',public._weekly_challenge_iso(v_now),
        'rejectedEventIndex',v_index,'receipts',v_receipts,'snapshot',public._weekly_challenge_attempt_wire(v_attempt));
    end if;
    v_checkpoint_seq:=(v_attempt.boundary_checkpoint->>'checkpointSeq')::integer;
    v_score:=pg_catalog.jsonb_build_object('completedStages',v_attempt.completed_stages,'completedStageOwnTurns',v_attempt.completed_stage_own_turns);
    v_core:=pg_catalog.jsonb_build_object('clientEventId',v_event->>'clientEventId','revisionAfter',v_attempt.revision,
      'result',v_result,'checkpointSeq',v_checkpoint_seq,'score',v_score);
    insert into public.account_weekly_challenge_attempt_events(user_id,client_request_id,attempt_id,operation,sequence,canonical_input,payload_hash,receipt)
      values(v_user,(v_event->>'clientEventId')::uuid,p_attempt_id,v_kind,v_attempt.acknowledged_action_count,
        v_canonical,public._weekly_challenge_hash(v_canonical::text),v_core);
    v_receipts:=v_receipts || pg_catalog.jsonb_build_array(public._weekly_challenge_event_receipt(v_core,v_index,false));
  end loop;
  return pg_catalog.jsonb_build_object('ok',true,'code','OK','serverNow',public._weekly_challenge_iso(v_now),'data',
    pg_catalog.jsonb_build_object('receipts',v_receipts,'snapshot',public._weekly_challenge_attempt_wire(v_attempt)));
end
$function$;

create or replace function public._weekly_challenge_default_cards()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select '{"sizeGrade":0,"weightGrade":0,"forceGrade":0,"giantPawn":false,"proneStart":false,"picksSoFar":0}'::jsonb
$function$;

create or replace function public._weekly_challenge_card_eligible(p_cards jsonb, p_card text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case p_card
    when 'force' then (p_cards->>'forceGrade')::integer < 5
    when 'weight' then (p_cards->>'weightGrade')::integer < 5
    when 'size' then (p_cards->>'sizeGrade')::integer < 5 and
      (case (p_cards->>'sizeGrade')::integer when 0 then 0 when 1 then .02 when 2 then .04 when 3 then .07 when 4 then .11 else .15 end) < .2
    when 'giantPawn' then not (p_cards->>'giantPawn')::boolean
    when 'proneStart' then not (p_cards->>'proneStart')::boolean
    else false end
$function$;

create or replace function public._weekly_challenge_offer(p_cards jsonb, p_completed_stage integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_priorities jsonb := '[ ["force","weight","size"], ["weight","size","giantPawn"], ["force","size","proneStart"], ["force","weight","size"], ["force","size","giantPawn"], ["weight","force","proneStart"], ["force","weight","size"], ["force","size","giantPawn"], ["weight","size","proneStart"] ]'::jsonb;
  v_fallback text[] := array['force','weight','size','giantPawn','proneStart'];
  v_chosen text[] := array[]::text[];
  v_slot jsonb;
  v_card text;
  v_preferred text;
  v_pick text;
  v_index integer;
begin
  if p_completed_stage not between 1 and 9 then return '[]'::jsonb; end if;
  v_slot := v_priorities -> (p_completed_stage - 1);
  for v_index in 0..2 loop
    v_pick := null;
    v_preferred := v_slot ->> v_index;
    if not (v_preferred = any(v_chosen)) and public._weekly_challenge_card_eligible(p_cards,v_preferred) then
      v_pick := v_preferred;
    end if;
    if v_pick is null then
      foreach v_card in array v_fallback loop
        if not (v_card = any(v_chosen)) and public._weekly_challenge_card_eligible(p_cards,v_card) then v_pick := v_card; exit; end if;
      end loop;
    end if;
    if v_pick is not null then v_chosen := pg_catalog.array_append(v_chosen,v_pick); end if;
  end loop;
  return pg_catalog.to_jsonb(v_chosen);
end
$function$;

create or replace function public._weekly_challenge_apply_card(p_cards jsonb, p_card text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare v_result jsonb := p_cards;
begin
  if not public._weekly_challenge_card_eligible(p_cards,p_card) then return null; end if;
  if p_card='force' then v_result:=pg_catalog.jsonb_set(v_result,'{forceGrade}',pg_catalog.to_jsonb((p_cards->>'forceGrade')::integer+1));
  elsif p_card='weight' then v_result:=pg_catalog.jsonb_set(v_result,'{weightGrade}',pg_catalog.to_jsonb((p_cards->>'weightGrade')::integer+1));
  elsif p_card='size' then v_result:=pg_catalog.jsonb_set(v_result,'{sizeGrade}',pg_catalog.to_jsonb((p_cards->>'sizeGrade')::integer+1));
  elsif p_card='giantPawn' then v_result:=pg_catalog.jsonb_set(v_result,'{giantPawn}','true'::jsonb);
  elsif p_card='proneStart' then v_result:=pg_catalog.jsonb_set(v_result,'{proneStart}','true'::jsonb);
  else return null; end if;
  return pg_catalog.jsonb_set(v_result,'{picksSoFar}',pg_catalog.to_jsonb((p_cards->>'picksSoFar')::integer+1));
end
$function$;

create or replace function public._weekly_challenge_attempt_wire(p_attempt public.account_weekly_challenge_attempts)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
begin
  return pg_catalog.jsonb_build_object(
    'schemaVersion',1,'attemptId',p_attempt.attempt_id::text,'weekId',p_attempt.week_id,
    'definitionId',p_attempt.definition_id,'definitionRevision',p_attempt.definition_revision,
    'definitionHash',p_attempt.definition_hash,'status',p_attempt.status,'revision',p_attempt.revision,
    'ownerSessionId',case when p_attempt.owner_session_id is null then null else pg_catalog.to_jsonb(p_attempt.owner_session_id::text) end,
    'ownerFence',p_attempt.owner_fence,'currentStage',p_attempt.current_stage,
    'score',pg_catalog.jsonb_build_object('completedStages',p_attempt.completed_stages,'completedStageOwnTurns',p_attempt.completed_stage_own_turns),
    'acknowledgedStageOwnTurns',p_attempt.acknowledged_stage_own_turns,
    'acknowledgedActionCount',p_attempt.acknowledged_action_count,
    'pendingAction',p_attempt.pending_action,'boundaryCheckpoint',p_attempt.boundary_checkpoint,
    'finishedAt',case when p_attempt.finished_at is null then null else pg_catalog.to_jsonb(public._weekly_challenge_iso(p_attempt.finished_at)) end,
    'endedBy',p_attempt.ended_by);
end
$function$;

create or replace function public._weekly_challenge_record_wire(p_record public.account_weekly_challenge_records)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
begin
  return pg_catalog.jsonb_build_object('weekId',p_record.week_id,'definitionHash',p_record.definition_hash,
    'completedStages',p_record.completed_stages,'completedStageOwnTurns',p_record.completed_stage_own_turns,
    'sourceAttemptId',p_record.source_attempt_id::text,'achievedAt',public._weekly_challenge_iso(p_record.achieved_at));
end
$function$;

create or replace function public._weekly_challenge_expire(p_user_id uuid, p_now timestamptz)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.account_weekly_challenge_attempts a
     set status='expired', owner_session_id=null, pending_action=null, updated_at=p_now, revision=revision+1
    from public.weekly_challenge_weeks w
   where a.user_id=p_user_id and a.week_id=w.week_id
     and a.status in ('ready-for-stage','awaiting-card','playing','pending-action') and w.ends_at <= p_now
$function$;

create or replace function public._weekly_challenge_snapshot_data(p_user_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start timestamptz := public._weekly_challenge_week_start(p_now);
  v_current public.weekly_challenge_weeks;
  v_previous public.weekly_challenge_weeks;
  v_attempt public.account_weekly_challenge_attempts;
  v_current_record public.account_weekly_challenge_records;
  v_previous_record public.account_weekly_challenge_records;
begin
  v_current := public._weekly_challenge_ensure_week(v_start);
  v_previous := public._weekly_challenge_ensure_week(v_start - interval '7 days');
  select * into v_attempt from public.account_weekly_challenge_attempts
   where user_id=p_user_id
     and week_id=v_current.week_id
     and definition_id=v_current.definition_id
     and definition_revision=v_current.definition_revision
     and definition_hash=v_current.definition_hash
     and status in ('ready-for-stage','awaiting-card','playing','pending-action')
   order by created_at desc limit 1;
  select * into v_current_record from public.account_weekly_challenge_records where user_id=p_user_id and week_id=v_current.week_id and definition_hash=v_current.definition_hash;
  select * into v_previous_record from public.account_weekly_challenge_records where user_id=p_user_id and week_id=v_previous.week_id and definition_hash=v_previous.definition_hash;
  return pg_catalog.jsonb_build_object(
    'currentWeek',v_current.definition,'previousWeek',v_previous.definition,
    'activeAttempt',case when v_attempt.attempt_id is null then null else public._weekly_challenge_attempt_wire(v_attempt) end,
    'records',pg_catalog.jsonb_build_object(
      'current',case when v_current_record.user_id is null then null else public._weekly_challenge_record_wire(v_current_record) end,
      'previous',case when v_previous_record.user_id is null then null else public._weekly_challenge_record_wire(v_previous_record) end),
    'capabilities',pg_catalog.jsonb_build_object('accountAttempts',true,'boundaryResume',true,'inStageRestore',false));
end
$function$;

create or replace function public.get_weekly_challenge_snapshot_v1(p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_user := public._weekly_challenge_auth(p_expected_user_id);
  return pg_catalog.jsonb_build_object('ok',true,'code','OK','serverNow',public._weekly_challenge_iso(v_now),
    'data',public._weekly_challenge_snapshot_data(v_user,v_now));
end
$function$;

create or replace function public.begin_weekly_challenge_attempt_v1(
  p_week_id text, p_definition_hash text, p_request_id uuid, p_client_session_id uuid, p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid; v_now timestamptz := pg_catalog.clock_timestamp();
  v_start timestamptz := public._weekly_challenge_week_start(v_now);
  v_week public.weekly_challenge_weeks; v_existing public.account_weekly_challenge_attempt_events;
  v_active public.account_weekly_challenge_attempts; v_attempt public.account_weekly_challenge_attempts;
  v_canonical jsonb; v_core jsonb; v_code text; v_attempt_id uuid := pg_catalog.gen_random_uuid();
  v_checkpoint jsonb;
begin
  v_user := public._weekly_challenge_auth(p_expected_user_id);
  if p_week_id is null or p_week_id !~ '^weekly:[0-9]{4}-[0-9]{2}-[0-9]{2}@05:00:Asia/Seoul$'
     or pg_catalog.octet_length(p_week_id)>64 or p_definition_hash is null
     or p_definition_hash !~ '^[0-9a-f]{64}$' or p_request_id is null or p_client_session_id is null then
    raise exception using errcode='22023', message='invalid weekly challenge begin parameters';
  end if;
  v_canonical := pg_catalog.jsonb_build_object('operation','begin','weekId',p_week_id,'definitionHash',p_definition_hash,
    'requestId',p_request_id::text,'clientSessionId',p_client_session_id::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 91374621));
  v_now:=pg_catalog.clock_timestamp();
  v_start:=public._weekly_challenge_week_start(v_now);
  select * into v_existing from public.account_weekly_challenge_attempt_events where user_id=v_user and client_request_id=p_request_id;
  if found then
    if v_existing.canonical_input is distinct from v_canonical then
      return pg_catalog.jsonb_build_object('ok',false,'code','EVENT_ID_PAYLOAD_MISMATCH','serverNow',public._weekly_challenge_iso(v_now));
    end if;
    v_core := v_existing.receipt;
    if (v_core->>'ok')::boolean then
      select * into v_attempt from public.account_weekly_challenge_attempts where attempt_id=v_existing.attempt_id and user_id=v_user;
      v_core := pg_catalog.jsonb_set(v_core,'{data,receipt,disposition}','"duplicate"'::jsonb);
      v_core := pg_catalog.jsonb_set(v_core,'{data,snapshot}',case when v_attempt.attempt_id is null then 'null'::jsonb else public._weekly_challenge_attempt_wire(v_attempt) end);
    else
      if v_existing.attempt_id is not null then
        select * into v_attempt from public.account_weekly_challenge_attempts where attempt_id=v_existing.attempt_id and user_id=v_user;
      else
        select * into v_attempt from public.account_weekly_challenge_attempts where user_id=v_user
          and status in ('ready-for-stage','awaiting-card','playing','pending-action') order by created_at desc limit 1;
      end if;
      v_core := pg_catalog.jsonb_set(v_core,'{snapshot}',case when v_attempt.attempt_id is null then 'null'::jsonb else public._weekly_challenge_attempt_wire(v_attempt) end);
    end if;
    return v_core || pg_catalog.jsonb_build_object('serverNow',public._weekly_challenge_iso(v_now));
  end if;

  v_week := public._weekly_challenge_ensure_week(v_start);
  perform public._weekly_challenge_ensure_week(v_start - interval '7 days');
  perform public._weekly_challenge_expire(v_user,v_now);
  v_code := null;
  if p_week_id is distinct from v_week.week_id then v_code := 'WEEK_NOT_CURRENT';
  elsif p_definition_hash is distinct from v_week.definition_hash then v_code := 'DEFINITION_MISMATCH'; end if;
  if v_code is null then
    select * into v_active from public.account_weekly_challenge_attempts
      where user_id=v_user and status in ('ready-for-stage','awaiting-card','playing','pending-action') for update;
    if found then v_code := 'ACTIVE_ATTEMPT_EXISTS'; end if;
  end if;
  if v_code is not null then
    v_core := pg_catalog.jsonb_build_object('ok',false,'code',v_code,
      'snapshot',case when v_active.attempt_id is null then null else public._weekly_challenge_attempt_wire(v_active) end);
    insert into public.account_weekly_challenge_attempt_events(user_id,client_request_id,attempt_id,operation,canonical_input,payload_hash,receipt)
      values(v_user,p_request_id,case when v_active.attempt_id is null then null else v_active.attempt_id end,'begin',v_canonical,public._weekly_challenge_hash(v_canonical::text),v_core);
    return v_core || pg_catalog.jsonb_build_object('serverNow',public._weekly_challenge_iso(v_now));
  end if;

  v_checkpoint := pg_catalog.jsonb_build_object('schemaVersion',1,'checkpointSeq',0,'boundary','ready-for-stage','stageToPlay',1,
    'score',pg_catalog.jsonb_build_object('completedStages',0,'completedStageOwnTurns',0),
    'cards',public._weekly_challenge_default_cards(),'pendingOffer',null);
  insert into public.account_weekly_challenge_attempts(attempt_id,user_id,week_id,definition_id,definition_revision,definition_hash,
    status,revision,owner_session_id,owner_fence,current_stage,completed_stages,completed_stage_own_turns,
    acknowledged_stage_own_turns,acknowledged_action_count,pending_action,boundary_checkpoint)
  values(v_attempt_id,v_user,v_week.week_id,'W01',1,v_week.definition_hash,'ready-for-stage',0,p_client_session_id,0,1,0,0,0,0,null,v_checkpoint)
  returning * into v_attempt;
  v_core := pg_catalog.jsonb_build_object('ok',true,'code','OK','data',pg_catalog.jsonb_build_object(
    'receipt',pg_catalog.jsonb_build_object('requestId',p_request_id::text,'disposition','started','attemptId',v_attempt_id::text,'revisionAfter',0),
    'snapshot',public._weekly_challenge_attempt_wire(v_attempt)));
  insert into public.account_weekly_challenge_attempt_events(user_id,client_request_id,attempt_id,operation,canonical_input,payload_hash,receipt)
    values(v_user,p_request_id,v_attempt_id,'begin',v_canonical,public._weekly_challenge_hash(v_canonical::text),v_core);
  return v_core || pg_catalog.jsonb_build_object('serverNow',public._weekly_challenge_iso(v_now));
end
$function$;

create or replace function public.control_weekly_challenge_attempt_v1(
  p_attempt_id uuid, p_command text, p_expected_revision bigint, p_request_id uuid,
  p_client_session_id uuid, p_expected_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid; v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing public.account_weekly_challenge_attempt_events; v_attempt public.account_weekly_challenge_attempts;
  v_canonical jsonb; v_core jsonb; v_code text; v_disposition text := 'applied';
begin
  v_user := public._weekly_challenge_auth(p_expected_user_id);
  if p_attempt_id is null or p_request_id is null or p_client_session_id is null
     or p_command is null or p_command not in ('resume','takeover','terminate')
     or p_expected_revision is null or p_expected_revision not between 0 and 2147483647 then
    raise exception using errcode='22023', message='invalid weekly challenge control parameters';
  end if;
  v_canonical := pg_catalog.jsonb_build_object('operation','control','attemptId',p_attempt_id::text,'command',p_command,
    'expectedRevision',p_expected_revision,'requestId',p_request_id::text,'clientSessionId',p_client_session_id::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,91374621));
  v_now:=pg_catalog.clock_timestamp();
  select * into v_existing from public.account_weekly_challenge_attempt_events where user_id=v_user and client_request_id=p_request_id;
  if found then
    if v_existing.canonical_input is distinct from v_canonical then
      return pg_catalog.jsonb_build_object('ok',false,'code','EVENT_ID_PAYLOAD_MISMATCH','serverNow',public._weekly_challenge_iso(v_now));
    end if;
    v_core:=v_existing.receipt;
    select * into v_attempt from public.account_weekly_challenge_attempts where attempt_id=v_existing.attempt_id and user_id=v_user;
    if (v_core->>'ok')::boolean then
      v_core:=pg_catalog.jsonb_set(v_core,'{data,receipt,disposition}','"duplicate"'::jsonb);
      v_core:=pg_catalog.jsonb_set(v_core,'{data,snapshot}',case when v_attempt.attempt_id is null then 'null'::jsonb else public._weekly_challenge_attempt_wire(v_attempt) end);
    else
      v_core:=pg_catalog.jsonb_set(v_core,'{snapshot}',case when v_attempt.attempt_id is null then 'null'::jsonb else public._weekly_challenge_attempt_wire(v_attempt) end);
    end if;
    return v_core || pg_catalog.jsonb_build_object('serverNow',public._weekly_challenge_iso(v_now));
  end if;

  perform public._weekly_challenge_expire(v_user,v_now);
  select * into v_attempt from public.account_weekly_challenge_attempts where attempt_id=p_attempt_id and user_id=v_user for update;
  if not found then v_code:='ATTEMPT_NOT_FOUND';
  elsif v_attempt.revision is distinct from p_expected_revision then v_code:='STALE_REVISION';
  elsif v_attempt.status='expired' then v_code:='WEEK_EXPIRED';
  elsif v_attempt.status in ('finished','terminated') then v_code:='ATTEMPT_FINISHED';
  elsif p_command='resume' and v_attempt.status in ('playing','pending-action') then v_code:='ACTIVE_STAGE_NOT_RESTORABLE';
  elsif p_command='takeover' and v_attempt.status not in ('ready-for-stage','awaiting-card') then v_code:='RECOVERY_HOLD';
  elsif p_command='resume' and v_attempt.status not in ('ready-for-stage','awaiting-card') then v_code:='INVALID_TRANSITION';
  elsif p_command='resume' and v_attempt.owner_session_id is distinct from p_client_session_id then v_code:='NOT_ATTEMPT_OWNER';
  elsif v_attempt.revision=2147483647 then v_code:='INVALID_TRANSITION';
  elsif p_command='takeover' and v_attempt.owner_fence=2147483647 then v_code:='INVALID_TRANSITION';
  end if;

  if v_code is null then
    if p_command='terminate' then
      update public.account_weekly_challenge_attempts set status='terminated',revision=revision+1,owner_session_id=null,
        pending_action=null,finished_at=v_now,ended_by='terminated',updated_at=v_now where attempt_id=p_attempt_id returning * into v_attempt;
    elsif p_command='takeover' then
      update public.account_weekly_challenge_attempts set owner_session_id=p_client_session_id,owner_fence=owner_fence+1,
        revision=revision+1,updated_at=v_now where attempt_id=p_attempt_id returning * into v_attempt;
    else
      update public.account_weekly_challenge_attempts set revision=revision+1,updated_at=v_now
        where attempt_id=p_attempt_id returning * into v_attempt;
    end if;
    v_core:=pg_catalog.jsonb_build_object('ok',true,'code','OK','data',pg_catalog.jsonb_build_object(
      'receipt',pg_catalog.jsonb_build_object('requestId',p_request_id::text,'command',p_command,'disposition',v_disposition,'revisionAfter',v_attempt.revision),
      'snapshot',public._weekly_challenge_attempt_wire(v_attempt)));
  else
    v_core:=pg_catalog.jsonb_build_object('ok',false,'code',v_code,
      'snapshot',case when v_attempt.attempt_id is null then null else public._weekly_challenge_attempt_wire(v_attempt) end);
  end if;
  insert into public.account_weekly_challenge_attempt_events(user_id,client_request_id,attempt_id,operation,canonical_input,payload_hash,receipt)
    values(v_user,p_request_id,case when v_attempt.attempt_id is null then null else v_attempt.attempt_id end,'control',v_canonical,
      public._weekly_challenge_hash(v_canonical::text),v_core);
  return v_core || pg_catalog.jsonb_build_object('serverNow',public._weekly_challenge_iso(v_now));
end
$function$;

drop trigger if exists weekly_challenge_weeks_immutable on public.weekly_challenge_weeks;
create trigger weekly_challenge_weeks_immutable
before update or delete on public.weekly_challenge_weeks
for each row execute function public._weekly_challenge_deny_week_mutation();

create or replace function public._weekly_challenge_auth(p_expected_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_is_anon boolean := pg_catalog.coalesce((auth.jwt()->>'is_anonymous')::boolean,false);
begin
  if v_user_id is null or v_is_anon then
    raise exception using errcode = '42501', message = 'authenticated user required';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'account does not match authenticated user';
  end if;
  return v_user_id;
end
$function$;

create or replace function public._weekly_challenge_iso(p_value timestamptz)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

create or replace function public._weekly_challenge_hash(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')), 'hex')
$function$;

create or replace function public._weekly_challenge_json_keys(p_value jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
     and not exists (
       select 1 from pg_catalog.jsonb_object_keys(p_value) as k(key)
       where not (k.key = any(p_allowed))
     )
$function$;

create or replace function public._weekly_challenge_is_int(p_value jsonb, p_min bigint, p_max bigint)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare v_numeric numeric;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) is distinct from 'number' then return false; end if;
  begin v_numeric := (p_value #>> '{}')::numeric; exception when others then return false; end;
  return v_numeric = pg_catalog.trunc(v_numeric) and v_numeric between p_min and p_max;
end
$function$;

create or replace function public._weekly_challenge_is_uuid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  begin perform (p_value #>> '{}')::uuid; exception when others then return false; end;
  return true;
end
$function$;

create or replace function public._weekly_challenge_week_start(p_now timestamptz)
returns timestamptz
language sql
stable
strict
set search_path = ''
as $function$
  select ((pg_catalog.date_trunc('week', (p_now at time zone 'Asia/Seoul') - interval '5 hours') + interval '5 hours') at time zone 'Asia/Seoul')
$function$;

create or replace function public._weekly_challenge_week_id(p_start timestamptz)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'weekly:' || pg_catalog.to_char(p_start at time zone 'Asia/Seoul', 'YYYY-MM-DD') || '@05:00:Asia/Seoul'
$function$;

create or replace function public._weekly_challenge_definition_text(p_week_id text, p_starts_at timestamptz, p_ends_at timestamptz)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.concat_ws(pg_catalog.chr(10),
    'weekly-challenge-definition-v1',
    'weekId=' || p_week_id,
    'startsAt=' || public._weekly_challenge_iso(p_starts_at),
    'endsAt=' || public._weekly_challenge_iso(p_ends_at),
    'definitionId=W01',
    'definitionRevision=1',
    'rulesetVersion=weekly-w01-r1',
    'stageLayoutVersion=source:688bee1a5e931fba9bfbfd930995e73ab12ec206',
    'physicsVersion=@dimforge/rapier3d-compat:0.19.3',
    'aiVersion=source:688bee1a5e931fba9bfbfd930995e73ab12ec206',
    'stageCount=10', 'playerSide=white', 'researchEnabled=false',
    'cardEffectScale=1', 'enemyStageBuffScale=1',
    'priority.1=force,weight,size', 'priority.2=weight,size,giantPawn',
    'priority.3=force,size,proneStart', 'priority.4=force,weight,size',
    'priority.5=force,size,giantPawn', 'priority.6=weight,force,proneStart',
    'priority.7=force,weight,size', 'priority.8=force,size,giantPawn',
    'priority.9=weight,size,proneStart',
    'fallback=force,weight,size,giantPawn,proneStart')
$function$;

create or replace function public._weekly_challenge_definition_json(p_week_id text, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'weekId',p_week_id,
    'startsAt',public._weekly_challenge_iso(p_starts_at),'endsAt',public._weekly_challenge_iso(p_ends_at),
    'definitionId','W01','definitionRevision',1,'rulesetVersion','weekly-w01-r1',
    'stageLayoutVersion','source:688bee1a5e931fba9bfbfd930995e73ab12ec206',
    'physicsVersion','@dimforge/rapier3d-compat:0.19.3',
    'aiVersion','source:688bee1a5e931fba9bfbfd930995e73ab12ec206',
    'definitionHash',public._weekly_challenge_hash(public._weekly_challenge_definition_text(p_week_id,p_starts_at,p_ends_at)),
    'stageCount',10,'playerSide','white','researchEnabled',false,
    'cardEffectScale',1,'enemyStageBuffScale',1,
    'prioritySlots',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_array('force','weight','size'),pg_catalog.jsonb_build_array('weight','size','giantPawn'),
      pg_catalog.jsonb_build_array('force','size','proneStart'),pg_catalog.jsonb_build_array('force','weight','size'),
      pg_catalog.jsonb_build_array('force','size','giantPawn'),pg_catalog.jsonb_build_array('weight','force','proneStart'),
      pg_catalog.jsonb_build_array('force','weight','size'),pg_catalog.jsonb_build_array('force','size','giantPawn'),
      pg_catalog.jsonb_build_array('weight','size','proneStart')),
    'fallbackOrder',pg_catalog.jsonb_build_array('force','weight','size','giantPawn','proneStart'))
$function$;

create or replace function public._weekly_challenge_ensure_week(p_start timestamptz)
returns public.weekly_challenge_weeks
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_week_id text := public._weekly_challenge_week_id(p_start);
  v_end timestamptz := p_start + interval '7 days';
  v_definition jsonb := public._weekly_challenge_definition_json(v_week_id,p_start,p_start + interval '7 days');
  v_row public.weekly_challenge_weeks;
begin
  insert into public.weekly_challenge_weeks(
    week_id,starts_at,ends_at,definition_id,definition_revision,ruleset_version,
    stage_layout_version,physics_version,ai_version,definition_hash,stage_count,player_side,
    research_enabled,card_effect_scale,enemy_stage_buff_scale,priority_slots,fallback_order,definition)
  values(v_week_id,p_start,v_end,'W01',1,'weekly-w01-r1',
    'source:688bee1a5e931fba9bfbfd930995e73ab12ec206','@dimforge/rapier3d-compat:0.19.3',
    'source:688bee1a5e931fba9bfbfd930995e73ab12ec206',v_definition->>'definitionHash',10,'white',false,1,1,
    v_definition->'prioritySlots',v_definition->'fallbackOrder',v_definition)
  on conflict (week_id) do nothing;
  select * into strict v_row from public.weekly_challenge_weeks where week_id=v_week_id;
  if v_row.definition is distinct from v_definition or v_row.starts_at is distinct from p_start or v_row.ends_at is distinct from v_end then
    raise exception using errcode='55000', message='immutable weekly challenge definition mismatch';
  end if;
  return v_row;
end
$function$;

revoke all on table public.weekly_challenge_weeks from public, anon, authenticated;
revoke all on table public.account_weekly_challenge_attempts from public, anon, authenticated;
revoke all on table public.account_weekly_challenge_attempt_events from public, anon, authenticated;
revoke all on table public.account_weekly_challenge_records from public, anon, authenticated;

revoke all on function public._weekly_challenge_deny_week_mutation() from public, anon, authenticated;
revoke all on function public._weekly_challenge_auth(uuid) from public, anon, authenticated;
revoke all on function public._weekly_challenge_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_hash(text) from public, anon, authenticated;
revoke all on function public._weekly_challenge_json_keys(jsonb,text[]) from public, anon, authenticated;
revoke all on function public._weekly_challenge_is_int(jsonb,bigint,bigint) from public, anon, authenticated;
revoke all on function public._weekly_challenge_is_uuid(jsonb) from public, anon, authenticated;
revoke all on function public._weekly_challenge_week_start(timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_week_id(timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_definition_text(text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_definition_json(text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_ensure_week(timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_default_cards() from public, anon, authenticated;
revoke all on function public._weekly_challenge_card_eligible(jsonb,text) from public, anon, authenticated;
revoke all on function public._weekly_challenge_offer(jsonb,integer) from public, anon, authenticated;
revoke all on function public._weekly_challenge_apply_card(jsonb,text) from public, anon, authenticated;
revoke all on function public._weekly_challenge_attempt_wire(public.account_weekly_challenge_attempts) from public, anon, authenticated;
revoke all on function public._weekly_challenge_record_wire(public.account_weekly_challenge_records) from public, anon, authenticated;
revoke all on function public._weekly_challenge_expire(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_snapshot_data(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public._weekly_challenge_validate_event(jsonb) from public, anon, authenticated;
revoke all on function public._weekly_challenge_event_receipt(jsonb,integer,boolean) from public, anon, authenticated;

revoke all on function public.get_weekly_challenge_snapshot_v1(uuid) from public, anon;
revoke all on function public.begin_weekly_challenge_attempt_v1(text,text,uuid,uuid,uuid) from public, anon;
revoke all on function public.control_weekly_challenge_attempt_v1(uuid,text,bigint,uuid,uuid,uuid) from public, anon;
revoke all on function public.append_weekly_challenge_attempt_events_v1(uuid,bigint,uuid,jsonb,uuid) from public, anon;
grant execute on function public.get_weekly_challenge_snapshot_v1(uuid) to authenticated;
grant execute on function public.begin_weekly_challenge_attempt_v1(text,text,uuid,uuid,uuid) to authenticated;
grant execute on function public.control_weekly_challenge_attempt_v1(uuid,text,bigint,uuid,uuid,uuid) to authenticated;
grant execute on function public.append_weekly_challenge_attempt_events_v1(uuid,bigint,uuid,jsonb,uuid) to authenticated;

commit;
