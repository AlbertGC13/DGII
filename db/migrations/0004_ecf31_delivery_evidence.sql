CREATE OR REPLACE FUNCTION ecf31_delivery_messages_valid(p_messages jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_messages) = 'array' AND jsonb_array_length(p_messages) <= 100 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_messages) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'string' OR item.value #>> '{}' ~ '^[[:space:]]*$' OR length(item.value #>> '{}') NOT BETWEEN 1 AND 256
      OR item.value #>> '{}' ~ '[[:cntrl:]]'
  )
$$;

CREATE TABLE IF NOT EXISTS ecf31_delivery_attempts (
  scope_id text NOT NULL, ecf_type text NOT NULL CHECK (ecf_type = 'E31'), allocation_idempotency_key text NOT NULL,
  attempt_key text NOT NULL CHECK (length(attempt_key) BETWEEN 1 AND 128 AND attempt_key !~ '[[:cntrl:]]'),
  attempt_no integer NOT NULL CHECK (attempt_no > 0), environment text NOT NULL CHECK (environment IN ('testecf', 'certecf', 'ecf')),
  signed_xml_sha256 text NOT NULL CHECK (signed_xml_sha256 ~ '^[0-9a-f]{64}$'),
  track_id text NOT NULL CHECK (length(track_id) BETWEEN 1 AND 256 AND track_id !~ '[[:cntrl:]]'),
  acknowledged_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (scope_id, ecf_type, allocation_idempotency_key, attempt_key),
  UNIQUE (scope_id, ecf_type, allocation_idempotency_key, attempt_no), UNIQUE (scope_id, environment, track_id),
  FOREIGN KEY (scope_id, ecf_type, allocation_idempotency_key) REFERENCES sequence_allocation_requests (scope_id, ecf_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ecf31_delivery_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_id text NOT NULL, ecf_type text NOT NULL CHECK (ecf_type = 'E31'), allocation_idempotency_key text NOT NULL, attempt_key text NOT NULL,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 128 AND event_key !~ '[[:cntrl:]]'),
  event_kind text NOT NULL CHECK (event_kind IN ('RECEPTION_ACKNOWLEDGED', 'RESULT_OBSERVED', 'POLLING_DEADLINE_EXPIRED', 'POLLING_CANCELLED', 'POLLING_ERROR')),
  track_id text NOT NULL CHECK (length(track_id) BETWEEN 1 AND 256 AND track_id !~ '[[:cntrl:]]'),
  codigo smallint CHECK (codigo BETWEEN 0 AND 4), estado text CHECK (length(estado) BETWEEN 1 AND 256 AND estado !~ '[[:cntrl:]]'),
  rnc text CHECK (rnc IS NULL OR (length(rnc) BETWEEN 1 AND 32 AND rnc !~ '[[:cntrl:]]')),
  e_ncf text CHECK (e_ncf IS NULL OR (length(e_ncf) BETWEEN 1 AND 32 AND e_ncf !~ '[[:cntrl:]]')),
  fecha text CHECK (fecha IS NULL OR (length(fecha) BETWEEN 1 AND 256 AND fecha !~ '[[:cntrl:]]')),
  mensajes jsonb NOT NULL, secuencia_utilizada boolean,
  disposition text CHECK (disposition IN ('CONSUMED_NON_REUSABLE', 'POTENTIALLY_REUSABLE_NO_BLIND_RESEND')),
  state_applied boolean NOT NULL, anomaly boolean NOT NULL DEFAULT false, observed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (scope_id, ecf_type, allocation_idempotency_key, attempt_key, event_key),
  FOREIGN KEY (scope_id, ecf_type, allocation_idempotency_key, attempt_key) REFERENCES ecf31_delivery_attempts (scope_id, ecf_type, allocation_idempotency_key, attempt_key),
  CHECK (ecf31_delivery_messages_valid(mensajes)),
  CHECK ((event_kind = 'RESULT_OBSERVED' AND codigo IS NOT NULL AND estado IS NOT NULL
    AND ((codigo IN (0, 3) AND rnc IS NULL AND e_ncf IS NULL AND fecha IS NULL AND mensajes = '[]'::jsonb AND secuencia_utilizada IS NULL AND disposition IS NULL)
      OR (codigo IN (1, 4) AND secuencia_utilizada IS NULL AND disposition IS NULL)
      OR (codigo = 2 AND secuencia_utilizada IS NOT NULL AND disposition = CASE WHEN secuencia_utilizada THEN 'CONSUMED_NON_REUSABLE' ELSE 'POTENTIALLY_REUSABLE_NO_BLIND_RESEND' END)))
    OR (event_kind <> 'RESULT_OBSERVED' AND codigo IS NULL AND estado IS NULL AND rnc IS NULL AND e_ncf IS NULL AND fecha IS NULL AND mensajes = '[]'::jsonb AND secuencia_utilizada IS NULL AND disposition IS NULL))
);

