-- Initial MediVault data model and RLS boundary. Apply only to a new Supabase project.
-- Requires PostgreSQL 15+ for column-targeted SET NULL actions on composite foreign keys.
do $$
declare collisions text;
begin
 if current_setting('server_version_num')::integer < 150000 then
  raise exception 'MediVault schema requires PostgreSQL 15 or newer.';
 end if;
 if to_regnamespace('extensions') is null then
  raise exception 'Supabase extensions schema is required.';
 end if;
 if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto' and n.nspname<>'extensions') then
  raise exception 'pgcrypto is installed outside the extensions schema; review before applying.';
 end if;
 select string_agg(name, ', ') into collisions
 from unnest(array['profiles','families','family_memberships','family_members','member_access_grants','medical_records',
  'extracted_medical_data','medical_conditions','allergies','medications','medication_dose_logs','timeline_events',
  'share_sessions','share_session_documents','audit_events','lab_providers','lab_bookings','notifications','reminder_preferences']) as names(name)
 where to_regclass('public.' || quote_ident(name)) is not null;
 if collisions is not null then
  raise exception 'MediVault tables already exist; inspect the target project before applying: %', collisions;
 end if;
 select string_agg(p.proname, ', ') into collisions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array['set_updated_at','is_family_member','has_family_role','can_manage_member_access',
  'can_access_member','prevent_member_reassignment','prevent_family_member_reassignment','create_record_timeline_event',
  'handle_new_user','create_share_session','resolve_share_session','authorize_shared_document','revoke_share_session','storage_path_member_access']);
 if collisions is not null then
  raise exception 'MediVault function names already exist; inspect the target project before applying: %', collisions;
 end if;
 if exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created_medivault' and not tgisinternal) then
  raise exception 'The MediVault auth trigger already exists; inspect the target project before applying.';
 end if;
 if exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname=any(array['medical_storage_read','medical_storage_create','medical_storage_edit','medical_storage_delete'])) then
  raise exception 'MediVault Storage policies already exist; inspect the target project before applying.';
 end if;
 if exists(select 1 from storage.buckets where id='medical-records') and not exists(
   select 1 from storage.buckets where id='medical-records' and name='medical-records' and public=false
    and file_size_limit=20971520 and allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp']
  ) then
  raise exception 'The existing medical-records bucket has incompatible settings; inspect it before applying.';
 end if;
