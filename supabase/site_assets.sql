-- ============================================================================
-- SürüngenMarket — Site görselleri (hero, logo, banner, kategori kartları)
-- schema.sql'den SONRA Supabase SQL Editor'de çalıştırın. is_admin() kullanır.
-- ============================================================================

create table if not exists public.site_assets (
  key          text primary key,          -- 'hero','logo','banner','cat_yilan' ...
  storage_path text,                       -- 'site-assets' bucket içindeki yol
  updated_at   timestamptz not null default now()
);

alter table public.site_assets enable row level security;

drop policy if exists site_assets_select on public.site_assets;
create policy site_assets_select on public.site_assets for select using (true);

drop policy if exists site_assets_admin on public.site_assets;
create policy site_assets_admin on public.site_assets for all
  using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

drop policy if exists "site-assets okuma" on storage.objects;
create policy "site-assets okuma" on storage.objects for select
  using (bucket_id = 'site-assets');

drop policy if exists "site-assets yazma" on storage.objects;
create policy "site-assets yazma" on storage.objects for insert
  with check (bucket_id = 'site-assets' and public.is_admin());

drop policy if exists "site-assets guncelle" on storage.objects;
create policy "site-assets guncelle" on storage.objects for update
  using (bucket_id = 'site-assets' and public.is_admin());

drop policy if exists "site-assets silme" on storage.objects;
create policy "site-assets silme" on storage.objects for delete
  using (bucket_id = 'site-assets' and public.is_admin());
