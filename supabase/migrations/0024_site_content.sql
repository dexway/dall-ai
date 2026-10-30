-- Website content for the Content Creator: readable text from a few key pages and the photos pulled
-- from the site (stored in the private creative bucket), so motion videos are built from real content.
alter table public.creative_brands add column if not exists site_content jsonb;
alter table public.creative_brands add column if not exists site_imported_at timestamptz;
alter table public.creative_brands add column if not exists site_import_error text;

-- Seedance 2.5 (bytedance/seedance-2.5/text-to-video, verified in Higgsfield's API reference): off until an
-- admin confirms its price in /admin/creative. The price below is a placeholder, like the other seeds.
insert into public.provider_models (endpoint, name, kind, unit, usd_per_unit, allowed_params, max_seconds, enabled, tasks, quality_rank, image_param) values
  ('bytedance/seedance-2.5/text-to-video', 'Seedance 2.5 (video ads, up to 30s)', 'video', 'second', 0.05, '{prompt,aspect_ratio,duration,resolution}', 30, false, '{video_ad}', 5, null)
on conflict (provider, endpoint) do nothing;
