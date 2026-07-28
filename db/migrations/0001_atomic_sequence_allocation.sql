CREATE TABLE IF NOT EXISTS sequence_counters (
  scope_id text NOT NULL CHECK (scope_id <> ''),
  ecf_type text NOT NULL CHECK (ecf_type <> ''),
  range_start bigint NOT NULL CHECK (range_start BETWEEN 0 AND 9999999999),
  range_end bigint NOT NULL CHECK (range_end BETWEEN range_start AND 9999999999),
  next_value bigint NOT NULL CHECK (next_value BETWEEN range_start AND 10000000000),
  valid_from date NOT NULL,
  valid_to date NOT NULL CHECK (valid_to >= valid_from),
  PRIMARY KEY (scope_id, ecf_type)
);

CREATE TABLE IF NOT EXISTS sequence_allocation_requests (
  scope_id text NOT NULL,
  ecf_type text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  request_fingerprint text NOT NULL CHECK (request_fingerprint <> ''),
  allocated_value bigint NOT NULL CHECK (allocated_value BETWEEN 0 AND 9999999999),
  PRIMARY KEY (scope_id, ecf_type, idempotency_key),
  FOREIGN KEY (scope_id, ecf_type) REFERENCES sequence_counters (scope_id, ecf_type)
);

CREATE OR REPLACE FUNCTION allocate_fiscal_sequence(
  p_scope_id text,
  p_ecf_type text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_requested_on date
) RETURNS TABLE (outcome text, allocated_value bigint)
LANGUAGE plpgsql AS $$
DECLARE
  counter sequence_counters%ROWTYPE;
  request sequence_allocation_requests%ROWTYPE;
BEGIN
  IF p_scope_id IS NULL OR p_ecf_type IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key = '' OR p_request_fingerprint IS NULL OR p_request_fingerprint = '' OR p_requested_on IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO counter FROM sequence_counters
  WHERE scope_id = p_scope_id AND ecf_type = p_ecf_type FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unprovisioned'::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO request FROM sequence_allocation_requests
  WHERE scope_id = p_scope_id AND ecf_type = p_ecf_type AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF request.request_fingerprint <> p_request_fingerprint THEN
      RETURN QUERY SELECT 'idempotency_conflict'::text, NULL::bigint;
    ELSE
      RETURN QUERY SELECT 'replayed'::text, request.allocated_value;
    END IF;
    RETURN;
  END IF;

  IF p_requested_on IS NULL OR p_requested_on NOT BETWEEN counter.valid_from AND counter.valid_to THEN
    RETURN QUERY SELECT 'outside_validity'::text, NULL::bigint;
    RETURN;
  END IF;
  IF counter.next_value > counter.range_end THEN
    RETURN QUERY SELECT 'exhausted'::text, NULL::bigint;
    RETURN;
  END IF;

  INSERT INTO sequence_allocation_requests (
    scope_id, ecf_type, idempotency_key, request_fingerprint, allocated_value
  ) VALUES (
    p_scope_id, p_ecf_type, p_idempotency_key, p_request_fingerprint, counter.next_value
  );
  UPDATE sequence_counters SET next_value = next_value + 1
  WHERE scope_id = p_scope_id AND ecf_type = p_ecf_type;
  RETURN QUERY SELECT 'allocated'::text, counter.next_value;
END;
$$;
