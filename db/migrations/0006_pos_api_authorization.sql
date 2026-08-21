DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dgii_backend_runtime') THEN RAISE EXCEPTION 'required role dgii_backend_runtime is absent'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_principals (
  subject_id text PRIMARY KEY CHECK (subject_id ~ '^[A-Za-z0-9_-]{1,128}$'), created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS pos_api_credentials (
  key_id text PRIMARY KEY CHECK (key_id ~ '^[A-Za-z0-9_-]{20}$'), subject_id text NOT NULL REFERENCES pos_principals(subject_id), digest bytea NOT NULL CHECK (octet_length(digest) = 32), revision integer NOT NULL CHECK (revision > 0), valid_from timestamptz NOT NULL, expires_at timestamptz, revoked_at timestamptz,
  active boolean GENERATED ALWAYS AS (revoked_at IS NULL) STORED, UNIQUE(subject_id, revision), CHECK (expires_at IS NULL OR expires_at > valid_from)
);
CREATE TABLE IF NOT EXISTS pos_scope_memberships (
  membership_id text PRIMARY KEY CHECK (membership_id ~ '^[A-Za-z0-9_-]{20}$'), subject_id text NOT NULL REFERENCES pos_principals(subject_id), scope_id text NOT NULL CHECK (scope_id ~ '^[A-Za-z0-9_-]{1,128}$'), environment text NOT NULL CHECK (environment IN ('testecf', 'certecf', 'ecf')), revision integer NOT NULL CHECK (revision > 0), valid_from timestamptz NOT NULL, expires_at timestamptz, revoked_at timestamptz,
  active boolean GENERATED ALWAYS AS (revoked_at IS NULL) STORED, UNIQUE(subject_id, revision), CHECK (expires_at IS NULL OR expires_at > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_scope_memberships_one_active_subject ON pos_scope_memberships(subject_id) WHERE active;
CREATE TABLE IF NOT EXISTS pos_authorization_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event text NOT NULL CHECK (event IN ('principal_created', 'credential_created', 'credential_revoked', 'membership_created', 'membership_revoked')), subject_id text NOT NULL, key_id text, membership_id text, scope_id text, revision integer, actor text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE OR REPLACE FUNCTION pos_reject_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'POS authorization records are immutable'; END $$;
CREATE OR REPLACE FUNCTION pos_allow_revocation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'POS authorization records are immutable'; END IF;
  IF OLD.key_id IS NOT DISTINCT FROM NEW.key_id AND OLD.subject_id IS NOT DISTINCT FROM NEW.subject_id AND OLD.digest IS NOT DISTINCT FROM NEW.digest AND OLD.revision IS NOT DISTINCT FROM NEW.revision AND OLD.valid_from IS NOT DISTINCT FROM NEW.valid_from AND OLD.expires_at IS NOT DISTINCT FROM NEW.expires_at AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF; RAISE EXCEPTION 'POS credential changes must be one-way revocations';
END $$;
CREATE OR REPLACE FUNCTION pos_allow_membership_revocation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'POS authorization records are immutable'; END IF;
  IF OLD.membership_id IS NOT DISTINCT FROM NEW.membership_id AND OLD.subject_id IS NOT DISTINCT FROM NEW.subject_id AND OLD.scope_id IS NOT DISTINCT FROM NEW.scope_id AND OLD.environment IS NOT DISTINCT FROM NEW.environment AND OLD.revision IS NOT DISTINCT FROM NEW.revision AND OLD.valid_from IS NOT DISTINCT FROM NEW.valid_from AND OLD.expires_at IS NOT DISTINCT FROM NEW.expires_at AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF; RAISE EXCEPTION 'POS membership changes must be one-way revocations';
END $$;
CREATE OR REPLACE FUNCTION pos_audit_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN
  IF TG_TABLE_NAME='pos_principals' THEN INSERT INTO public.pos_authorization_audit(event,subject_id,actor) VALUES ('principal_created',NEW.subject_id,SESSION_USER);
  ELSIF TG_TABLE_NAME='pos_api_credentials' THEN INSERT INTO public.pos_authorization_audit(event,subject_id,key_id,revision,actor) VALUES (CASE WHEN TG_OP='INSERT' THEN 'credential_created' ELSE 'credential_revoked' END,NEW.subject_id,NEW.key_id,NEW.revision,SESSION_USER);
  ELSE INSERT INTO public.pos_authorization_audit(event,subject_id,membership_id,scope_id,revision,actor) VALUES (CASE WHEN TG_OP='INSERT' THEN 'membership_created' ELSE 'membership_revoked' END,NEW.subject_id,NEW.membership_id,NEW.scope_id,NEW.revision,SESSION_USER); END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pos_principals_immutable ON pos_principals; CREATE TRIGGER pos_principals_immutable BEFORE UPDATE OR DELETE ON pos_principals FOR EACH ROW EXECUTE FUNCTION pos_reject_change();
DROP TRIGGER IF EXISTS pos_credentials_immutable ON pos_api_credentials; CREATE TRIGGER pos_credentials_immutable BEFORE UPDATE OR DELETE ON pos_api_credentials FOR EACH ROW EXECUTE FUNCTION pos_allow_revocation();
DROP TRIGGER IF EXISTS pos_memberships_immutable ON pos_scope_memberships; CREATE TRIGGER pos_memberships_immutable BEFORE UPDATE OR DELETE ON pos_scope_memberships FOR EACH ROW EXECUTE FUNCTION pos_allow_membership_revocation();
DROP TRIGGER IF EXISTS pos_audit_immutable ON pos_authorization_audit; CREATE TRIGGER pos_audit_immutable BEFORE UPDATE OR DELETE ON pos_authorization_audit FOR EACH ROW EXECUTE FUNCTION pos_reject_change();
DROP TRIGGER IF EXISTS pos_principals_audit ON pos_principals; CREATE TRIGGER pos_principals_audit AFTER INSERT ON pos_principals FOR EACH ROW EXECUTE FUNCTION pos_audit_change();
DROP TRIGGER IF EXISTS pos_credentials_audit ON pos_api_credentials; CREATE TRIGGER pos_credentials_audit AFTER INSERT OR UPDATE ON pos_api_credentials FOR EACH ROW EXECUTE FUNCTION pos_audit_change();
DROP TRIGGER IF EXISTS pos_memberships_audit ON pos_scope_memberships; CREATE TRIGGER pos_memberships_audit AFTER INSERT OR UPDATE ON pos_scope_memberships FOR EACH ROW EXECUTE FUNCTION pos_audit_change();

CREATE OR REPLACE FUNCTION resolve_pos_authorization(p_key_id text, p_digest bytea)
RETURNS TABLE(outcome text, subject_id text, credential_revision text, credential_expires_at timestamptz, scope_id text, environment text, membership_revision text, membership_expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE credential public.pos_api_credentials%ROWTYPE; membership public.pos_scope_memberships%ROWTYPE; dummy bytea := pg_catalog.decode(pg_catalog.repeat('00',32),'hex'); supplied bytea; stored bytea := dummy; difference integer := 0; position integer; found_credential boolean := false;
BEGIN
  supplied := CASE WHEN pg_catalog.octet_length(p_digest)=32 THEN p_digest ELSE dummy END;
  IF p_key_id ~ '^[A-Za-z0-9_-]{20}$' THEN SELECT * INTO credential FROM public.pos_api_credentials WHERE key_id=p_key_id; found_credential := FOUND; IF found_credential THEN stored := credential.digest; END IF; END IF;
  FOR position IN 0..31 LOOP difference := difference | (pg_catalog.get_byte(supplied,position) # pg_catalog.get_byte(stored,position)); END LOOP;
  IF difference <> 0 OR NOT found_credential OR NOT credential.active OR credential.valid_from > pg_catalog.statement_timestamp() OR (credential.expires_at IS NOT NULL AND credential.expires_at <= pg_catalog.statement_timestamp()) THEN RETURN QUERY SELECT 'authorization_denied',NULL::text,NULL::text,NULL::timestamptz,NULL::text,NULL::text,NULL::text,NULL::timestamptz; RETURN; END IF;
  SELECT m.* INTO membership FROM public.pos_scope_memberships AS m WHERE m.subject_id=credential.subject_id AND m.active AND m.valid_from <= pg_catalog.statement_timestamp() AND (m.expires_at IS NULL OR m.expires_at > pg_catalog.statement_timestamp());
  IF NOT FOUND THEN RETURN QUERY SELECT 'authorization_denied',NULL::text,NULL::text,NULL::timestamptz,NULL::text,NULL::text,NULL::text,NULL::timestamptz; RETURN; END IF;
  RETURN QUERY SELECT 'resolved',credential.subject_id,credential.revision::text,credential.expires_at,membership.scope_id,CASE membership.environment WHEN 'testecf' THEN 'TesteCF' WHEN 'certecf' THEN 'CerteCF' ELSE 'production' END,membership.revision::text,membership.expires_at;
END $$;

REVOKE ALL ON TABLE pos_principals, pos_api_credentials, pos_scope_memberships, pos_authorization_audit FROM PUBLIC, dgii_backend_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, dgii_backend_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, dgii_backend_runtime;
REVOKE EXECUTE ON FUNCTION pos_reject_change(), pos_allow_revocation(), pos_allow_membership_revocation(), pos_audit_change(), resolve_pos_authorization(text,bytea) FROM PUBLIC, dgii_backend_runtime;
REVOKE EXECUTE ON FUNCTION public.allocate_fiscal_sequence(text,text,text,text,date), public.store_ecf31_draft_evidence(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_pos_authorization(text,bytea) TO dgii_backend_runtime;
