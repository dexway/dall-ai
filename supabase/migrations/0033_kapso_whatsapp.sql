-- Get WhatsApp in minutes: each business becomes a customer on the platform's WhatsApp provider (Kapso).
-- Their connected number is a normal channel_connections row whose token is the "kapso-managed" marker.
alter table public.workspaces add column if not exists kapso_customer_id text unique;
