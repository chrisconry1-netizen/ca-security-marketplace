-- =====================================================================
-- 0002_storage_buckets.sql — Phase 1: private storage buckets + RLS
-- ALL buckets private. Cross-user reads only via short-lived signed URLs
-- issued by server code after an authorization check.
-- Path conventions:
--   avatars/{user_id}/{uuid}.{ext}
--   credential-documents/{user_id}/{uuid}.{ext}
--   le-documents/{user_id}/{uuid}.{ext}
--   org-logos/{organization_id}/{uuid}.{ext}
--   message-attachments/{conversation_id}/{user_id}/{uuid}.{ext}
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',              'avatars',              false,  2097152, array['image/jpeg','image/png','image/webp']),
  ('org-logos',            'org-logos',            false,  2097152, array['image/jpeg','image/png','image/webp']),
  ('credential-documents', 'credential-documents', false, 10485760, array['application/pdf','image/jpeg','image/png','image/heic']),
  ('le-documents',         'le-documents',         false, 10485760, array['application/pdf','image/jpeg','image/png','image/heic']),
  ('message-attachments',  'message-attachments',  false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.try_uuid(p text) returns uuid language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;
grant execute on function app.try_uuid(text) to authenticated, anon;

-- Avatars: owner manages own folder.
create policy avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Credential + LE documents: owner may upload and read own; no client update/delete
-- (evidence preservation — replacement = new object; removal via server/admin).
-- LE documents additionally require a worker account.
create policy creddocs_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'credential-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy creddocs_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'credential-documents' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'worker'));
create policy ledocs_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'le-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ledocs_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'le-documents' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'worker'));

-- Org logos: org members read; owner_admin writes.
create policy orglogos_member_select on storage.objects for select to authenticated
  using (bucket_id = 'org-logos' and app.is_org_member(app.try_uuid((storage.foldername(name))[1])));
create policy orglogos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-logos'
    and app.is_org_member(app.try_uuid((storage.foldername(name))[1]), array['owner_admin']::public.org_member_role[]));
create policy orglogos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'org-logos'
    and app.is_org_member(app.try_uuid((storage.foldername(name))[1]), array['owner_admin']::public.org_member_role[]))
  with check (bucket_id = 'org-logos'
    and app.is_org_member(app.try_uuid((storage.foldername(name))[1]), array['owner_admin']::public.org_member_role[]));
create policy orglogos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-logos'
    and app.is_org_member(app.try_uuid((storage.foldername(name))[1]), array['owner_admin']::public.org_member_role[]));

-- Message attachments: conversation members read; uploader must be a member and
-- write under their own user folder. No client update/delete.
create policy msgatt_member_select on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments'
    and app.is_conversation_member(app.try_uuid((storage.foldername(name))[1])));
create policy msgatt_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'message-attachments'
    and app.is_conversation_member(app.try_uuid((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = auth.uid()::text);
