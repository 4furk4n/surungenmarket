-- ============================================================================
-- SürüngenMarket — Takip sistemi
-- schema.sql'den SONRA Supabase SQL Editor'de çalıştırın.
-- ============================================================================

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  seller_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, seller_id),
  check (follower_id <> seller_id)
);
create index if not exists follows_seller_idx   on public.follows(seller_id);
create index if not exists follows_follower_idx  on public.follows(follower_id);

alter table public.follows enable row level security;

-- Sayılar herkese açık (takipçi/takip sayısı görünsün)
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select using (true);

-- Yalnız kendi adına takip ekle/çıkar
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert with check (follower_id = auth.uid());

drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete using (follower_id = auth.uid());