end $$;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', avatar_path text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.families (
  id uuid primary key default gen_random_uuid(), name text not null default 'My family' check(char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.family_memberships (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','administrator','member','caregiver')),
  membership_status text not null default 'active' check(membership_status in ('invited','active','suspended','removed')),
  created_at timestamptz not null default now(), unique(family_id,user_id)
);
create index family_memberships_user_family_idx on public.family_memberships(user_id,family_id) where membership_status='active';
create table public.family_members (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check(char_length(display_name) between 1 and 120),
  relationship text not null check(char_length(relationship) between 1 and 40), is_dependent boolean not null default false,
  date_of_birth date, blood_group text, height_cm numeric(5,2) check(height_cm is null or height_cm between 20 and 300),
  weight_kg numeric(5,2) check(weight_kg is null or weight_kg between 1 and 800), emergency_contact jsonb,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  check(user_id is not null or is_dependent), unique(family_id,user_id), unique(family_id,id)
);
create index family_members_family_active_idx on public.family_members(family_id,display_name) where archived_at is null;
create index family_members_user_idx on public.family_members(user_id) where user_id is not null;
create table public.member_access_grants (
  id uuid primary key default gen_random_uuid(), member_id uuid not null references public.family_members(id) on delete cascade,
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  can_read boolean not null default false, can_edit boolean not null default false, can_share boolean not null default false,
  granted_by uuid not null references auth.users(id), consented_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default now(), unique(member_id,grantee_user_id)
);
create index member_access_grants_grantee_active_idx on public.member_access_grants(grantee_user_id,member_id) where revoked_at is null;

create table public.medical_records (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete restrict,
  uploaded_by uuid not null references auth.users(id), title text not null check(char_length(title) between 1 and 160),
  category text not null check(category in ('Prescription / medication','Laboratory report','Imaging / diagnostic report','Diagnosis / illness','Hospitalization / discharge','Vaccination','Allergies','Doctor visit / follow-up','Other medical document')),
  document_date date, original_file_path text not null unique, original_filename text not null check(char_length(original_filename) between 1 and 255),
  detected_mime_type text not null check(detected_mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size_bytes bigint not null check(file_size_bytes between 1 and 20971520), notes text not null default '' check(char_length(notes)<=4000),
  verification_status text not null default 'needs_review' check(verification_status in ('uploaded','needs_review','user_confirmed','clinically_verified')),
  processing_status text not null default 'not_configured' check(processing_status in ('queued','processing','completed','not_configured','failed')),
  processing_error_code text, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,member_id), foreign key(family_id,member_id) references public.family_members(family_id,id) on delete restrict
);
create index medical_records_member_date_idx on public.medical_records(member_id,document_date desc nulls last,created_at desc) where archived_at is null;
create index medical_records_family_date_idx on public.medical_records(family_id,document_date desc nulls last,created_at desc) where archived_at is null;
create index medical_records_family_member_idx on public.medical_records(family_id,member_id);
create index medical_records_search_idx on public.medical_records using gin(to_tsvector('simple',title||' '||category||' '||notes));
create table public.extracted_medical_data (
  id uuid primary key default gen_random_uuid(), record_id uuid not null references public.medical_records(id) on delete cascade,
  field_name text not null check(char_length(field_name) between 1 and 80), extracted_value jsonb not null, normalized_value jsonb,
  confidence numeric(5,4) check(confidence is null or confidence between 0 and 1), page_number integer check(page_number is null or page_number>0),
  source_reference text, extraction_method text not null check(extraction_method in ('ocr','user_entered','imported')),
  verification_status text not null default 'unreviewed' check(verification_status in ('unreviewed','user_confirmed','clinically_verified','rejected')),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index extracted_medical_data_record_idx on public.extracted_medical_data(record_id);
create table public.medical_conditions (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete restrict, record_id uuid,
  condition_name text not null check(char_length(condition_name) between 1 and 200), documented_date date,
  status text check(status is null or status in ('active','historical','resolved','unknown')),
  source_type text not null check(source_type in ('user_entered','record_confirmed','clinically_verified')),
  verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','clinically_verified')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint medical_conditions_family_member_fk foreign key(family_id,member_id) references public.family_members(family_id,id) on delete restrict,
  constraint medical_conditions_source_record_member_fk foreign key(record_id,member_id) references public.medical_records(id,member_id) on delete set null (record_id)
);
create table public.allergies (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete restrict, allergen text not null check(char_length(allergen) between 1 and 160),
  reaction text, severity text check(severity is null or severity in ('mild','moderate','severe','unknown')),
  source_record_id uuid,
  verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','clinically_verified')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint allergies_family_member_fk foreign key(family_id,member_id) references public.family_members(family_id,id) on delete restrict,
  constraint allergies_source_record_member_fk foreign key(source_record_id,member_id) references public.medical_records(id,member_id) on delete set null (source_record_id)
);
create index medical_conditions_family_member_idx on public.medical_conditions(family_id,member_id);
create index medical_conditions_record_member_idx on public.medical_conditions(record_id,member_id) where record_id is not null;
create index allergies_family_member_idx on public.allergies(family_id,member_id);
create index allergies_source_record_member_idx on public.allergies(source_record_id,member_id) where source_record_id is not null;
create table public.medications (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete restrict, source_record_id uuid,
  medicine_name text not null check(char_length(medicine_name) between 1 and 160), strength text, dosage_instructions text, route text, frequency text,
  start_date date, end_date date, prescribed_by text,
  status text not null default 'active' check(status in ('active','completed','discontinued')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  check(end_date is null or start_date is null or end_date>=start_date), unique(id,member_id),
  constraint medications_family_member_fk foreign key(family_id,member_id) references public.family_members(family_id,id) on delete restrict,
  constraint medications_source_record_member_fk foreign key(source_record_id,member_id) references public.medical_records(id,member_id) on delete set null (source_record_id)
);
create index medications_member_active_idx on public.medications(member_id,status,start_date) where archived_at is null;
create index medications_family_member_idx on public.medications(family_id,member_id);
create index medications_source_record_member_idx on public.medications(source_record_id,member_id) where source_record_id is not null;
create table public.medication_dose_logs (
  id uuid primary key default gen_random_uuid(), medication_id uuid not null, member_id uuid not null references public.family_members(id) on delete restrict,
  scheduled_at timestamptz not null, status text not null check(status in ('scheduled','taken','skipped','missed','cancelled')),
  logged_at timestamptz, notes text check(notes is null or char_length(notes)<=500), created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(medication_id,scheduled_at),
  constraint dose_logs_medication_member_fk foreign key(medication_id,member_id) references public.medications(id,member_id) on delete cascade
);
create index medication_dose_logs_member_date_idx on public.medication_dose_logs(member_id,scheduled_at desc);
create index medication_dose_logs_medication_member_idx on public.medication_dose_logs(medication_id,member_id);
create table public.timeline_events (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete restrict, source_record_id uuid,
  event_type text not null check(event_type in ('record','condition','allergy','medication','dose','booking','user_note')),
  event_date date not null, title text not null check(char_length(title) between 1 and 200), description text,
  verification_status text not null default 'unverified' check(verification_status in ('unverified','user_confirmed','clinically_verified')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint timeline_family_member_fk foreign key(family_id,member_id) references public.family_members(family_id,id) on delete restrict,
  constraint timeline_source_record_member_fk foreign key(source_record_id,member_id) references public.medical_records(id,member_id) on delete set null (source_record_id)
);
create unique index timeline_record_event_unique on public.timeline_events(source_record_id,event_type) where source_record_id is not null;
create index timeline_member_date_idx on public.timeline_events(member_id,event_date desc,id);
create index timeline_family_member_idx on public.timeline_events(family_id,member_id);
create index timeline_source_record_member_idx on public.timeline_events(source_record_id,member_id) where source_record_id is not null;

create table public.share_sessions (
  id uuid primary key default gen_random_uuid(), member_id uuid not null references public.family_members(id) on delete cascade,
  created_by uuid not null references auth.users(id), token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  share_scope text not null check(share_scope in ('full_history','emergency_summary')), expires_at timestamptz not null,
  revoked_at timestamptz, created_at timestamptz not null default now(), last_accessed_at timestamptz,
  check(expires_at>created_at), unique(id,member_id)
);
create index share_sessions_member_active_idx on public.share_sessions(member_id,created_at desc);
create table public.share_session_documents (
  share_id uuid not null references public.share_sessions(id) on delete cascade, record_id uuid not null,
  member_id uuid not null references public.family_members(id) on delete restrict, primary key(share_id,record_id),
  constraint share_documents_session_member_fk foreign key(share_id,member_id) references public.share_sessions(id,member_id) on delete cascade,
  constraint share_documents_record_member_fk foreign key(record_id,member_id) references public.medical_records(id,member_id) on delete restrict
);
create index share_session_documents_share_member_idx on public.share_session_documents(share_id,member_id);
create index share_session_documents_record_member_idx on public.share_session_documents(record_id,member_id);
create table public.audit_events (
  id bigint generated always as identity primary key, actor_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  family_id uuid references public.families(id) on delete set null, member_id uuid,
  action text not null check(char_length(action) between 1 and 80), resource_type text not null check(char_length(resource_type) between 1 and 80),
  resource_id text, metadata jsonb not null default '{}'::jsonb check(octet_length(metadata::text)<=2000), created_at timestamptz not null default now(),
  check(member_id is null or family_id is not null),
  constraint audit_events_family_member_fk foreign key(family_id,member_id) references public.family_members(family_id,id) on delete set null (member_id)
);
create index audit_events_family_created_idx on public.audit_events(family_id,created_at desc);
create index audit_events_family_member_idx on public.audit_events(family_id,member_id);
create index audit_events_actor_created_idx on public.audit_events(actor_user_id,created_at desc);
create index audit_events_member_created_idx on public.audit_events(member_id,created_at desc) where member_id is not null;
create table public.lab_providers (
  id uuid primary key default gen_random_uuid(), provider_name text not null, source_kind text not null check(source_kind in ('verified_integration','demo')),
  source_reference text, source_checked_at timestamptz, locality text, price_inr numeric(10,2), is_active boolean not null default false,
  created_at timestamptz not null default now(), check(source_kind<>'verified_integration' or (source_reference is not null and source_checked_at is not null))
);
create table public.lab_bookings (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete restrict, provider_id uuid references public.lab_providers(id) on delete set null,
  test_name text not null check(char_length(test_name) between 1 and 160), booking_date date,
  status text not null default 'request' check(status in ('request','demo_request','confirmed','cancelled','failed')),
  source_kind text not null check(source_kind in ('verified_integration','demo')), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(family_id,member_id) references public.family_members(family_id,id) on delete restrict
);
create index lab_bookings_family_member_idx on public.lab_bookings(family_id,member_id);
create index lab_bookings_member_date_idx on public.lab_bookings(member_id,booking_date desc);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid references public.families(id) on delete cascade, member_id uuid,
  event_type text not null, title text not null check(char_length(title) between 1 and 160), body text check(body is null or char_length(body)<=500),
  read_at timestamptz, created_at timestamptz not null default now(),
  check(member_id is null or family_id is not null),
  constraint notifications_family_member_fk foreign key(family_id,member_id) references public.family_members(family_id,id) on delete cascade
);
create index notifications_user_created_idx on public.notifications(user_id,created_at desc);
create index notifications_family_member_idx on public.notifications(family_id,member_id) where member_id is not null;
create table public.reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade, timezone text not null default 'UTC',
  email_enabled boolean not null default false, updated_at timestamptz not null default now()
);

create function public.set_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create function public.is_family_member(p_family_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.family_memberships m where m.family_id=p_family_id and m.user_id=(select auth.uid()) and m.membership_status='active') $$;
create function public.has_family_role(p_family_id uuid,p_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.family_memberships m where m.family_id=p_family_id and m.user_id=(select auth.uid()) and m.membership_status='active' and m.role=any(p_roles)) $$;
create function public.can_manage_member_access(p_member_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.family_members m where m.id=p_member_id and m.archived_at is null and (m.user_id=(select auth.uid()) or (m.is_dependent and public.has_family_role(m.family_id,array['owner','administrator'])))) $$;
create function public.can_access_member(p_member_id uuid,p_action text default 'read') returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.family_members m where m.id=p_member_id and m.archived_at is null and
  (m.user_id=(select auth.uid()) or (m.is_dependent and public.has_family_role(m.family_id,array['owner','administrator'])) or
   exists(select 1 from public.member_access_grants g where g.member_id=m.id and g.grantee_user_id=(select auth.uid()) and g.revoked_at is null and g.consented_at<=now() and
    case p_action when 'write' then g.can_edit when 'share' then g.can_share when 'delete' then g.can_edit else g.can_read end))) $$;
create function public.prevent_member_reassignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.member_id is distinct from old.member_id then raise exception 'member reassignment is not allowed' using errcode='23514'; end if;
 if to_jsonb(new)->>'family_id' is distinct from to_jsonb(old)->>'family_id' then raise exception 'family reassignment is not allowed' using errcode='23514'; end if;
 if tg_table_name='medical_records' and (new.uploaded_by is distinct from old.uploaded_by or new.original_file_path is distinct from old.original_file_path) then
  raise exception 'record source ownership is immutable' using errcode='23514';
 end if;
 return new;
end $$;
create function public.prevent_family_member_reassignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.family_id is distinct from old.family_id or new.user_id is distinct from old.user_id or new.is_dependent is distinct from old.is_dependent or new.created_by is distinct from old.created_by then
  raise exception 'family member ownership is immutable' using errcode='23514';
 end if;
 return new;
end $$;
create function public.create_record_timeline_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.timeline_events(family_id,member_id,source_record_id,event_type,event_date,title,description,verification_status)
 values(new.family_id,new.member_id,new.id,'record',coalesce(new.document_date,(new.created_at at time zone 'UTC')::date),new.title,new.category,'unverified')
 on conflict(source_record_id,event_type) where source_record_id is not null do nothing;
 return new;
end $$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare f uuid; n text;
begin
 n:=coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),nullif(split_part(coalesce(new.email,''),'@',1),''),'Family admin');
 insert into public.profiles(id,display_name) values(new.id,n) on conflict(id) do nothing;
 insert into public.families(name,created_by) values('My family',new.id) returning id into f;
 insert into public.family_memberships(family_id,user_id,role) values(f,new.id,'owner') on conflict(family_id,user_id) do nothing;
 insert into public.family_members(family_id,user_id,display_name,relationship,is_dependent,created_by) values(f,new.id,n,'Self',false,new.id) on conflict(family_id,user_id) do nothing;
 return new;
