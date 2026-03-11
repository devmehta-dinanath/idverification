-- Supabase table for storing verified guest rows (replacement for Google Sheets log)
create table if not exists public.verified_guest_rows (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),

    -- Session & guest context
    session_token text,
    guest_index integer,

    -- Guest identity
    first_name text,
    middle_name text,
    last_name text,
    gender text,
    passport_no text,
    nationality text,
    birth_date text,

    -- Stay & room info
    start_date text,
    end_date text,
    room text,
    room_type text,

    -- Contact
    phone text,
    email text,

    -- Verification metadata
    verified_at timestamptz,
    verification_score numeric,

    -- Optional Cloudbeds linkage
    cloudbeds_reservation_id text,
    cloudbeds_property_id text
);

create index if not exists idx_verified_guest_rows_session_token
    on public.verified_guest_rows (session_token);

create index if not exists idx_verified_guest_rows_verified_at
    on public.verified_guest_rows (verified_at);

