-- LinkBox shared content and secure admin-only writes.
-- IMPORTANT: replace c8e4e368-a1e4-401e-b593-e2763867c091 with the UID shown in
-- Supabase > Authentication > Users, then run this whole file in SQL Editor.
create table if not exists public.linkbox_content (
  id integer primary key check (id = 1),
  data jsonb not null default '{"categories":[{"id":"all","name":"همه لینک‌ها","isSystem":true,"color":"#4f6ef7"}],"links":[],"theme":"light","activeCategory":"all","updatedAt":0}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.linkbox_content enable row level security;

drop policy if exists "Public can read linkbox" on public.linkbox_content;
create policy "Public can read linkbox" on public.linkbox_content
  for select to anon, authenticated using (true);

drop policy if exists "Only owner can insert linkbox" on public.linkbox_content;
create policy "Only owner can insert linkbox" on public.linkbox_content
  for insert to authenticated
  with check ((select auth.uid()) = 'c8e4e368-a1e4-401e-b593-e2763867c091'::uuid);

drop policy if exists "Only owner can update linkbox" on public.linkbox_content;
create policy "Only owner can update linkbox" on public.linkbox_content
  for update to authenticated
  using ((select auth.uid()) = 'c8e4e368-a1e4-401e-b593-e2763867c091'::uuid)
  with check ((select auth.uid()) = 'c8e4e368-a1e4-401e-b593-e2763867c091'::uuid);

grant usage on schema public to anon, authenticated;
grant select on public.linkbox_content to anon, authenticated;
grant insert, update on public.linkbox_content to authenticated;