end $$;
create trigger on_auth_user_created_medivault after insert on auth.users for each row execute function public.handle_new_user();
create trigger record_timeline_event after insert on public.medical_records for each row execute function public.create_record_timeline_event();
create trigger immutable_family_member_owner before update on public.family_members for each row execute function public.prevent_family_member_reassignment();
create trigger immutable_record_owner before update on public.medical_records for each row execute function public.prevent_member_reassignment();
create trigger immutable_condition_owner before update on public.medical_conditions for each row execute function public.prevent_member_reassignment();
create trigger immutable_allergy_owner before update on public.allergies for each row execute function public.prevent_member_reassignment();
create trigger immutable_medication_owner before update on public.medications for each row execute function public.prevent_member_reassignment();
create trigger immutable_timeline_owner before update on public.timeline_events for each row execute function public.prevent_member_reassignment();
create trigger immutable_booking_owner before update on public.lab_bookings for each row execute function public.prevent_member_reassignment();

create function public.create_share_session(p_member_id uuid,p_scope text,p_expires_at timestamptz,p_record_ids uuid[])
returns table(share_id uuid,raw_token text)
language plpgsql security definer set search_path='' as $$
declare session_id uuid; generated_token text; generated_hash text; n integer;
begin
 if auth.uid() is null or not public.can_access_member(p_member_id,'share') then raise exception 'not authorized' using errcode='42501'; end if;
 if not public.can_access_member(p_member_id,'read') then raise exception 'read permission is required to review a share' using errcode='42501'; end if;
 if p_scope is null or p_scope not in ('full_history','emergency_summary') or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days' then raise exception 'invalid share request' using errcode='22023'; end if;
 generated_token:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
 generated_hash:=encode(extensions.digest(generated_token,'sha256'),'hex');
 if p_scope='emergency_summary' then
  if coalesce(array_length(p_record_ids,1),0)=0 then raise exception 'select emergency records explicitly' using errcode='22023'; end if;
  select count(*) into n from public.medical_records r where r.member_id=p_member_id and r.id=any(p_record_ids) and r.archived_at is null and r.category in ('Allergies','Diagnosis / illness','Prescription / medication','Hospitalization / discharge');
  if n<>array_length(p_record_ids,1) then raise exception 'invalid emergency scope' using errcode='22023'; end if;
 else
  select coalesce(array_agg(r.id),array[]::uuid[]) into p_record_ids from public.medical_records r where r.member_id=p_member_id and r.archived_at is null;
 end if;
 insert into public.share_sessions(member_id,created_by,token_hash,share_scope,expires_at) values(p_member_id,auth.uid(),generated_hash,p_scope,p_expires_at) returning id into session_id;
 insert into public.share_session_documents(share_id,record_id,member_id) select session_id,r.id,p_member_id from public.medical_records r where r.id=any(p_record_ids) and r.member_id=p_member_id and r.archived_at is null;
 return query select session_id,generated_token;
