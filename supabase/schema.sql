-- ============================================================================
-- SürüngenMarket — Supabase Veritabanı Şeması
-- Bu dosyanın TAMAMINI Supabase panelinde SQL Editor'e yapıştırıp Run edin.
-- Tekrar çalıştırmak güvenlidir (idempotent).
-- ============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()

-- Güncelleme zaman damgası yardımcısı
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- profiles  (auth.users ile 1-1). role: 'user' | 'admin'
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  city        text,
  avatar_url  text,
  role        text not null default 'user' check (role in ('user','admin')),
  created_at  timestamptz not null default now()
);

-- Admin kontrolü (RLS içinde sonsuz döngüyü önlemek için security definer)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Yeni kullanıcı kaydolunca otomatik profil oluştur
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, city)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'city'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- categories
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  id     serial primary key,
  slug   text unique not null,
  name   text not null,
  sort   int not null default 0
);

-- ----------------------------------------------------------------------------
-- listings   (yalnız status='active' herkese görünür; price=0 => sahiplendirme)
-- ----------------------------------------------------------------------------
create table if not exists public.listings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  category_id  int references public.categories(id),
  title        text not null,
  species      text,
  morph        text,
  sex          text check (sex in ('m','f','x')),
  age_text     text,
  birth_year   int,
  price        int not null default 0 check (price >= 0),
  city         text,
  description  text,
  whatsapp     text,
  instagram    text,
  status       text not null default 'pending' check (status in ('pending','active','sold','removed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists listings_status_idx  on public.listings(status, created_at desc);
create index if not exists listings_user_idx     on public.listings(user_id);
create index if not exists listings_category_idx on public.listings(category_id);

drop trigger if exists listings_set_updated on public.listings;
create trigger listings_set_updated before update on public.listings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- listing_images (fotoğraf yolları — dosyalar Storage'da)
-- ----------------------------------------------------------------------------
create table if not exists public.listing_images (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists listing_images_listing_idx on public.listing_images(listing_id, position);

-- ----------------------------------------------------------------------------
-- favorites (kullanıcıya özel)
-- ----------------------------------------------------------------------------
create table if not exists public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ----------------------------------------------------------------------------
-- messages (kullanıcılar arası)
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid references public.listings(id) on delete set null,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists messages_pair_idx      on public.messages(sender_id, recipient_id, created_at);
create index if not exists messages_recipient_idx on public.messages(recipient_id, created_at);

-- ----------------------------------------------------------------------------
-- reports (şikayetler)
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid references public.listings(id) on delete cascade,
  reporter_id  uuid references public.profiles(id) on delete set null,
  reason       text not null,
  detail       text,
  status       text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- reviews (satıcı yorumları)
-- ----------------------------------------------------------------------------
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  rating      int not null check (rating between 1 and 5),
  body        text,
  created_at  timestamptz not null default now(),
  check (seller_id <> author_id)
);
create index if not exists reviews_seller_idx on public.reviews(seller_id, created_at desc);

-- ----------------------------------------------------------------------------
-- guides (bakım rehberleri — içerik DB'den; image_path null => placeholder)
-- ----------------------------------------------------------------------------
create table if not exists public.guides (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,
  name           text not null,
  latin          text,
  category_slug  text,
  level          text,
  lifespan       text,
  size           text,
  habitat        text,
  temperature    text,
  humidity       text,
  diet           text,
  body           jsonb not null default '[]'::jsonb,
  tips           jsonb not null default '[]'::jsonb,
  image_path     text,
  legal_warning  boolean not null default false,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.categories     enable row level security;
alter table public.listings       enable row level security;
alter table public.listing_images enable row level security;
alter table public.favorites      enable row level security;
alter table public.messages       enable row level security;
alter table public.reports        enable row level security;
alter table public.reviews        enable row level security;
alter table public.guides         enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- categories
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select using (true);
drop policy if exists categories_admin on public.categories;
create policy categories_admin on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

-- listings
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings for select
  using (status = 'active' or user_id = auth.uid() or public.is_admin());
drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings for insert with check (user_id = auth.uid());
drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists listings_delete on public.listings;
create policy listings_delete on public.listings for delete
  using (user_id = auth.uid() or public.is_admin());

-- listing_images
drop policy if exists li_select on public.listing_images;
create policy li_select on public.listing_images for select
  using (exists (select 1 from public.listings l where l.id = listing_id
    and (l.status = 'active' or l.user_id = auth.uid() or public.is_admin())));
drop policy if exists li_write on public.listing_images;
create policy li_write on public.listing_images for all
  using (exists (select 1 from public.listings l where l.id = listing_id and (l.user_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.listings l where l.id = listing_id and (l.user_id = auth.uid() or public.is_admin())));

-- favorites
drop policy if exists fav_all on public.favorites;
create policy fav_all on public.favorites for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- messages
drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select
  using (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_admin());
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert with check (sender_id = auth.uid());
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- reports
drop policy if exists rep_insert on public.reports;
create policy rep_insert on public.reports for insert with check (reporter_id = auth.uid());
drop policy if exists rep_select on public.reports;
create policy rep_select on public.reports for select using (reporter_id = auth.uid() or public.is_admin());
drop policy if exists rep_admin on public.reports;
create policy rep_admin on public.reports for update using (public.is_admin()) with check (public.is_admin());

-- reviews
drop policy if exists rev_select on public.reviews;
create policy rev_select on public.reviews for select using (true);
drop policy if exists rev_insert on public.reviews;
create policy rev_insert on public.reviews for insert with check (author_id = auth.uid());
drop policy if exists rev_delete on public.reviews;
create policy rev_delete on public.reviews for delete using (author_id = auth.uid() or public.is_admin());

-- guides
drop policy if exists guides_select on public.guides;
create policy guides_select on public.guides for select using (true);
drop policy if exists guides_admin on public.guides;
create policy guides_admin on public.guides for all
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- STORAGE  (bucket + politikalar)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

drop policy if exists "listing-images okuma" on storage.objects;
create policy "listing-images okuma" on storage.objects for select
  using (bucket_id = 'listing-images');

drop policy if exists "listing-images yukleme" on storage.objects;
create policy "listing-images yukleme" on storage.objects for insert
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "listing-images silme" on storage.objects;
create policy "listing-images silme" on storage.objects for delete
  using (bucket_id = 'listing-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ============================================================================
-- BAŞLANGIÇ VERİSİ — kategoriler
-- ============================================================================
insert into public.categories (slug, name, sort) values
  ('yilan',      'Yılanlar',                  1),
  ('kertenkele', 'Kertenkeleler & geckolar',  2),
  ('kaplumbaga', 'Kaplumbağalar',             3),
  ('amfibi',     'Amfibiler',                 4),
  ('eklem',      'Eklem bacaklılar',          5),
  ('memeli',     'Egzotik memeliler',         6),
  ('kus',        'Egzotik kuşlar',            7)
on conflict (slug) do nothing;

-- Rehber içerikleri: seed_guides.sql dosyasını AYRICA çalıştırın.
