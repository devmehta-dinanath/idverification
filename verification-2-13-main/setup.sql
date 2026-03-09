-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS cloudbeds_tokens (
    id int8 PRIMARY KEY, -- Singleton: always 1
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz DEFAULT now()
);

-- Optional: Add RLS policies if needed, but this is server-side only usually.
-- ALTER TABLE cloudbeds_tokens ENABLE ROW LEVEL SECURITY;

-- Insert initial row if needed (optional, code handles upsert)

-- ── Cloudbeds Integration: new columns on demo_sessions ─────────────────────
-- Run these if the demo_sessions table already exists:
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS cloudbeds_reservation_id text;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS cloudbeds_property_id text;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS physical_room text;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS room_access_code text;

-- Notification tracking for check-in details (email/SMS)
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS checkin_email_sent_at timestamptz;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS checkin_email_sent_to text;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS checkin_sms_sent_to text;
ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS checkin_notification_attempts integer DEFAULT 0;

-- These columns store the Cloudbeds reservation reference so that
-- document uploads and verification notes can be pushed back to the PMS.
