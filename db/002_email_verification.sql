ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_session_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS registrations_session_hash_idx
  ON registrations (registration_session_hash)
  WHERE registration_session_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS registrations_email_verification_token_hash_idx
  ON registrations (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;