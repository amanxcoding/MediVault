-- Partial-install repair only; this file does not initialize an empty schema.
-- For an empty public schema, use supabase/migrations/202610170001_initial_medivault_schema.sql.
-- READ THIS FIRST: run supabase/verify_medivault_schema.sql before this script.
-- This script never creates/drops application tables and never alters ownership,
-- grants, or RLS configuration on Supabase-managed storage.objects.
-- It only repairs RLS/policies/grants/triggers when the full expected schema exists.
do $$
declare
 missing text;
 policy_sql text;
 policy_name text;
 policies text[] := array[
  'create policy profile_self_read on public.profiles for select to authenticated using(id=(select auth.uid()))',
  'create policy profile_self_edit on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()))',
  'create policy family_member_read on public.families for select to authenticated using(public.is_family_member(id))',
  'create policy family_admin_edit on public.families for update to authenticated using(public.has_family_role(id,array[''owner'',''administrator''])) with check(public.has_family_role(id,array[''owner'',''administrator'']))',
  'create policy membership_read on public.family_memberships for select to authenticated using(user_id=(select auth.uid()) or public.has_family_role(family_id,array[''owner'',''administrator'']))',
  'create policy family_members_read on public.family_members for select to authenticated using(public.can_access_member(id,''read'') and archived_at is null)',
  'create policy family_members_create on public.family_members for insert to authenticated with check(is_dependent and user_id is null and public.has_family_role(family_id,array[''owner'',''administrator'']) and created_by=(select auth.uid()))',
  'create policy family_members_edit on public.family_members for update to authenticated using((user_id=(select auth.uid()) and public.is_family_member(family_id) and not is_dependent) or (is_dependent and user_id is null and public.has_family_role(family_id,array[''owner'',''administrator'']))) with check((user_id=(select auth.uid()) and public.is_family_member(family_id) and not is_dependent) or (is_dependent and user_id is null and public.has_family_role(family_id,array[''owner'',''administrator''])))',
  'create policy grants_read on public.member_access_grants for select to authenticated using(grantee_user_id=(select auth.uid()) or public.can_manage_member_access(member_id))',
  'create policy grants_manage on public.member_access_grants for all to authenticated using(public.can_manage_member_access(member_id)) with check(public.can_manage_member_access(member_id) and granted_by=(select auth.uid()))',
  'create policy records_read on public.medical_records for select to authenticated using(public.can_access_member(member_id,''read'') and archived_at is null)',
  'create policy records_create on public.medical_records for insert to authenticated with check(public.can_access_member(member_id,''write'') and uploaded_by=(select auth.uid()) and exists(select 1 from public.family_members m where m.id=medical_records.member_id and m.family_id=medical_records.family_id))',
  'create policy records_edit on public.medical_records for update to authenticated using(public.can_access_member(member_id,''write'') and archived_at is null) with check(public.can_access_member(member_id,''write''))',
  'create policy records_delete on public.medical_records for delete to authenticated using(public.can_access_member(member_id,''delete''))',
  'create policy extracted_read on public.extracted_medical_data for select to authenticated using(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,''read'')))',
  'create policy extracted_create on public.extracted_medical_data for insert to authenticated with check(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,''write'')))',
  'create policy extracted_edit on public.extracted_medical_data for update to authenticated using(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,''write''))) with check(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,''write'')))',
  'create policy conditions_access on public.medical_conditions for all to authenticated using(public.can_access_member(member_id,''read'')) with check(public.can_access_member(member_id,''write''))',
  'create policy allergies_access on public.allergies for all to authenticated using(public.can_access_member(member_id,''read'')) with check(public.can_access_member(member_id,''write''))',
  'create policy medications_access on public.medications for all to authenticated using(public.can_access_member(member_id,''read'')) with check(public.can_access_member(member_id,''write'') and created_by=(select auth.uid()))',
  'create policy dose_logs_access on public.medication_dose_logs for all to authenticated using(public.can_access_member(member_id,''read'')) with check(public.can_access_member(member_id,''write'') and (created_by is null or created_by=(select auth.uid())))',
  'create policy timeline_access on public.timeline_events for all to authenticated using(public.can_access_member(member_id,''read'')) with check(public.can_access_member(member_id,''write''))',
  'create policy share_sessions_owner_read on public.share_sessions for select to authenticated using(created_by=(select auth.uid()) and public.can_access_member(member_id,''share''))',
  'create policy share_documents_owner_read on public.share_session_documents for select to authenticated using(exists(select 1 from public.share_sessions s where s.id=share_id and s.created_by=(select auth.uid()) and public.can_access_member(member_id,''share'')))',
  $policy$create policy audit_insert_access on public.audit_events for insert to authenticated with check(actor_user_id=(select auth.uid()) and ((member_id is null and (family_id is null or public.is_family_member(family_id))) or (member_id is not null and (public.can_access_member(member_id,'read') or public.can_access_member(member_id,'share')))))$policy$,
  'create policy audit_admin_read on public.audit_events for select to authenticated using(family_id is not null and public.has_family_role(family_id,array[''owner'',''administrator'']))',
  'create policy provider_active_read on public.lab_providers for select to authenticated using(is_active)',
  'create policy bookings_access on public.lab_bookings for all to authenticated using(public.can_access_member(member_id,''read'')) with check(public.can_access_member(member_id,''write'') and created_by=(select auth.uid()))',
  'create policy notifications_self on public.notifications for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',
  'create policy reminder_preferences_self on public.reminder_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))'
 ];
