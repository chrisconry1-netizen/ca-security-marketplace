grant select,insert,update,delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
-- re-apply column-level restrictions after broad grant (mirrors Supabase default-grant situation)
revoke update on public.profiles, public.credentials, public.organizations, public.applications, public.conversation_members, public.notifications from authenticated;
grant update (display_name, phone_e164, avatar_path, timezone) on public.profiles to authenticated;
grant update (credential_number, issued_on, expires_on, document_path) on public.credentials to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b');
insert into public.profiles(id,account_type,display_name) values ('00000000-0000-0000-0000-00000000000a','worker','TEST A'),('00000000-0000-0000-0000-00000000000b','worker','TEST B');
insert into public.worker_profiles(user_id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b');
insert into public.credential_types(code,name) values ('ca_guard_registration','CA Guard Registration');
insert into public.credentials(worker_id,credential_type_id) select '00000000-0000-0000-0000-00000000000b', id from public.credential_types;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo T1 worker A sees B credentials (expect 0):
select count(*) from public.credentials;
\echo T2 worker A self-insert verified credential (expect RLS error):
\set ON_ERROR_STOP 0
insert into public.credentials(worker_id,credential_type_id,status) select auth.uid(), id, 'verified' from public.credential_types;
\echo T3 worker A escalates own platform_role (expect permission denied):
update public.profiles set platform_role='super_admin' where id=auth.uid();
\echo T4 worker A reads audit_logs (expect 0):
select count(*) from public.audit_logs;
reset role;
\echo T5 audit log update blocked (expect exception):
insert into public.audit_logs(actor_type,action,entity_type) values ('system','test','test');
update public.audit_logs set action='x';
