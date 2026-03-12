-- Per-property Wi‑Fi configuration (keyed by Cloudbeds propertyID)
-- Run in Supabase SQL Editor

create table if not exists public.property_wifi_configs (
  property_external_id text primary key,
  wifi_ssid text not null,
  wifi_password text null,
  -- Expected values for Wi‑Fi QR format: WPA | WEP | nopass
  wifi_security text not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_wifi_configs_updated_at
  on public.property_wifi_configs (updated_at desc);

-- Example rows (edit before running; safe to remove)
-- insert into public.property_wifi_configs (property_external_id, wifi_ssid, wifi_password, wifi_security)
-- values
--   ('172982356828288', 'HotelWiFi', 'ChangeMe1234', 'WPA'),
--   ('173603468177536', 'HotelWiFi-Guest', 'ChangeMe5678', 'WPA');