end $$;
create function public.resolve_share_session(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.share_sessions%rowtype; m jsonb; r jsonb;
begin
 if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 select * into s from public.share_sessions x where x.token_hash=p_token_hash and x.revoked_at is null and x.expires_at>now();
 if not found then return null; end if;
 select jsonb_build_object('id',f.id,'display_name',f.display_name,'relationship',f.relationship) into m from public.family_members f where f.id=s.member_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'category',d.category,'document_date',d.document_date,'notes',d.notes,'verification_status',d.verification_status,'processing_status',d.processing_status) order by d.document_date desc nulls last,d.created_at desc),'[]'::jsonb)
  into r from public.share_session_documents sd join public.medical_records d on d.id=sd.record_id and d.member_id=sd.member_id where sd.share_id=s.id and d.archived_at is null;
 update public.share_sessions set last_accessed_at=now() where id=s.id;
 return jsonb_build_object('share_id',s.id,'scope',s.share_scope,'expires_at',s.expires_at,'member',m,'records',r);
end $$;
create function public.authorize_shared_document(p_token_hash text,p_record_id uuid) returns table(share_id uuid,member_id uuid,storage_path text)
language sql security definer set search_path='' as $$
 select s.id,s.member_id,d.original_file_path from public.share_sessions s join public.share_session_documents sd on sd.share_id=s.id and sd.member_id=s.member_id
 join public.medical_records d on d.id=sd.record_id and d.id=p_record_id and d.member_id=s.member_id
 where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and d.archived_at is null $$;