begin
 select string_agg(n, ', ') into missing from unnest(array[
  'profiles','families','family_memberships','family_members','member_access_grants','medical_records',
  'extracted_medical_data','medical_conditions','allergies','medications','medication_dose_logs','timeline_events',
  'share_sessions','share_session_documents','audit_events','lab_providers','lab_bookings','notifications','reminder_preferences'
 ]) n where to_regclass('public.'||quote_ident(n)) is null;
 if missing is not null then
  raise exception 'Recovery stopped: missing expected application tables (%). This repair file cannot initialize an empty schema. Run the read-only verifier; for a clean empty schema, review and use supabase/migrations/202610170001_initial_medivault_schema.sql.', missing;
 end if;
 if to_regprocedure('public.set_updated_at()') is null
  or to_regprocedure('public.is_family_member(uuid)') is null
  or to_regprocedure('public.has_family_role(uuid,text[])') is null
  or to_regprocedure('public.can_manage_member_access(uuid)') is null
  or to_regprocedure('public.can_access_member(uuid,text)') is null
  or to_regprocedure('public.prevent_member_reassignment()') is null
  or to_regprocedure('public.prevent_family_member_reassignment()') is null
  or to_regprocedure('public.create_record_timeline_event()') is null
  or to_regprocedure('public.handle_new_user()') is null
  or to_regprocedure('public.create_share_session(uuid,text,timestamp with time zone,uuid[])') is null
  or to_regprocedure('public.resolve_share_session(text)') is null
  or to_regprocedure('public.authorize_shared_document(text,uuid)') is null
  or to_regprocedure('public.revoke_share_session(uuid)') is null
  or to_regprocedure('public.storage_path_member_access(text,text)') is null then
  raise exception 'Recovery stopped: required MediVault authorization functions are missing. Review partial state before repair.';
 end if;
 execute 'alter table public.profiles enable row level security';
 execute 'alter table public.families enable row level security';
 execute 'alter table public.family_memberships enable row level security';
 execute 'alter table public.family_members enable row level security';
 execute 'alter table public.member_access_grants enable row level security';
 execute 'alter table public.medical_records enable row level security';
 execute 'alter table public.extracted_medical_data enable row level security';
 execute 'alter table public.medical_conditions enable row level security';
 execute 'alter table public.allergies enable row level security';
 execute 'alter table public.medications enable row level security';
 execute 'alter table public.medication_dose_logs enable row level security';
 execute 'alter table public.timeline_events enable row level security';
 execute 'alter table public.share_sessions enable row level security';
 execute 'alter table public.share_session_documents enable row level security';
 execute 'alter table public.audit_events enable row level security';
 execute 'alter table public.lab_providers enable row level security';
 execute 'alter table public.lab_bookings enable row level security';
 execute 'alter table public.notifications enable row level security';
 execute 'alter table public.reminder_preferences enable row level security';
 foreach policy_sql in array policies loop
  policy_name := split_part(policy_sql, ' ', 3);
  if not exists(select 1 from pg_policies where schemaname='public' and policyname=policy_name) then
   execute policy_sql;
  end if;
 end loop;
end $$;

-- Reassert least-privilege application table grants (idempotent).
revoke all on table public.profiles, public.families, public.family_memberships, public.family_members,
 public.member_access_grants, public.medical_records, public.extracted_medical_data, public.medical_conditions,
 public.allergies, public.medications, public.medication_dose_logs, public.timeline_events, public.share_sessions,
 public.share_session_documents, public.audit_events, public.lab_providers, public.lab_bookings,
 public.notifications, public.reminder_preferences from public,anon,authenticated;
