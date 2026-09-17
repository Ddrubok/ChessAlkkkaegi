-- Profile Banner account-progress capability (banners-v1).
-- Extends mastery domain with account-only PvE achievements and equipment slot banner.
-- Retains source compatibility for legacy (v1) and mastery-only (v2) clients.

BEGIN;

-- Helper to validate and project progress, rewards, preferences for v3 / v2 compatibility.

CREATE OR REPLACE FUNCTION public._validate_mastery_progress_v3(p_serialized text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  root jsonb;
  records jsonb;
  banners jsonb;
  medal_id text;
  medal_record jsonb;
  versions jsonb;
  version_id text;
  version_record jsonb;
  progress jsonb;
  entry_key text;
  entry_value jsonb;
  personal jsonb;
  best jsonb;
  item jsonb;
  entry_limit integer;
  knight jsonb;
  crimson jsonb;
  comeback jsonb;
  enemy_id text;
  enemy_val jsonb;
  event_id text;
  event_val jsonb;
BEGIN
  IF p_serialized IS NULL OR octet_length(p_serialized) > 24576 THEN
    RAISE EXCEPTION 'ca_mastery_progress_v1 exceeds its 24576-byte limit' USING ERRCODE = '22023';
  END IF;

  BEGIN
    root := p_serialized::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid JSON format for ca_mastery_progress_v1' USING ERRCODE = '22023';
  END;

  IF NOT public._account_progress_has_only_keys(root, ARRAY['schemaVersion', 'records', 'banners'])
     OR NOT (root ?& ARRAY['schemaVersion', 'records'])
     OR root->'schemaVersion' <> '1'::jsonb
     OR jsonb_typeof(root->'records') <> 'object' THEN
    RAISE EXCEPTION 'Invalid ca_mastery_progress_v1 envelope' USING ERRCODE = '22023';
  END IF;

  records := root->'records';
  IF (SELECT count(*) FROM jsonb_object_keys(records)) > 8 THEN
    RAISE EXCEPTION 'ca_mastery_progress_v1 has more than 8 medal records' USING ERRCODE = '22023';
  END IF;

  FOR medal_id, medal_record IN SELECT * FROM jsonb_each(records)
  LOOP
    IF medal_id NOT IN ('M01','M02','M03','M04','M05','M06','M07','M08')
       OR NOT public._account_progress_has_only_keys(medal_record, ARRAY['versions'])
       OR NOT (medal_record ? 'versions')
       OR jsonb_typeof(medal_record->'versions') <> 'object' THEN
      RAISE EXCEPTION 'Invalid mastery medal record: %', medal_id USING ERRCODE = '22023';
    END IF;

    versions := medal_record->'versions';
    IF (SELECT count(*) FROM jsonb_object_keys(versions)) > 4 THEN
      RAISE EXCEPTION 'Mastery medal % has more than 4 condition versions', medal_id USING ERRCODE = '22023';
    END IF;

    FOR version_id, version_record IN SELECT * FROM jsonb_each(versions)
    LOOP
      IF version_id !~ '^[1-9][0-9]*$'
         OR length(version_id) > 9
         OR NOT public._account_progress_has_only_keys(version_record, ARRAY['progress','firstAchievedAt','personalRecord'])
         OR NOT (version_record ?& ARRAY['progress','firstAchievedAt','personalRecord'])
         OR jsonb_typeof(version_record->'progress') <> 'object'
         OR jsonb_typeof(version_record->'firstAchievedAt') NOT IN ('string','null')
         OR (jsonb_typeof(version_record->'firstAchievedAt') = 'string'
             AND NOT public._account_progress_is_iso_utc(version_record->>'firstAchievedAt'))
         OR jsonb_typeof(version_record->'personalRecord') NOT IN ('object','null') THEN
        RAISE EXCEPTION 'Invalid condition version %.% envelope', medal_id, version_id USING ERRCODE = '22023';
      END IF;

      personal := version_record->'personalRecord';
      IF jsonb_typeof(personal) = 'object' AND (
        NOT public._account_progress_has_only_keys(personal, ARRAY['value','eventId','at'])
        OR NOT (personal ?& ARRAY['value','eventId','at'])
        OR jsonb_typeof(personal->'value') <> 'number'
        OR (personal->>'value') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
        OR NOT public._account_progress_is_identifier(personal->>'eventId')
        OR NOT public._account_progress_is_iso_utc(personal->>'at')
      ) THEN
        RAISE EXCEPTION 'Invalid personal record for %.%', medal_id, version_id USING ERRCODE = '22023';
      END IF;

      IF version_id <> '1' THEN
        CONTINUE;
      END IF;

      progress := version_record->'progress';

      IF medal_id IN ('M01','M05','M07') THEN
        IF NOT public._account_progress_has_only_keys(progress, ARRAY['eventIds'])
           OR NOT (progress ? 'eventIds')
           OR jsonb_typeof(progress->'eventIds') <> 'object' THEN
          RAISE EXCEPTION 'Invalid event evidence for %', medal_id USING ERRCODE = '22023';
        END IF;

        entry_limit := CASE medal_id WHEN 'M05' THEN 5 ELSE 1 END;
        IF (SELECT count(*) FROM jsonb_object_keys(progress->'eventIds')) > entry_limit THEN
          RAISE EXCEPTION 'Too many event witnesses for %', medal_id USING ERRCODE = '22023';
        END IF;

        FOR entry_key, entry_value IN SELECT * FROM jsonb_each(progress->'eventIds')
        LOOP
          IF NOT public._account_progress_is_identifier(entry_key)
             OR jsonb_typeof(entry_value) <> 'object'
             OR (medal_id IN ('M01','M05') AND (
               NOT public._account_progress_has_only_keys(entry_value, ARRAY['at'])
               OR NOT (entry_value ? 'at')
             ))
             OR (medal_id = 'M07' AND (
               NOT public._account_progress_has_only_keys(entry_value, ARRAY['at','enemyPieceId'])
               OR NOT (entry_value ?& ARRAY['at','enemyPieceId'])
               OR NOT public._account_progress_is_identifier(entry_value->>'enemyPieceId')
             ))
             OR NOT public._account_progress_is_iso_utc(entry_value->>'at') THEN
            RAISE EXCEPTION 'Invalid event witness for %', medal_id USING ERRCODE = '22023';
          END IF;
        END LOOP;

      ELSIF medal_id IN ('M02','M03','M04','M08') THEN
        IF NOT public._account_progress_has_only_keys(progress, ARRAY['targets'])
           OR NOT (progress ? 'targets')
           OR jsonb_typeof(progress->'targets') <> 'object' THEN
          RAISE EXCEPTION 'Invalid target evidence for %', medal_id USING ERRCODE = '22023';
        END IF;

        entry_limit := CASE medal_id WHEN 'M02' THEN 6 ELSE 3 END;
        IF (SELECT count(*) FROM jsonb_object_keys(progress->'targets')) > entry_limit THEN
          RAISE EXCEPTION 'Too many target witnesses for %', medal_id USING ERRCODE = '22023';
        END IF;

        FOR entry_key, entry_value IN SELECT * FROM jsonb_each(progress->'targets')
        LOOP
          IF (medal_id = 'M02' AND entry_key NOT IN ('Pawn','Knight','Bishop','Rook','Queen','King'))
             OR (medal_id IN ('M03','M04') AND entry_key NOT IN ('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'))
             OR (medal_id = 'M08' AND entry_key NOT IN (
               'plain:v1','breakable-perimeter:v1','breakable-perimeter-center-hole:v1',
               'breakable-perimeter-dual-hole:v1','pocket-exits:v1','pinball-pillars:v1'
             ))
             OR NOT public._account_progress_has_only_keys(
               entry_value,
               CASE WHEN medal_id IN ('M03','M04') THEN ARRAY['eventId','at','revision'] ELSE ARRAY['eventId','at'] END
             )
             OR NOT (entry_value ?&
               CASE WHEN medal_id IN ('M03','M04') THEN ARRAY['eventId','at','revision'] ELSE ARRAY['eventId','at'] END
             )
             OR NOT public._account_progress_is_identifier(entry_value->>'eventId')
             OR NOT public._account_progress_is_iso_utc(entry_value->>'at')
             OR (medal_id IN ('M03','M04') AND (
               jsonb_typeof(entry_value->'revision') <> 'number'
               OR (entry_value->>'revision') !~ '^[1-9][0-9]*$'
               OR length(entry_value->>'revision') > 9
             )) THEN
            RAISE EXCEPTION 'Invalid target witness for %', medal_id USING ERRCODE = '22023';
          END IF;
        END LOOP;

      ELSIF medal_id = 'M06' THEN
        IF NOT public._account_progress_has_only_keys(progress, ARRAY['bestDoubleOut'])
           OR NOT (progress ? 'bestDoubleOut')
           OR jsonb_typeof(progress->'bestDoubleOut') NOT IN ('object','null') THEN
          RAISE EXCEPTION 'Invalid bestDoubleOut evidence' USING ERRCODE = '22023';
        END IF;

        best := progress->'bestDoubleOut';
        IF jsonb_typeof(best) = 'object' THEN
          IF NOT public._account_progress_has_only_keys(best, ARRAY['eventId','enemyPieceIds','fallCount','at'])
             OR NOT (best ?& ARRAY['eventId','enemyPieceIds','fallCount','at'])
             OR NOT public._account_progress_is_identifier(best->>'eventId')
             OR jsonb_typeof(best->'enemyPieceIds') <> 'array'
             OR jsonb_array_length(best->'enemyPieceIds') <> 2
             OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(best->'enemyPieceIds')) <> 2
             OR jsonb_typeof(best->'fallCount') <> 'number'
             OR (best->>'fallCount') !~ '^[0-9]+$'
             OR (best->>'fallCount')::numeric < 2
             OR (best->>'fallCount')::numeric > 128
             OR NOT public._account_progress_is_iso_utc(best->>'at') THEN
            RAISE EXCEPTION 'Invalid bestDoubleOut witness' USING ERRCODE = '22023';
          END IF;
          FOR item IN SELECT value FROM jsonb_array_elements(best->'enemyPieceIds')
          LOOP
            IF jsonb_typeof(item) <> 'string'
               OR NOT public._account_progress_is_identifier(item #>> '{}') THEN
              RAISE EXCEPTION 'Invalid enemy piece identifier in bestDoubleOut' USING ERRCODE = '22023';
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Validate banner progress domain if present
  IF root ? 'banners' THEN
    banners := root->'banners';
    IF jsonb_typeof(banners) <> 'object'
       OR NOT public._account_progress_has_only_keys(banners, ARRAY['banner_cosmic_knight', 'banner_crimson_sun', 'banner_hidden_myeongnyang']) THEN
      RAISE EXCEPTION 'Invalid banners domain structure in ca_mastery_progress_v1' USING ERRCODE = '22023';
    END IF;

    IF banners ? 'banner_cosmic_knight' THEN
      knight := banners->'banner_cosmic_knight';
      IF jsonb_typeof(knight) <> 'object'
         OR NOT public._account_progress_has_only_keys(knight, ARRAY['fallenEnemies', 'firstAchievedAt'])
         OR NOT (knight ?& ARRAY['fallenEnemies', 'firstAchievedAt'])
         OR jsonb_typeof(knight->'fallenEnemies') <> 'object'
         OR jsonb_typeof(knight->'firstAchievedAt') NOT IN ('string', 'null')
         OR (jsonb_typeof(knight->'firstAchievedAt') = 'string' AND NOT public._account_progress_is_iso_utc(knight->>'firstAchievedAt'))
         OR (SELECT count(*) FROM jsonb_object_keys(knight->'fallenEnemies')) > 50 THEN
        RAISE EXCEPTION 'Invalid banner_cosmic_knight progress record' USING ERRCODE = '22023';
      END IF;

      FOR enemy_id, enemy_val IN SELECT * FROM jsonb_each(knight->'fallenEnemies')
      LOOP
        IF NOT public._account_progress_is_identifier(enemy_id)
           OR jsonb_typeof(enemy_val) <> 'object'
           OR NOT public._account_progress_has_only_keys(enemy_val, ARRAY['eventId', 'at'])
           OR NOT (enemy_val ?& ARRAY['eventId', 'at'])
           OR NOT public._account_progress_is_identifier(enemy_val->>'eventId')
           OR NOT public._account_progress_is_iso_utc(enemy_val->>'at') THEN
          RAISE EXCEPTION 'Invalid fallen enemy entry in banner_cosmic_knight: %', enemy_id USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    IF banners ? 'banner_crimson_sun' THEN
      crimson := banners->'banner_crimson_sun';
      IF jsonb_typeof(crimson) <> 'object'
         OR NOT public._account_progress_has_only_keys(crimson, ARRAY['bestTripleOut', 'firstAchievedAt'])
         OR NOT (crimson ?& ARRAY['bestTripleOut', 'firstAchievedAt'])
         OR jsonb_typeof(crimson->'bestTripleOut') NOT IN ('object', 'null')
         OR jsonb_typeof(crimson->'firstAchievedAt') NOT IN ('string', 'null')
         OR (jsonb_typeof(crimson->'firstAchievedAt') = 'string' AND NOT public._account_progress_is_iso_utc(crimson->>'firstAchievedAt')) THEN
        RAISE EXCEPTION 'Invalid banner_crimson_sun progress record' USING ERRCODE = '22023';
      END IF;

      IF jsonb_typeof(crimson->'bestTripleOut') = 'object' THEN
        best := crimson->'bestTripleOut';
        IF NOT public._account_progress_has_only_keys(best, ARRAY['eventId', 'enemyPieceIds', 'fallCount', 'at'])
           OR NOT (best ?& ARRAY['eventId', 'enemyPieceIds', 'fallCount', 'at'])
           OR NOT public._account_progress_is_identifier(best->>'eventId')
           OR jsonb_typeof(best->'enemyPieceIds') <> 'array'
           OR jsonb_array_length(best->'enemyPieceIds') < 3
           OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(best->'enemyPieceIds')) < 3
           OR jsonb_typeof(best->'fallCount') <> 'number'
           OR (best->>'fallCount') !~ '^[0-9]+$'
           OR (best->>'fallCount')::numeric < 3
           OR (best->>'fallCount')::numeric > 128
           OR NOT public._account_progress_is_iso_utc(best->>'at') THEN
          RAISE EXCEPTION 'Invalid bestTripleOut entry in banner_crimson_sun' USING ERRCODE = '22023';
        END IF;

        FOR item IN SELECT value FROM jsonb_array_elements(best->'enemyPieceIds')
        LOOP
          IF jsonb_typeof(item) <> 'string'
             OR NOT public._account_progress_is_identifier(item #>> '{}') THEN
            RAISE EXCEPTION 'Invalid enemy piece ID in bestTripleOut: %', item USING ERRCODE = '22023';
          END IF;
        END LOOP;
      END IF;
    END IF;

    IF banners ? 'banner_hidden_myeongnyang' THEN
      comeback := banners->'banner_hidden_myeongnyang';
      IF jsonb_typeof(comeback) <> 'object'
         OR NOT public._account_progress_has_only_keys(comeback, ARRAY['eventIds', 'firstAchievedAt'])
         OR NOT (comeback ?& ARRAY['eventIds', 'firstAchievedAt'])
         OR jsonb_typeof(comeback->'eventIds') <> 'object'
         OR jsonb_typeof(comeback->'firstAchievedAt') NOT IN ('string', 'null')
         OR (jsonb_typeof(comeback->'firstAchievedAt') = 'string' AND NOT public._account_progress_is_iso_utc(comeback->>'firstAchievedAt'))
         OR (SELECT count(*) FROM jsonb_object_keys(comeback->'eventIds')) > 1 THEN
        RAISE EXCEPTION 'Invalid banner_hidden_myeongnyang progress record' USING ERRCODE = '22023';
      END IF;

      FOR event_id, event_val IN SELECT * FROM jsonb_each(comeback->'eventIds')
      LOOP
        IF NOT public._account_progress_is_identifier(event_id)
           OR jsonb_typeof(event_val) <> 'object'
           OR NOT public._account_progress_has_only_keys(event_val, ARRAY['at', 'stage'])
           OR NOT (event_val ?& ARRAY['at', 'stage'])
           OR NOT public._account_progress_is_iso_utc(event_val->>'at')
           OR jsonb_typeof(event_val->'stage') <> 'number'
           OR (event_val->>'stage') !~ '^[0-9]+$'
           OR (event_val->>'stage')::integer < 5 THEN
          RAISE EXCEPTION 'Invalid comeback victory entry in banner_hidden_myeongnyang: %', event_id USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_mastery_rewards_v3(p_serialized text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  root jsonb;
  grants jsonb;
  items jsonb;
  grant_id text;
  grant_value jsonb;
  item_id text;
  item_value jsonb;
  expected_items jsonb;
  listed_item jsonb;
BEGIN
  IF p_serialized IS NULL OR octet_length(p_serialized) > 8192 THEN
    RAISE EXCEPTION 'ca_mastery_rewards_v1 exceeds its 8192-byte limit' USING ERRCODE = '22023';
  END IF;

  BEGIN
    root := p_serialized::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid JSON format for ca_mastery_rewards_v1' USING ERRCODE = '22023';
  END;

  IF NOT public._account_progress_has_only_keys(root, ARRAY['schemaVersion','grants','items'])
     OR NOT (root ?& ARRAY['schemaVersion','grants','items'])
     OR root->'schemaVersion' <> '1'::jsonb
     OR jsonb_typeof(root->'grants') <> 'object'
     OR jsonb_typeof(root->'items') <> 'object' THEN
    RAISE EXCEPTION 'Invalid ca_mastery_rewards_v1 envelope' USING ERRCODE = '22023';
  END IF;

  grants := root->'grants';
  items := root->'items';
  IF (SELECT count(*) FROM jsonb_object_keys(grants)) > 24
     OR (SELECT count(*) FROM jsonb_object_keys(items)) > 24 THEN
    RAISE EXCEPTION 'Mastery reward grant or item limit exceeded' USING ERRCODE = '22023';
  END IF;

  FOR grant_id, grant_value IN SELECT * FROM jsonb_each(grants)
  LOOP
    expected_items := CASE grant_id
      WHEN 'mastery:M01:v1' THEN '["badge:mastery-m01"]'::jsonb
      WHEN 'mastery:M02:v1' THEN '["badge:mastery-m02"]'::jsonb
      WHEN 'mastery:M03:v1' THEN '["badge:mastery-m03"]'::jsonb
      WHEN 'mastery:M04:v1' THEN '["badge:mastery-m04"]'::jsonb
      WHEN 'mastery:M05:v1' THEN '["badge:mastery-m05"]'::jsonb
      WHEN 'mastery:M06:v1' THEN '["badge:mastery-m06"]'::jsonb
      WHEN 'mastery:M07:v1' THEN '["badge:mastery-m07"]'::jsonb
      WHEN 'mastery:M08:v1' THEN '["badge:mastery-m08"]'::jsonb
      WHEN 'mastery:milestone:four' THEN '["title:explorer","entitlement:woodgrain-set-scheduled"]'::jsonb
      WHEN 'mastery:milestone:eight' THEN '["frame:mastery-complete"]'::jsonb
      WHEN 'banner:banner_cosmic_knight:v1' THEN '["banner:banner_cosmic_knight"]'::jsonb
      WHEN 'banner:banner_crimson_sun:v1' THEN '["banner:banner_crimson_sun"]'::jsonb
      WHEN 'banner:banner_hidden_myeongnyang:v1' THEN '["banner:banner_hidden_myeongnyang"]'::jsonb
      ELSE NULL
    END;

    IF expected_items IS NULL
       OR NOT public._account_progress_has_only_keys(grant_value, ARRAY['grantedAt','itemIds'])
       OR NOT (grant_value ?& ARRAY['grantedAt','itemIds'])
       OR NOT public._account_progress_is_iso_utc(grant_value->>'grantedAt')
       OR jsonb_typeof(grant_value->'itemIds') <> 'array'
       OR jsonb_array_length(grant_value->'itemIds') > 3
       OR NOT ((grant_value->'itemIds') @> expected_items AND (grant_value->'itemIds') <@ expected_items)
       OR (SELECT count(*) FROM jsonb_array_elements(grant_value->'itemIds'))
          <> (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(grant_value->'itemIds')) THEN
      RAISE EXCEPTION 'Invalid or inconsistent mastery reward grant: %', grant_id USING ERRCODE = '22023';
    END IF;

    FOR listed_item IN SELECT value FROM jsonb_array_elements(grant_value->'itemIds')
    LOOP
      item_id := listed_item #>> '{}';
      IF jsonb_typeof(listed_item) <> 'string'
         OR NOT (items ? item_id)
         OR items->item_id->>'grantId' IS DISTINCT FROM grant_id
         OR items->item_id->>'grantedAt' IS DISTINCT FROM grant_value->>'grantedAt' THEN
        RAISE EXCEPTION 'Mastery reward item is missing or inconsistent: %', item_id USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  FOR item_id, item_value IN SELECT * FROM jsonb_each(items)
  LOOP
    IF NOT public._account_progress_is_identifier(item_id)
       OR NOT public._account_progress_has_only_keys(item_value, ARRAY['grantId','grantedAt'])
       OR NOT (item_value ?& ARRAY['grantId','grantedAt'])
       OR NOT public._account_progress_is_iso_utc(item_value->>'grantedAt')
       OR NOT (grants ? (item_value->>'grantId'))
       OR NOT ((grants->(item_value->>'grantId')->'itemIds') @> jsonb_build_array(item_id))
       OR grants->(item_value->>'grantId')->>'grantedAt' IS DISTINCT FROM item_value->>'grantedAt' THEN
      RAISE EXCEPTION 'Invalid or orphaned mastery reward item: %', item_id USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_mastery_preferences_v3(
  p_serialized text,
  p_rewards_serialized text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  root jsonb;
  tracked jsonb;
  equipped jsonb;
  slot_name text;
  slot_value jsonb;
  item_id text;
  rewards jsonb;
BEGIN
  IF p_serialized IS NULL OR octet_length(p_serialized) > 4096 THEN
    RAISE EXCEPTION 'ca_mastery_preferences_v1 exceeds its 4096-byte limit' USING ERRCODE = '22023';
  END IF;

  BEGIN
    root := p_serialized::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid JSON format for ca_mastery_preferences_v1' USING ERRCODE = '22023';
  END;

  IF NOT public._account_progress_has_only_keys(root, ARRAY['schemaVersion','tracked','equipped'])
     OR NOT (root ?& ARRAY['schemaVersion','tracked','equipped'])
     OR root->'schemaVersion' <> '1'::jsonb
     OR jsonb_typeof(root->'tracked') <> 'object'
     OR jsonb_typeof(root->'equipped') <> 'object' THEN
    RAISE EXCEPTION 'Invalid ca_mastery_preferences_v1 envelope' USING ERRCODE = '22023';
  END IF;

  tracked := root->'tracked';
  IF NOT public._account_progress_has_only_keys(tracked, ARRAY['medalId','updatedAt','deviceId'])
     OR NOT (tracked ?& ARRAY['medalId','updatedAt','deviceId'])
     OR jsonb_typeof(tracked->'medalId') NOT IN ('string','null')
     OR (jsonb_typeof(tracked->'medalId') = 'string'
         AND tracked->>'medalId' NOT IN ('M01','M02','M03','M04','M05','M06','M07','M08'))
     OR NOT public._account_progress_is_iso_utc(tracked->>'updatedAt')
     OR NOT public._account_progress_is_identifier(tracked->>'deviceId') THEN
    RAISE EXCEPTION 'Invalid tracked mastery preference' USING ERRCODE = '22023';
  END IF;

  equipped := root->'equipped';
  IF NOT public._account_progress_has_only_keys(equipped, ARRAY['badge','title','frame','banner']) THEN
    RAISE EXCEPTION 'Invalid equipped mastery preference slots' USING ERRCODE = '22023';
  END IF;

  IF p_rewards_serialized IS NOT NULL THEN
    BEGIN
      rewards := p_rewards_serialized::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Cannot validate equipment against malformed mastery rewards' USING ERRCODE = '22023';
    END;
  END IF;

  FOR slot_name, slot_value IN SELECT * FROM jsonb_each(equipped)
  LOOP
    IF NOT public._account_progress_has_only_keys(slot_value, ARRAY['itemId','updatedAt','deviceId'])
       OR NOT (slot_value ?& ARRAY['itemId','updatedAt','deviceId'])
       OR jsonb_typeof(slot_value->'itemId') NOT IN ('string','null')
       OR NOT public._account_progress_is_iso_utc(slot_value->>'updatedAt')
       OR NOT public._account_progress_is_identifier(slot_value->>'deviceId') THEN
      RAISE EXCEPTION 'Invalid equipped mastery preference: %', slot_name USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(slot_value->'itemId') = 'string' THEN
      item_id := slot_value->>'itemId';
      IF NOT public._account_progress_is_identifier(item_id) THEN
        RAISE EXCEPTION 'Invalid item ID format in equipped mastery slot: %', slot_name USING ERRCODE = '22023';
      END IF;

      IF slot_name = 'badge' THEN
        IF item_id !~ '^badge:mastery-m0[1-8]$' OR rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
          RAISE EXCEPTION 'Unowned or invalid badge item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
      ELSIF slot_name = 'title' THEN
        IF item_id <> 'title:explorer' OR rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
          RAISE EXCEPTION 'Unowned or invalid title item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
      ELSIF slot_name = 'frame' THEN
        IF item_id <> 'frame:mastery-complete' OR rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
          RAISE EXCEPTION 'Unowned or invalid frame item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
      ELSIF slot_name = 'banner' THEN
        IF item_id NOT IN ('banner:classic', 'banner:slate', 'banner:forest', 'banner:banner_cosmic_knight', 'banner:banner_crimson_sun', 'banner:banner_hidden_myeongnyang') THEN
          RAISE EXCEPTION 'Invalid banner item equipped: %', item_id USING ERRCODE = '22023';
        END IF;
        -- Basic banners (classic, slate, forest) are member default implicit.
        -- Achievement banners require reward grant ownership.
        IF item_id IN ('banner:banner_cosmic_knight', 'banner:banner_crimson_sun', 'banner:banner_hidden_myeongnyang') THEN
          IF rewards IS NULL OR NOT (rewards->'items' ? item_id) THEN
            RAISE EXCEPTION 'Unowned achievement banner equipped: %', item_id USING ERRCODE = '22023';
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_account_progress_v3(p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  k text;
  v jsonb;
  legacy_data jsonb := '{}'::jsonb;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_data::text) > 262144 THEN
    RAISE EXCEPTION 'Progress payload exceeds maximum allowed size of 262144 bytes' USING ERRCODE = '22023';
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(p_data)
  LOOP
    IF k IN ('ca_mastery_progress_v1','ca_mastery_rewards_v1','ca_mastery_preferences_v1') THEN
      IF jsonb_typeof(v) <> 'string' THEN
        RAISE EXCEPTION 'All progress snapshot values must be strings: %', k USING ERRCODE = '22023';
      END IF;
    ELSE
      legacy_data := legacy_data || jsonb_build_object(k, v);
    END IF;
  END LOOP;

  PERFORM public._validate_account_progress_legacy(legacy_data);

  IF p_data ? 'ca_mastery_progress_v1' THEN
    PERFORM public._validate_mastery_progress_v3(p_data->>'ca_mastery_progress_v1');
  END IF;
  IF p_data ? 'ca_mastery_rewards_v1' THEN
    PERFORM public._validate_mastery_rewards_v3(p_data->>'ca_mastery_rewards_v1');
  END IF;
  IF p_data ? 'ca_mastery_preferences_v1' THEN
    PERFORM public._validate_mastery_preferences_v3(
      p_data->>'ca_mastery_preferences_v1',
      p_data->>'ca_mastery_rewards_v1'
    );
  END IF;
  -- A grant must agree with the stored achievement evidence, not merely its item ID.
  IF coalesce((p_data->>'ca_mastery_rewards_v1')::jsonb->'items', '{}'::jsonb) ? 'banner:banner_cosmic_knight'
     AND (SELECT count(*) FROM jsonb_object_keys(coalesce((p_data->>'ca_mastery_progress_v1')::jsonb #> '{banners,banner_cosmic_knight,fallenEnemies}', '{}'::jsonb))) < 50 THEN
    RAISE EXCEPTION 'Banner reward without knight progress' USING ERRCODE = '22023';
  END IF;
  IF coalesce((p_data->>'ca_mastery_rewards_v1')::jsonb->'items', '{}'::jsonb) ? 'banner:banner_crimson_sun'
     AND coalesce(((p_data->>'ca_mastery_progress_v1')::jsonb #>> '{banners,banner_crimson_sun,bestTripleOut,fallCount}')::integer, 0) < 3 THEN
    RAISE EXCEPTION 'Banner reward without triple-out progress' USING ERRCODE = '22023';
  END IF;
  IF coalesce((p_data->>'ca_mastery_rewards_v1')::jsonb->'items', '{}'::jsonb) ? 'banner:banner_hidden_myeongnyang'
     AND (SELECT count(*) FROM jsonb_object_keys(coalesce((p_data->>'ca_mastery_progress_v1')::jsonb #> '{banners,banner_hidden_myeongnyang,eventIds}', '{}'::jsonb))) < 1 THEN
    RAISE EXCEPTION 'Banner reward without comeback progress' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Helpers to project stored data for v2 legacy clients
CREATE OR REPLACE FUNCTION public._project_account_data_v2(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  result jsonb := p_data;
  prog jsonb;
  rew jsonb;
  pref jsonb;
  grants jsonb := '{}'::jsonb;
  items jsonb := '{}'::jsonb;
  k text;
  v jsonb;
BEGIN
  IF result ? 'ca_mastery_progress_v1' THEN
    BEGIN
      prog := (result->>'ca_mastery_progress_v1')::jsonb;
      IF prog ? 'banners' THEN
        prog := prog - 'banners';
        result := result || jsonb_build_object('ca_mastery_progress_v1', prog::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Keep as is if unparseable
    END;
  END IF;

  IF result ? 'ca_mastery_rewards_v1' THEN
    BEGIN
      rew := (result->>'ca_mastery_rewards_v1')::jsonb;
      IF rew ? 'grants' AND jsonb_typeof(rew->'grants') = 'object' THEN
        FOR k, v IN SELECT * FROM jsonb_each(rew->'grants')
        LOOP
          IF NOT (k LIKE 'banner:%') THEN
            grants := grants || jsonb_build_object(k, v);
          END IF;
        END LOOP;
        rew := rew || jsonb_build_object('grants', grants);
      END IF;
      IF rew ? 'items' AND jsonb_typeof(rew->'items') = 'object' THEN
        FOR k, v IN SELECT * FROM jsonb_each(rew->'items')
        LOOP
          IF NOT (k LIKE 'banner:%') THEN
            items := items || jsonb_build_object(k, v);
          END IF;
        END LOOP;
        rew := rew || jsonb_build_object('items', items);
      END IF;
      result := result || jsonb_build_object('ca_mastery_rewards_v1', rew::text);
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  IF result ? 'ca_mastery_preferences_v1' THEN
    BEGIN
      pref := (result->>'ca_mastery_preferences_v1')::jsonb;
      IF pref ? 'equipped' AND jsonb_typeof(pref->'equipped') = 'object' AND (pref->'equipped' ? 'banner') THEN
        pref := pref || jsonb_build_object('equipped', (pref->'equipped') - 'banner');
        result := result || jsonb_build_object('ca_mastery_preferences_v1', pref::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  RETURN result;
END;
$$;

-- Update legacy v1 save to preserve all v2 and v3 mastery/banner keys
CREATE OR REPLACE FUNCTION public.save_account_progress(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_result_data jsonb;
  v_result_rev bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;

  PERFORM public._validate_account_progress_legacy(p_data);

  IF p_expected_revision = 0 THEN
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, p_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.account_progress
    SET data = p_data || jsonb_strip_nulls(jsonb_build_object(
          'ca_mastery_progress_v1', data->'ca_mastery_progress_v1',
          'ca_mastery_rewards_v1', data->'ca_mastery_rewards_v1',
          'ca_mastery_preferences_v1', data->'ca_mastery_preferences_v1'
        )),
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
    IF octet_length(v_result_data::text) > 262144 THEN
      RAISE EXCEPTION 'Progress payload exceeds maximum allowed size of 262144 bytes after preserving mastery data' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', v_result_data - ARRAY['ca_mastery_progress_v1','ca_mastery_rewards_v1','ca_mastery_preferences_v1'],
    'revision', v_result_rev
  );
END;
$$;

-- Update get_account_progress_v2 to project data into v2 format without unknown banner keys
CREATE OR REPLACE FUNCTION public.get_account_progress_v2(
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF p_client_capability IS DISTINCT FROM 'mastery-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;

  SELECT data, revision INTO v_data, v_revision
  FROM public.account_progress
  WHERE user_id = caller;

  IF NOT FOUND THEN
    v_data := '{}'::jsonb;
    v_revision := 0;
  END IF;

  RETURN jsonb_build_object(
    'data', public._project_account_data_v2(v_data),
    'revision', v_revision,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1')
  );
END;
$$;

-- Update save_account_progress_v2 to validate v2 data and preserve banner extensions on existing row
CREATE OR REPLACE FUNCTION public.save_account_progress_v2(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_existing_data jsonb;
  v_existing_rev bigint;
  v_effective_data jsonb;
  v_result_data jsonb;
  v_result_rev bigint;
  v_merged_prog text;
  v_merged_rew text;
  v_merged_pref text;
  v_curr_prog jsonb;
  v_exist_prog jsonb;
  v_curr_rew jsonb;
  v_exist_rew jsonb;
  v_curr_pref jsonb;
  v_exist_pref jsonb;
  k text;
  v jsonb;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'mastery-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Validate submitted v2 payload
  PERFORM public._validate_account_progress_v2(p_data);

  IF p_expected_revision = 0 THEN
    v_effective_data := p_data;
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, v_effective_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    SELECT data, revision INTO v_existing_data, v_existing_rev
    FROM public.account_progress
    WHERE user_id = caller
    FOR UPDATE;

    IF NOT FOUND OR v_existing_rev <> p_expected_revision THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;

    -- Merge incoming v2 data while preserving banner extensions from existing v3 data
    v_effective_data := p_data;

    -- Preserve banners in ca_mastery_progress_v1
    IF v_existing_data ? 'ca_mastery_progress_v1' THEN
      BEGIN
        v_exist_prog := (v_existing_data->>'ca_mastery_progress_v1')::jsonb;
        IF v_exist_prog ? 'banners' THEN
          IF v_effective_data ? 'ca_mastery_progress_v1' THEN
            v_curr_prog := (v_effective_data->>'ca_mastery_progress_v1')::jsonb;
            v_curr_prog := v_curr_prog || jsonb_build_object('banners', v_exist_prog->'banners');
            v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_progress_v1', v_curr_prog::text);
          ELSE
            v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_progress_v1', v_existing_data->>'ca_mastery_progress_v1');
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
      END;
    END IF;

    -- Preserve banner grants/items in ca_mastery_rewards_v1
    IF v_existing_data ? 'ca_mastery_rewards_v1' THEN
      BEGIN
        v_exist_rew := (v_existing_data->>'ca_mastery_rewards_v1')::jsonb;
        IF v_effective_data ? 'ca_mastery_rewards_v1' THEN
          v_curr_rew := (v_effective_data->>'ca_mastery_rewards_v1')::jsonb;
          IF v_exist_rew ? 'grants' AND jsonb_typeof(v_exist_rew->'grants') = 'object' THEN
            FOR k, v IN SELECT * FROM jsonb_each(v_exist_rew->'grants')
            LOOP
              IF k LIKE 'banner:%' THEN
                v_curr_rew := jsonb_set(v_curr_rew, ARRAY['grants', k], v, true);
              END IF;
            END LOOP;
          END IF;
          IF v_exist_rew ? 'items' AND jsonb_typeof(v_exist_rew->'items') = 'object' THEN
            FOR k, v IN SELECT * FROM jsonb_each(v_exist_rew->'items')
            LOOP
              IF k LIKE 'banner:%' THEN
                v_curr_rew := jsonb_set(v_curr_rew, ARRAY['items', k], v, true);
              END IF;
            END LOOP;
          END IF;
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_rewards_v1', v_curr_rew::text);
        ELSE
          v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_rewards_v1', v_existing_data->>'ca_mastery_rewards_v1');
        END IF;
      EXCEPTION WHEN OTHERS THEN
      END;
    END IF;

    -- Preserve banner slot in ca_mastery_preferences_v1
    IF v_existing_data ? 'ca_mastery_preferences_v1' THEN
      BEGIN
        v_exist_pref := (v_existing_data->>'ca_mastery_preferences_v1')::jsonb;
        IF v_exist_pref ? 'equipped' AND (v_exist_pref->'equipped' ? 'banner') THEN
          IF v_effective_data ? 'ca_mastery_preferences_v1' THEN
            v_curr_pref := (v_effective_data->>'ca_mastery_preferences_v1')::jsonb;
            v_curr_pref := jsonb_set(v_curr_pref, ARRAY['equipped', 'banner'], v_exist_pref->'equipped'->'banner', true);
            v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_curr_pref::text);
          ELSE
            v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_existing_data->>'ca_mastery_preferences_v1');
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
      END;
    END IF;

    -- If a domain was completely absent in v2 submission, retain full domain
    IF NOT (v_effective_data ? 'ca_mastery_progress_v1') AND (v_existing_data ? 'ca_mastery_progress_v1') THEN
      v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_progress_v1', v_existing_data->'ca_mastery_progress_v1');
    END IF;
    IF NOT (v_effective_data ? 'ca_mastery_rewards_v1') AND (v_existing_data ? 'ca_mastery_rewards_v1') THEN
      v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_rewards_v1', v_existing_data->'ca_mastery_rewards_v1');
    END IF;
    IF NOT (v_effective_data ? 'ca_mastery_preferences_v1') AND (v_existing_data ? 'ca_mastery_preferences_v1') THEN
      v_effective_data := v_effective_data || jsonb_build_object('ca_mastery_preferences_v1', v_existing_data->'ca_mastery_preferences_v1');
    END IF;

    PERFORM public._validate_account_progress_v3(v_effective_data);

    UPDATE public.account_progress
    SET data = v_effective_data,
        revision = revision + 1,
        updated_at = now()
    WHERE user_id = caller AND revision = p_expected_revision
    RETURNING data, revision INTO v_result_data, v_result_rev;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'data', public._project_account_data_v2(v_result_data),
    'revision', v_result_rev,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1')
  );
END;
$$;

-- New v3 read RPC with banners-v1 capability
CREATE OR REPLACE FUNCTION public.get_account_progress_v3(
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF p_client_capability IS DISTINCT FROM 'banners-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;

  SELECT data, revision INTO v_data, v_revision
  FROM public.account_progress
  WHERE user_id = caller;

  IF NOT FOUND THEN
    v_data := '{}'::jsonb;
    v_revision := 0;
  END IF;

  RETURN jsonb_build_object(
    'data', v_data,
    'revision', v_revision,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1','banners-v1')
  );
END;
$$;

-- New v3 write RPC with banners-v1 capability
CREATE OR REPLACE FUNCTION public.save_account_progress_v3(
  p_data jsonb,
  p_expected_revision bigint,
  p_expected_user_id uuid,
  p_client_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_existing_data jsonb;
  v_existing_rev bigint;
  v_effective_data jsonb;
  v_result_data jsonb;
  v_result_rev bigint;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may save account progress' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Account changed during progress request' USING ERRCODE = '42501';
  END IF;
  IF p_client_capability IS DISTINCT FROM 'banners-v1' THEN
    RAISE EXCEPTION 'Unsupported account progress capability' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Progress data must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision = 0 THEN
    v_effective_data := p_data;
    PERFORM public._validate_account_progress_v3(v_effective_data);
    INSERT INTO public.account_progress(user_id, data, revision, updated_at)
    VALUES (caller, v_effective_data, 1, now())
    ON CONFLICT (user_id) DO NOTHING
    RETURNING data, revision INTO v_result_data, v_result_rev;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revision conflict: snapshot already exists for user (expected revision 0)' USING ERRCODE = '40001';
    END IF;
  ELSE
    SELECT data, revision INTO v_existing_data, v_existing_rev
    FROM public.account_progress
    WHERE user_id = caller
    FOR UPDATE;

    IF NOT FOUND OR v_existing_rev <> p_expected_revision THEN
      RAISE EXCEPTION 'Revision conflict: expected revision % does not match current state', p_expected_revision USING ERRCODE = '40001';
    END IF;

    -- Missing mastery/banner fields mean "preserve" during save
    v_effective_data := p_data || jsonb_strip_nulls(jsonb_build_object(
      'ca_mastery_progress_v1', CASE WHEN p_data ? 'ca_mastery_progress_v1' THEN NULL ELSE v_existing_data->'ca_mastery_progress_v1' END,
      'ca_mastery_rewards_v1', CASE WHEN p_data ? 'ca_mastery_rewards_v1' THEN NULL ELSE v_existing_data->'ca_mastery_rewards_v1' END,
      'ca_mastery_preferences_v1', CASE WHEN p_data ? 'ca_mastery_preferences_v1' THEN NULL ELSE v_existing_data->'ca_mastery_preferences_v1' END
    ));

    PERFORM public._validate_account_progress_v3(v_effective_data);
    UPDATE public.account_progress
    SET data = v_effective_data,
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
    'revision', v_result_rev,
    'capabilities', jsonb_build_array('account-progress-v1','mastery-v1','banners-v1')
  );
END;
$$;

-- Minimal public RPC to look up another player's equipped and verified banner
CREATE OR REPLACE FUNCTION public.get_player_banner(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  is_anon boolean;
  v_data jsonb;
  v_pref jsonb;
  v_rew jsonb;
  v_equipped_item text;
  v_banner_id text;
BEGIN
  is_anon := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  IF caller IS NULL OR is_anon THEN
    RAISE EXCEPTION 'Only authenticated non-anonymous users may query player banners' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN 'classic';
  END IF;

  SELECT data INTO v_data
  FROM public.account_progress
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_data IS NULL THEN
    RETURN 'classic';
  END IF;

  IF NOT (v_data ? 'ca_mastery_preferences_v1') THEN
    RETURN 'classic';
  END IF;

  BEGIN
    v_pref := (v_data->>'ca_mastery_preferences_v1')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'classic';
  END;

  v_equipped_item := v_pref->'equipped'->'banner'->>'itemId';
  IF v_equipped_item IS NULL THEN
    RETURN 'classic';
  END IF;

  IF v_equipped_item LIKE 'banner:%' THEN
    v_banner_id := substr(v_equipped_item, 8);
  ELSE
    v_banner_id := v_equipped_item;
  END IF;

  IF v_banner_id NOT IN ('classic', 'slate', 'forest', 'banner_cosmic_knight', 'banner_crimson_sun', 'banner_hidden_myeongnyang') THEN
    RETURN 'classic';
  END IF;

  -- Basic banners are implicitly owned by any account
  IF v_banner_id IN ('classic', 'slate', 'forest') THEN
    RETURN v_banner_id;
  END IF;

  -- Achievement banners require verified grant in rewards
  IF NOT (v_data ? 'ca_mastery_rewards_v1') THEN
    RETURN 'classic';
  END IF;

  BEGIN
    v_rew := (v_data->>'ca_mastery_rewards_v1')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'classic';
  END;

  IF (v_rew ? 'items') AND ((v_rew->'items' ? ('banner:' || v_banner_id)) OR (v_rew->'items' ? v_banner_id)) THEN
    RETURN v_banner_id;
  END IF;

  RETURN 'classic';
END;
$$;

-- Security permissions
REVOKE ALL ON FUNCTION public._validate_mastery_progress_v3(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_mastery_rewards_v3(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_mastery_preferences_v3(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_account_progress_v3(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._project_account_data_v2(jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_account_progress_v3(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_progress_v3(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_account_progress_v3(jsonb, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_account_progress_v3(jsonb, bigint, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_player_banner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_banner(uuid) TO authenticated;

SELECT 'profile_banners_migration_applied' AS migration_status;

COMMIT;
