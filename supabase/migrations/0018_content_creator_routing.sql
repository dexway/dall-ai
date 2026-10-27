-- Content Creator: task-based model routing. The Creative Director auto-picks the best enabled model per task.
alter table public.provider_models
  add column if not exists tasks text[] not null default '{}',
  add column if not exists quality_rank int not null default 100,
  add column if not exists image_param text;            -- provider field for the owner's reference photo(s), e.g. image_url

-- Recommended catalogue (Oct 2026). All DISABLED with placeholder prices: an admin must confirm each path,
-- parameters and real price on Higgsfield before enabling. Nothing can be generated until they do.
insert into public.provider_models (endpoint, name, kind, unit, usd_per_unit, allowed_params, max_seconds, enabled, tasks, quality_rank, image_param) values
  ('marketing-studio/image',                 'Marketing Studio Image (product ads)', 'image', 'image',  0.01, '{prompt,aspect_ratio,resolution}', null, false, '{product_photo,poster}', 10, 'image_url'),
  ('openai/gpt-image-2',                     'GPT Image 2 (text & posters)',         'image', 'image',  0.01, '{prompt,aspect_ratio,resolution}', null, false, '{poster,lifestyle_photo}', 20, null),
  ('openai/gpt-image-2/edit',                'GPT Image 2 Edit (edit my photo)',     'image', 'image',  0.01, '{prompt,aspect_ratio,resolution}', null, false, '{photo_edit,product_photo}', 15, 'image_url'),
  ('higgsfield-ai/soul/v2/standard',         'Soul 2 (realistic people)',            'image', 'image',  0.0032, '{prompt,aspect_ratio}',          null, false, '{lifestyle_photo,product_photo}', 20, 'image_url'),
  ('higgsfield-ai/cinema-studio/v2.5',       'Cinema Studio 2.5 (cinematic)',        'image', 'image',  0.01, '{prompt,aspect_ratio,resolution}', null, false, '{cinematic}', 10, null),
  ('kling-video/v4.0/image-to-video',        'Kling 4 (animate a photo)',            'video', 'second', 0.1,  '{prompt,aspect_ratio,duration}',   10,   false, '{animate_photo}', 10, 'image_url'),
  ('bytedance/seedance-2.0/image-to-video',  'Seedance 2 (animate, value)',          'video', 'second', 0.05, '{prompt,aspect_ratio,duration,resolution}', 10, false, '{animate_photo}', 20, 'image_url'),
  ('bytedance/seedance-2.0/text-to-video',   'Seedance 2 (video ads)',               'video', 'second', 0.05, '{prompt,aspect_ratio,duration,resolution}', 10, false, '{video_ad}', 10, null),
  ('kling-video/v4.0/text-to-video',         'Kling 4 (premium video ads)',          'video', 'second', 0.1,  '{prompt,aspect_ratio,duration}',   10,   false, '{video_ad}', 20, null)
on conflict (provider, endpoint) do update set tasks = excluded.tasks, quality_rank = excluded.quality_rank, image_param = coalesce(public.provider_models.image_param, excluded.image_param);
