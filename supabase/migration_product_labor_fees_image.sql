-- 공임표 제품 사진 저장: image_path 컬럼 + Storage 버킷 (public read)
-- Supabase SQL Editor 에서 1회 실행 후 API 스키마 reload.

alter table public.product_labor_fees
  add column if not exists image_path text;

-- Storage 버킷 생성 (public 읽기 허용, 인증 사용자만 쓰기/삭제)
-- file_size_limit 은 50MB (52428800 bytes) 로 명시. (Supabase 대시보드 기본값은 약 5MB라 화질 저하 원인이 됨)
insert into storage.buckets (id, name, public, file_size_limit)
values ('labor-fee-images', 'labor-fee-images', true, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- 기존 정책 정리 후 재생성
drop policy if exists "labor_fee_images_select_public" on storage.objects;
drop policy if exists "labor_fee_images_insert_auth" on storage.objects;
drop policy if exists "labor_fee_images_update_auth" on storage.objects;
drop policy if exists "labor_fee_images_delete_auth" on storage.objects;

create policy "labor_fee_images_select_public"
  on storage.objects for select
  using (bucket_id = 'labor-fee-images');

create policy "labor_fee_images_insert_auth"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'labor-fee-images');

create policy "labor_fee_images_update_auth"
  on storage.objects for update to authenticated
  using (bucket_id = 'labor-fee-images')
  with check (bucket_id = 'labor-fee-images');

create policy "labor_fee_images_delete_auth"
  on storage.objects for delete to authenticated
  using (bucket_id = 'labor-fee-images');

notify pgrst, 'reload schema';