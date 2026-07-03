-- Supabase: 기존 데이터 전부 삭제 (되돌릴 수 없음)

begin;

drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
grant all on schema public to public;
grant usage on schema public to anon, authenticated, service_role;

delete from auth.users;

commit;