grant select,update on public.profiles,public.families to authenticated;
grant select on public.family_memberships to authenticated;
grant select,insert,update on public.family_members to authenticated;
grant select,insert,update,delete on public.member_access_grants,public.medical_records to authenticated;
grant select,insert,update on public.extracted_medical_data to authenticated;
grant select,insert,update,delete on public.medical_conditions,public.allergies,public.medications,public.medication_dose_logs,public.timeline_events to authenticated;
grant select on public.share_sessions,public.share_session_documents,public.lab_providers to authenticated;
grant select,insert on public.audit_events to authenticated;
grant select,insert,update,delete on public.lab_bookings,public.notifications,public.reminder_preferences to authenticated;
grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.has_family_role(uuid,text[]) to authenticated;
grant execute on function public.can_manage_member_access(uuid) to authenticated;
grant execute on function public.can_access_member(uuid,text) to authenticated;
grant execute on function public.create_share_session(uuid,text,timestamptz,uuid[]) to authenticated;
grant execute on function public.resolve_share_session(text) to anon,authenticated;
grant execute on function public.authorize_shared_document(text,uuid) to anon,authenticated;
grant execute on function public.revoke_share_session(uuid) to authenticated;
grant execute on function public.storage_path_member_access(text,text) to authenticated;
revoke all on function public.set_updated_at() from public,anon,authenticated;
revoke all on function public.is_family_member(uuid) from public,anon;
revoke all on function public.has_family_role(uuid,text[]) from public,anon;
revoke all on function public.can_manage_member_access(uuid) from public,anon;
revoke all on function public.can_access_member(uuid,text) from public,anon;
revoke all on function public.prevent_member_reassignment() from public,anon,authenticated;
revoke all on function public.prevent_family_member_reassignment() from public,anon,authenticated;
revoke all on function public.create_record_timeline_event() from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.create_share_session(uuid,text,timestamptz,uuid[]) from public,anon;
revoke all on function public.resolve_share_session(text) from public;
revoke all on function public.authorize_shared_document(text,uuid) from public;
revoke all on function public.revoke_share_session(uuid) from public,anon;
revoke all on function public.storage_path_member_access(text,text) from public,anon;
revoke all on sequence public.audit_events_id_seq from public,anon,authenticated;
grant usage on sequence public.audit_events_id_seq to authenticated;

-- Restore missing updated_at triggers without replacing any existing trigger.
do $$ declare t text;
begin
 foreach t in array array['profiles','families','family_members','medical_records','extracted_medical_data',
  'medical_conditions','allergies','medications','medication_dose_logs','timeline_events','lab_bookings','reminder_preferences'] loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||quote_ident(t)) and tgname='set_updated_at' and not tgisinternal) then
   execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
  end if;
 end loop;
end $$;

-- Bucket creation is attempted only if absent. Existing bucket settings are never overwritten.
do $$ begin
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('medical-records','medical-records',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp'])
 on conflict(id) do nothing;
exception when insufficient_privilege then
 raise warning 'Bucket creation was not permitted. A project owner must ensure medical-records exists and is private.';
end $$;
do $$ begin
 if not exists(select 1 from storage.buckets where id='medical-records' and name='medical-records' and public=false
   and file_size_limit=20971520 and allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp']) then
  raise exception 'medical-records bucket is missing or has incompatible settings; stop and have a project owner review it.';
 end if;
end $$;

-- Storage RLS is managed by Supabase. Never ALTER storage.objects; these policy
-- creates are best-effort and emit warnings if the SQL Editor role lacks permission.
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_read') then
  begin execute $p$create policy medical_storage_read on storage.objects for select to authenticated using(bucket_id='medical-records' and public.storage_path_member_access(name,'read'))$p$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_read; a project owner must review/install it.'; end;
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_create') then
  begin execute $p$create policy medical_storage_create on storage.objects for insert to authenticated with check(bucket_id='medical-records' and public.storage_path_member_access(name,'write'))$p$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_create; a project owner must review/install it.'; end;
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_edit') then
  begin execute $p$create policy medical_storage_edit on storage.objects for update to authenticated using(bucket_id='medical-records' and public.storage_path_member_access(name,'write')) with check(bucket_id='medical-records' and public.storage_path_member_access(name,'write'))$p$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_edit; a project owner must review/install it.'; end;
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_delete') then
  begin execute $p$create policy medical_storage_delete on storage.objects for delete to authenticated using(bucket_id='medical-records' and public.storage_path_member_access(name,'delete'))$p$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_delete; a project owner must review/install it.'; end;
 end if;
end $$;
