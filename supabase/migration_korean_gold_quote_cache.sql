-- 한국금시세 시세 라인업 JSON 캐시 (Vercel 등 클라우드 IP 403 시 폴백).
-- GitHub Actions 또는 로컬 `npm run sync:korean-gold-quotes` 로 갱신.
-- service role 만 접근 (RLS on, 정책 없음).

create table if not exists public.korean_gold_quote_cache (
  id text primary key default 'latest',
  payload jsonb not null,
  quote_at text null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.korean_gold_quote_cache enable row level security;

notify pgrst, 'reload schema';