CREATE TABLE IF NOT EXISTS ecf31_delivery_current (
  scope_id text NOT NULL, ecf_type text NOT NULL CHECK (ecf_type = 'E31'), allocation_idempotency_key text NOT NULL, attempt_key text NOT NULL,
  latest_event_id bigint REFERENCES ecf31_delivery_events (event_id), latest_result_event_id bigint REFERENCES ecf31_delivery_events (event_id), latest_track_id text NOT NULL,
  delivery_state text NOT NULL CHECK (delivery_state IN ('RECEPTION_ACKNOWLEDGED', 'INDETERMINATE', 'IN_PROCESS', 'ACCEPTED', 'REJECTED', 'ACCEPTED_CONDITIONAL', 'PENDING_RECONCILIATION')),
  polling_state text NOT NULL CHECK (polling_state IN ('NOT_STARTED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ERROR', 'DEADLINE_EXPIRED')),
  disposition text, auto_resend_blocked boolean NOT NULL DEFAULT false, anomaly boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (scope_id, ecf_type, allocation_idempotency_key, attempt_key),
  FOREIGN KEY (scope_id, ecf_type, allocation_idempotency_key, attempt_key) REFERENCES ecf31_delivery_attempts (scope_id, ecf_type, allocation_idempotency_key, attempt_key)
);
REVOKE INSERT, UPDATE, DELETE ON ecf31_delivery_attempts, ecf31_delivery_events, ecf31_delivery_current FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_ecf31_delivery_history_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delivery evidence is append-only'; END $$;
CREATE OR REPLACE FUNCTION reject_ecf31_delivery_current_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF pg_trigger_depth() <> 2 THEN RAISE EXCEPTION 'delivery projection changes require internal event application'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION initialize_ecf31_delivery_current() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN INSERT INTO public.ecf31_delivery_current(scope_id, ecf_type, allocation_idempotency_key, attempt_key, latest_track_id, delivery_state, polling_state) VALUES (NEW.scope_id, NEW.ecf_type, NEW.allocation_idempotency_key, NEW.attempt_key, NEW.track_id, 'RECEPTION_ACKNOWLEDGED', 'NOT_STARTED'); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION apply_ecf31_delivery_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current public.ecf31_delivery_current%ROWTYPE; terminal boolean; state text; polling text; next_disposition text;
BEGIN
  SELECT * INTO current FROM public.ecf31_delivery_current WHERE scope_id = NEW.scope_id AND ecf_type = NEW.ecf_type AND allocation_idempotency_key = NEW.allocation_idempotency_key AND attempt_key = NEW.attempt_key FOR UPDATE;
  terminal := current.delivery_state IN ('ACCEPTED','REJECTED','ACCEPTED_CONDITIONAL');
  next_disposition := CASE WHEN NEW.codigo = 2 AND NEW.secuencia_utilizada THEN 'CONSUMED_NON_REUSABLE' WHEN NEW.codigo = 2 THEN 'POTENTIALLY_REUSABLE_NO_BLIND_RESEND' END;
  IF NEW.state_applied THEN
    state := CASE WHEN NEW.event_kind = 'RESULT_OBSERVED' THEN CASE NEW.codigo WHEN 0 THEN 'INDETERMINATE' WHEN 1 THEN 'ACCEPTED' WHEN 2 THEN 'REJECTED' WHEN 3 THEN 'IN_PROCESS' WHEN 4 THEN 'ACCEPTED_CONDITIONAL' END ELSE current.delivery_state END;
    polling := CASE WHEN NEW.event_kind = 'POLLING_DEADLINE_EXPIRED' THEN 'DEADLINE_EXPIRED' WHEN NEW.event_kind = 'POLLING_CANCELLED' THEN 'CANCELLED' WHEN NEW.event_kind = 'POLLING_ERROR' THEN 'ERROR' WHEN NEW.codigo IN (1,2,4) THEN 'COMPLETED' WHEN NEW.event_kind IN ('RECEPTION_ACKNOWLEDGED','RESULT_OBSERVED') THEN 'ACTIVE' ELSE current.polling_state END;
    IF NEW.event_kind = 'POLLING_DEADLINE_EXPIRED' AND NOT terminal THEN state := 'PENDING_RECONCILIATION'; END IF;
    UPDATE public.ecf31_delivery_current SET latest_event_id = NEW.event_id, latest_result_event_id = CASE WHEN NEW.event_kind = 'RESULT_OBSERVED' THEN NEW.event_id ELSE latest_result_event_id END, delivery_state = state, polling_state = polling, disposition = coalesce(next_disposition, disposition), auto_resend_blocked = auto_resend_blocked OR coalesce(NEW.codigo = 2, false), anomaly = anomaly OR NEW.anomaly, version = version + 1, updated_at = transaction_timestamp() WHERE scope_id = NEW.scope_id AND ecf_type = NEW.ecf_type AND allocation_idempotency_key = NEW.allocation_idempotency_key AND attempt_key = NEW.attempt_key;
  ELSE
    UPDATE public.ecf31_delivery_current SET latest_event_id = NEW.event_id, anomaly = true, version = version + 1, updated_at = transaction_timestamp() WHERE scope_id = NEW.scope_id AND ecf_type = NEW.ecf_type AND allocation_idempotency_key = NEW.allocation_idempotency_key AND attempt_key = NEW.attempt_key;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.apply_ecf31_delivery_event() SET search_path = pg_catalog;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reject_ecf31_delivery_attempt_change') THEN CREATE TRIGGER reject_ecf31_delivery_attempt_change BEFORE UPDATE OR DELETE ON ecf31_delivery_attempts FOR EACH ROW EXECUTE FUNCTION reject_ecf31_delivery_history_change(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reject_ecf31_delivery_event_change') THEN CREATE TRIGGER reject_ecf31_delivery_event_change BEFORE UPDATE OR DELETE ON ecf31_delivery_events FOR EACH ROW EXECUTE FUNCTION reject_ecf31_delivery_history_change(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reject_ecf31_delivery_current_change') THEN CREATE TRIGGER reject_ecf31_delivery_current_change BEFORE INSERT OR UPDATE OR DELETE ON ecf31_delivery_current FOR EACH ROW EXECUTE FUNCTION reject_ecf31_delivery_current_change(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'initialize_ecf31_delivery_current') THEN CREATE TRIGGER initialize_ecf31_delivery_current AFTER INSERT ON ecf31_delivery_attempts FOR EACH ROW EXECUTE FUNCTION initialize_ecf31_delivery_current(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'apply_ecf31_delivery_event') THEN CREATE TRIGGER apply_ecf31_delivery_event AFTER INSERT ON ecf31_delivery_events FOR EACH ROW EXECUTE FUNCTION apply_ecf31_delivery_event(); END IF; END $$;

CREATE OR REPLACE FUNCTION record_ecf31_delivery_attempt(p_scope_id text, p_ecf_type text, p_allocation_key text, p_attempt_key text, p_environment text, p_sha256 text, p_track_id text)
RETURNS TABLE(outcome text, attempt_no integer, acknowledged_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
-- The migration owner owns this function; deployment must grant its exact signature to an authorized backend role.
DECLARE existing public.ecf31_delivery_attempts%ROWTYPE; next_no integer; stamp timestamptz;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS DISTINCT FROM 'E31' OR p_allocation_key IS NULL OR p_attempt_key IS NULL OR length(p_attempt_key) NOT BETWEEN 1 AND 128 OR p_attempt_key ~ '[[:cntrl:]]' OR p_environment NOT IN ('testecf','certecf','ecf') OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_track_id IS NULL OR length(p_track_id) NOT BETWEEN 1 AND 256 OR p_track_id ~ '[[:cntrl:]]' THEN RETURN QUERY SELECT 'invalid_attempt', NULL::integer, NULL::timestamptz; RETURN; END IF;
  PERFORM 1 FROM public.sequence_allocation_requests WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND idempotency_key = p_allocation_key FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'missing_allocation', NULL::integer, NULL::timestamptz; RETURN; END IF;
  SELECT * INTO existing FROM public.ecf31_delivery_attempts WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key AND attempt_key = p_attempt_key;
  IF FOUND THEN IF existing.environment = p_environment AND existing.signed_xml_sha256 = p_sha256 AND existing.track_id = p_track_id THEN RETURN QUERY SELECT 'replayed', existing.attempt_no, existing.acknowledged_at; ELSE RETURN QUERY SELECT 'conflict', NULL::integer, NULL::timestamptz; END IF; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.ecf31_delivery_attempts WHERE scope_id = p_scope_id AND environment = p_environment AND track_id = p_track_id) THEN RETURN QUERY SELECT 'track_id_conflict', NULL::integer, NULL::timestamptz; RETURN; END IF;
  SELECT coalesce(max(public.ecf31_delivery_attempts.attempt_no), 0) + 1 INTO next_no FROM public.ecf31_delivery_attempts WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key;
  BEGIN INSERT INTO public.ecf31_delivery_attempts(scope_id, ecf_type, allocation_idempotency_key, attempt_key, attempt_no, environment, signed_xml_sha256, track_id) VALUES (p_scope_id, 'E31', p_allocation_key, p_attempt_key, next_no, p_environment, p_sha256, p_track_id) RETURNING public.ecf31_delivery_attempts.acknowledged_at INTO stamp; EXCEPTION WHEN unique_violation THEN RETURN QUERY SELECT 'track_id_conflict', NULL::integer, NULL::timestamptz; RETURN; END;
  RETURN QUERY SELECT 'recorded', next_no, stamp;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_ecf31_delivery_attempt(text, text, text, text, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION append_ecf31_delivery_event(p_scope_id text, p_ecf_type text, p_allocation_key text, p_attempt_key text, p_event_key text, p_kind text, p_codigo smallint, p_estado text, p_rnc text, p_e_ncf text, p_fecha text, p_mensajes jsonb, p_secuencia boolean)
RETURNS TABLE(outcome text, event_id bigint, state_applied boolean, anomaly boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt public.ecf31_delivery_attempts%ROWTYPE; prior public.ecf31_delivery_events%ROWTYPE; current public.ecf31_delivery_current%ROWTYPE; applied boolean; flagged boolean; terminal boolean; state text; polling text; next_disposition text;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS DISTINCT FROM 'E31' OR p_allocation_key IS NULL OR p_attempt_key IS NULL OR p_event_key IS NULL OR length(p_event_key) NOT BETWEEN 1 AND 128 OR p_event_key ~ '[[:cntrl:]]' OR p_kind NOT IN ('RECEPTION_ACKNOWLEDGED','RESULT_OBSERVED','POLLING_DEADLINE_EXPIRED','POLLING_CANCELLED','POLLING_ERROR') OR p_codigo NOT BETWEEN 0 AND 4 OR (p_estado IS NOT NULL AND (length(p_estado) NOT BETWEEN 1 AND 256 OR p_estado ~ '[[:cntrl:]]')) OR (p_rnc IS NOT NULL AND (length(p_rnc) NOT BETWEEN 1 AND 32 OR p_rnc ~ '[[:cntrl:]]')) OR (p_e_ncf IS NOT NULL AND (length(p_e_ncf) NOT BETWEEN 1 AND 32 OR p_e_ncf ~ '[[:cntrl:]]')) OR (p_fecha IS NOT NULL AND (length(p_fecha) NOT BETWEEN 1 AND 256 OR p_fecha ~ '[[:cntrl:]]')) OR p_mensajes IS NULL OR NOT public.ecf31_delivery_messages_valid(p_mensajes) THEN RETURN QUERY SELECT 'invalid_event', NULL::bigint, NULL::boolean, NULL::boolean; RETURN; END IF;
  SELECT * INTO attempt FROM public.ecf31_delivery_attempts WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key AND attempt_key = p_attempt_key FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'missing_attempt', NULL::bigint, NULL::boolean, NULL::boolean; RETURN; END IF;
  SELECT * INTO prior FROM public.ecf31_delivery_events WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key AND attempt_key = p_attempt_key AND event_key = p_event_key;
  IF FOUND THEN IF prior.event_kind = p_kind AND prior.codigo IS NOT DISTINCT FROM p_codigo AND prior.estado IS NOT DISTINCT FROM p_estado AND prior.rnc IS NOT DISTINCT FROM p_rnc AND prior.e_ncf IS NOT DISTINCT FROM p_e_ncf AND prior.fecha IS NOT DISTINCT FROM p_fecha AND prior.mensajes = p_mensajes AND prior.secuencia_utilizada IS NOT DISTINCT FROM p_secuencia THEN RETURN QUERY SELECT 'replayed', prior.event_id, prior.state_applied, prior.anomaly; ELSE RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::boolean, NULL::boolean; END IF; RETURN; END IF;
  IF (p_kind <> 'RESULT_OBSERVED' AND (p_codigo IS NOT NULL OR p_estado IS NOT NULL OR p_rnc IS NOT NULL OR p_e_ncf IS NOT NULL OR p_fecha IS NOT NULL OR p_mensajes <> '[]'::jsonb OR p_secuencia IS NOT NULL)) OR (p_kind = 'RESULT_OBSERVED' AND (p_codigo IS NULL OR p_estado IS NULL OR (p_codigo IN (0,3) AND (p_rnc IS NOT NULL OR p_e_ncf IS NOT NULL OR p_fecha IS NOT NULL OR p_mensajes <> '[]'::jsonb OR p_secuencia IS NOT NULL)) OR (p_codigo IN (1,4) AND p_secuencia IS NOT NULL) OR (p_codigo = 2 AND p_secuencia IS NULL))) THEN RETURN QUERY SELECT 'invalid_event', NULL::bigint, NULL::boolean, NULL::boolean; RETURN; END IF;
  SELECT * INTO current FROM public.ecf31_delivery_current WHERE scope_id = p_scope_id AND ecf_type = 'E31' AND allocation_idempotency_key = p_allocation_key AND attempt_key = p_attempt_key FOR UPDATE;
  terminal := current.delivery_state IN ('ACCEPTED','REJECTED','ACCEPTED_CONDITIONAL'); applied := NOT terminal OR p_kind <> 'RESULT_OBSERVED'; flagged := terminal AND p_kind = 'RESULT_OBSERVED'; next_disposition := CASE WHEN p_codigo = 2 AND p_secuencia THEN 'CONSUMED_NON_REUSABLE' WHEN p_codigo = 2 THEN 'POTENTIALLY_REUSABLE_NO_BLIND_RESEND' END;
  INSERT INTO public.ecf31_delivery_events(scope_id, ecf_type, allocation_idempotency_key, attempt_key, event_key, event_kind, track_id, codigo, estado, rnc, e_ncf, fecha, mensajes, secuencia_utilizada, disposition, state_applied, anomaly) VALUES (p_scope_id, 'E31', p_allocation_key, p_attempt_key, p_event_key, p_kind, attempt.track_id, p_codigo, p_estado, p_rnc, p_e_ncf, p_fecha, p_mensajes, p_secuencia, next_disposition, applied, flagged) RETURNING public.ecf31_delivery_events.event_id INTO event_id;
  RETURN QUERY SELECT 'appended', event_id, applied, flagged;
END $$;
REVOKE EXECUTE ON FUNCTION public.append_ecf31_delivery_event(text, text, text, text, text, text, smallint, text, text, text, text, jsonb, boolean) FROM PUBLIC;