create function public.revoke_share_session(p_share_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare m uuid;
begin
 select member_id into m from public.share_sessions where id=p_share_id and created_by=auth.uid() and revoked_at is null;
 if m is null or not public.can_access_member(m,'share') then return false; end if;
 update public.share_sessions set revoked_at=now() where id=p_share_id; return true;
end $$;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_memberships enable row level security;
alter table public.family_members enable row level security;
alter table public.member_access_grants enable row level security;
alter table public.medical_records enable row level security;
alter table public.extracted_medical_data enable row level security;
alter table public.medical_conditions enable row level security;
alter table public.allergies enable row level security;
alter table public.medications enable row level security;
alter table public.medication_dose_logs enable row level security;
alter table public.timeline_events enable row level security;
alter table public.share_sessions enable row level security;
alter table public.share_session_documents enable row level security;
alter table public.audit_events enable row level security;
alter table public.lab_providers enable row level security;
alter table public.lab_bookings enable row level security;
alter table public.notifications enable row level security;
alter table public.reminder_preferences enable row level security;

create policy profile_self_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profile_self_edit on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy family_member_read on public.families for select to authenticated using(public.is_family_member(id));
create policy family_admin_edit on public.families for update to authenticated using(public.has_family_role(id,array['owner','administrator'])) with check(public.has_family_role(id,array['owner','administrator']));
create policy membership_read on public.family_memberships for select to authenticated using(user_id=(select auth.uid()) or public.has_family_role(family_id,array['owner','administrator']));
create policy family_members_read on public.family_members for select to authenticated using(public.can_access_member(id,'read') and archived_at is null);
create policy family_members_create on public.family_members for insert to authenticated with check(is_dependent and user_id is null and public.has_family_role(family_id,array['owner','administrator']) and created_by=(select auth.uid()));
create policy family_members_edit on public.family_members for update to authenticated
 using((user_id=(select auth.uid()) and public.is_family_member(family_id) and not is_dependent) or (is_dependent and user_id is null and public.has_family_role(family_id,array['owner','administrator'])))
 with check((user_id=(select auth.uid()) and public.is_family_member(family_id) and not is_dependent) or (is_dependent and user_id is null and public.has_family_role(family_id,array['owner','administrator'])));
create policy grants_read on public.member_access_grants for select to authenticated using(grantee_user_id=(select auth.uid()) or public.can_manage_member_access(member_id));
create policy grants_manage on public.member_access_grants for all to authenticated using(public.can_manage_member_access(member_id)) with check(public.can_manage_member_access(member_id) and granted_by=(select auth.uid()));
create policy records_read on public.medical_records for select to authenticated using(public.can_access_member(member_id,'read') and archived_at is null);
create policy records_create on public.medical_records for insert to authenticated with check(public.can_access_member(member_id,'write') and uploaded_by=(select auth.uid()) and exists(select 1 from public.family_members m where m.id=medical_records.member_id and m.family_id=medical_records.family_id));
create policy records_edit on public.medical_records for update to authenticated using(public.can_access_member(member_id,'write') and archived_at is null) with check(public.can_access_member(member_id,'write'));
create policy records_delete on public.medical_records for delete to authenticated using(public.can_access_member(member_id,'delete'));
create policy extracted_read on public.extracted_medical_data for select to authenticated using(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,'read')));
create policy extracted_create on public.extracted_medical_data for insert to authenticated with check(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,'write')));
create policy extracted_edit on public.extracted_medical_data for update to authenticated using(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,'write'))) with check(exists(select 1 from public.medical_records r where r.id=record_id and public.can_access_member(r.member_id,'write')));
create policy conditions_access on public.medical_conditions for all to authenticated using(public.can_access_member(member_id,'read')) with check(public.can_access_member(member_id,'write'));
create policy allergies_access on public.allergies for all to authenticated using(public.can_access_member(member_id,'read')) with check(public.can_access_member(member_id,'write'));
create policy medications_access on public.medications for all to authenticated using(public.can_access_member(member_id,'read')) with check(public.can_access_member(member_id,'write') and created_by=(select auth.uid()));
create policy dose_logs_access on public.medication_dose_logs for all to authenticated using(public.can_access_member(member_id,'read')) with check(public.can_access_member(member_id,'write') and (created_by is null or created_by=(select auth.uid())));
create policy timeline_access on public.timeline_events for all to authenticated using(public.can_access_member(member_id,'read')) with check(public.can_access_member(member_id,'write'));
create policy share_sessions_owner_read on public.share_sessions for select to authenticated using(created_by=(select auth.uid()) and public.can_access_member(member_id,'share'));
create policy share_documents_owner_read on public.share_session_documents for select to authenticated using(exists(select 1 from public.share_sessions s where s.id=share_id and s.created_by=(select auth.uid()) and public.can_access_member(member_id,'share')));
create policy audit_insert_access on public.audit_events for insert to authenticated with check(
 actor_user_id=(select auth.uid()) and (
  (member_id is null and (family_id is null or public.is_family_member(family_id)))
  or (member_id is not null and (public.can_access_member(member_id,'read') or public.can_access_member(member_id,'share')))
 )
);
create policy audit_admin_read on public.audit_events for select to authenticated using(family_id is not null and public.has_family_role(family_id,array['owner','administrator']));
create policy provider_active_read on public.lab_providers for select to authenticated using(is_active);
create policy bookings_access on public.lab_bookings for all to authenticated using(public.can_access_member(member_id,'read')) with check(public.can_access_member(member_id,'write') and created_by=(select auth.uid()));
create policy notifications_self on public.notifications for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy reminder_preferences_self on public.reminder_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function public.storage_path_member_access(p_name text,p_action text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare f text; m text;
begin
 f:=(storage.foldername(p_name))[1]; m:=(storage.foldername(p_name))[2];
 if f !~* '^[0-9a-f-]{36}$' or m !~* '^[0-9a-f-]{36}$' then return false; end if;
 return exists(select 1 from public.family_members x where x.id=m::uuid and x.family_id=f::uuid and public.can_access_member(x.id,p_action));
exception when others then return false;
end $$;
do $$ begin
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('medical-records','medical-records',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp'])
 on conflict(id) do nothing;
exception when insufficient_privilege then
 raise warning 'Could not create medical-records bucket with this SQL Editor role. A project owner must create it as private with the configured file limit and MIME types.';
end $$;
do $$ begin
 if not exists(select 1 from storage.buckets where id='medical-records' and name='medical-records' and public=false and file_size_limit=20971520 and allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp']) then
  raise exception 'The existing medical-records bucket has incompatible settings; review it before applying this migration.';
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_read') then
  begin execute $policy$create policy medical_storage_read on storage.objects for select to authenticated using(bucket_id='medical-records' and public.storage_path_member_access(name,'read'))$policy$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_read; have a project owner review and install the scoped Storage policy.'; end;
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_create') then
  begin execute $policy$create policy medical_storage_create on storage.objects for insert to authenticated with check(bucket_id='medical-records' and public.storage_path_member_access(name,'write'))$policy$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_create; have a project owner review and install the scoped Storage policy.'; end;
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_edit') then
  begin execute $policy$create policy medical_storage_edit on storage.objects for update to authenticated using(bucket_id='medical-records' and public.storage_path_member_access(name,'write')) with check(bucket_id='medical-records' and public.storage_path_member_access(name,'write'))$policy$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_edit; have a project owner review and install the scoped Storage policy.'; end;
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='medical_storage_delete') then
  begin execute $policy$create policy medical_storage_delete on storage.objects for delete to authenticated using(bucket_id='medical-records' and public.storage_path_member_access(name,'delete'))$policy$;
  exception when insufficient_privilege then raise warning 'Could not create medical_storage_delete; have a project owner review and install the scoped Storage policy.'; end;
 end if;
end $$;

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

-- No table is directly available to anonymous users; signed doctor shares use only the scoped RPCs above.
revoke all on table public.profiles, public.families, public.family_memberships, public.family_members,
 public.member_access_grants, public.medical_records, public.extracted_medical_data, public.medical_conditions,
 public.allergies, public.medications, public.medication_dose_logs, public.timeline_events, public.share_sessions,
 public.share_session_documents, public.audit_events, public.lab_providers, public.lab_bookings,
 public.notifications, public.reminder_preferences from public,anon,authenticated;

grant select,update on table public.profiles to authenticated;
grant select,update on table public.families to authenticated;
grant select on table public.family_memberships to authenticated;
grant select,insert,update on table public.family_members to authenticated;
grant select,insert,update,delete on table public.member_access_grants to authenticated;
grant select,insert,update,delete on table public.medical_records to authenticated;
grant select,insert,update on table public.extracted_medical_data to authenticated;
grant select,insert,update,delete on table public.medical_conditions,public.allergies,public.medications,
 public.medication_dose_logs,public.timeline_events to authenticated;
grant select on table public.share_sessions,public.share_session_documents,public.lab_providers to authenticated;
grant select,insert on table public.audit_events to authenticated;
grant select,insert,update,delete on table public.lab_bookings,public.notifications,public.reminder_preferences to authenticated;
revoke all on sequence public.audit_events_id_seq from public,anon,authenticated;
grant usage on sequence public.audit_events_id_seq to authenticated;

do $$ declare t text;
begin
 foreach t in array array['profiles','families','family_members','medical_records','extracted_medical_data','medical_conditions','allergies','medications','medication_dose_logs','timeline_events','lab_bookings','reminder_preferences'] loop
  execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
 end loop;
end $$;
