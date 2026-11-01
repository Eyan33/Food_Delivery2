-- Super admin hardening. Applied automatically on startup by
-- db/initDatabase.js (ensureAdminSupportSchema); provided here for manual use.
-- Every statement is idempotent.

-- Tokens issued before this timestamp are rejected. Set when an admin's
-- password or email is changed so old sessions stop working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after timestamptz;

-- What an audited admin request changed (secrets are redacted by the app).
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS details jsonb;
