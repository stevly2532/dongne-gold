-- profiles 테이블에 email 컬럼을 추가하고, auth.users.email 과 자동 동기화.
-- 직원 관리 화면에서 이름이 없으면 이메일로 식별할 수 있게 한다.

alter table public.profiles
  add column if not exists email text;

-- 기존 사용자 이메일 백필 (auth.users 는 관리자(또는 SQL Editor 권한)만 SELECT 가능)
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null;

-- 새 사용자가 만들어질 때 profiles 행도 (없으면) 만들고 email 채움.
-- 이미 비슷한 트리거가 있을 수 있으니 OR REPLACE 로 안전하게 갱신.
create or replace function public.handle_new_user_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'staff')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user_profile_email on auth.users;
create trigger trg_handle_new_user_profile_email
  after insert on auth.users
  for each row
  execute function public.handle_new_user_profile_email();

-- 이메일이 변경되는 경우(거의 없지만) profiles.email 도 따라 갱신.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_handle_user_email_change on auth.users;
create trigger trg_handle_user_email_change
  after update of email on auth.users
  for each row
  execute function public.handle_user_email_change();

notify pgrst, 'reload schema';
