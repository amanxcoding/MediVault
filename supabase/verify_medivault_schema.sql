-- Read-only post-migration verification. This script does not inspect application rows.
select e.table_name,
       c.oid is not null as table_exists,
       coalesce(c.relrowsecurity, false) as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=e.table_name) as policy_count,
       (select count(*) from pg_constraint fk where fk.conrelid=c.oid and fk.contype='f') as foreign_key_count,
       (select count(*) from pg_index ix where ix.indrelid=c.oid) as index_count
from (values
  ('profiles'), ('families'), ('family_memberships'), ('family_members'), ('member_access_grants'),
  ('medical_records'), ('extracted_medical_data'), ('medical_conditions'), ('allergies'), ('medications'),
  ('medication_dose_logs'), ('timeline_events'), ('share_sessions'), ('share_session_documents'),
  ('audit_events'), ('lab_providers'), ('lab_bookings'), ('notifications'), ('reminder_preferences')
) as e(table_name)
left join pg_class c on c.oid=to_regclass('public.' || quote_ident(e.table_name))
order by e.table_name;

select object_kind, object_name,
       case object_kind
         when 'constraint' then exists(select 1 from pg_constraint c where c.conname=object_name and c.connamespace='public'::regnamespace)
         when 'index' then to_regclass('public.' || quote_ident(object_name)) is not null
       end as exists
from (values
    ('constraint','medical_conditions_family_member_fk'),
    ('constraint','medical_conditions_source_record_member_fk'),
    ('constraint','allergies_family_member_fk'),
    ('constraint','allergies_source_record_member_fk'),
    ('constraint','medications_family_member_fk'),
    ('constraint','medications_source_record_member_fk'),
    ('constraint','dose_logs_medication_member_fk'),
    ('constraint','timeline_family_member_fk'),
    ('constraint','timeline_source_record_member_fk'),
    ('constraint','share_documents_session_member_fk'),
    ('constraint','share_documents_record_member_fk'),
    ('constraint','audit_events_family_member_fk'),
    ('constraint','notifications_family_member_fk'),
    ('index','medical_records_family_member_idx'),
    ('index','family_members_user_idx'),
    ('index','extracted_medical_data_record_idx'),
    ('index','member_access_grants_grantee_active_idx'),
    ('index','medical_conditions_family_member_idx'),
    ('index','allergies_family_member_idx'),
    ('index','medications_family_member_idx'),
    ('index','medication_dose_logs_medication_member_idx'),
    ('index','timeline_family_member_idx'),
    ('index','share_session_documents_share_member_idx'),
    ('index','share_session_documents_record_member_idx'),
    ('index','audit_events_family_member_idx'),
    ('index','lab_bookings_member_date_idx'),
    ('index','notifications_user_created_idx')
) as expected_objects(object_kind, object_name)
order by object_kind, object_name;

select coalesce(c.relrowsecurity, false) as storage_objects_rls_enabled,
       pg_get_userbyid(c.relowner) as storage_objects_owner,
       (select count(*) from pg_policies p where p.schemaname='storage' and p.tablename='objects') as storage_objects_policy_count
from (select to_regclass('storage.objects')::oid as oid) s
left join pg_class c on c.oid=s.oid;

-- Read-only Storage configuration. No object metadata or medical files are read.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id='medical-records';

-- Inspect policies and their expressions to distinguish a clean partial run from
-- pre-existing or differently scoped policies. Review all rows before recovery.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname='public' and tablename in (
  'profiles','families','family_memberships','family_members','member_access_grants','medical_records',
  'extracted_medical_data','medical_conditions','allergies','medications','medication_dose_logs',
  'timeline_events','share_sessions','share_session_documents','audit_events','lab_providers',
  'lab_bookings','notifications','reminder_preferences'
)) or (schemaname='storage' and tablename='objects')
order by schemaname, tablename, policyname;

-- Empty result means anon/PUBLIC have no direct table privileges on these tables.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and grantee in ('anon','PUBLIC')
  and table_name in (
    'profiles','families','family_memberships','family_members','member_access_grants','medical_records',
    'extracted_medical_data','medical_conditions','allergies','medications','medication_dose_logs',
    'timeline_events','share_sessions','share_session_documents','audit_events','lab_providers',
    'lab_bookings','notifications','reminder_preferences'
  )
order by grantee, table_name, privilege_type;

-- Catalog-driven function verification: missing functions produce a row with
-- function_exists=false instead of raising an error. Identity arguments show
-- the actual installed signature; privilege checks run only for existing OIDs.
select expected.function_name,
       p.oid is not null as function_exists,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       p.prosecdef as security_definer,
       case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end as anon_can_execute,
       case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') end as authenticated_can_execute,
       case when p.oid is not null then exists(
         select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         where a.grantee=0 and a.privilege_type='EXECUTE'
       ) end as public_can_execute
from (values
  ('set_updated_at'),
  ('is_family_member'),
  ('has_family_role'),
  ('can_manage_member_access'),
  ('can_access_member'),
  ('prevent_member_reassignment'),
  ('prevent_family_member_reassignment'),
  ('create_record_timeline_event'),
  ('handle_new_user'),
  ('create_share_session'),
  ('resolve_share_session'),
  ('authorize_shared_document'),
  ('revoke_share_session'),
  ('storage_path_member_access')
) as expected(function_name)
left join pg_namespace n on n.nspname='public'
left join pg_proc p on p.pronamespace=n.oid and p.proname=expected.function_name
order by expected.function_name, identity_arguments;
