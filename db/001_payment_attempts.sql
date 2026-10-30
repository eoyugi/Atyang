CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGSERIAL PRIMARY KEY,
  registration_id BIGINT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  payer_phone VARCHAR(15) NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  checkout_request_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  result_code INTEGER,
  result_description TEXT,
  mpesa_receipt_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_attempts_registration_id_idx
  ON payment_attempts (registration_id);

CREATE INDEX IF NOT EXISTS payment_attempts_status_idx
  ON payment_attempts (status);