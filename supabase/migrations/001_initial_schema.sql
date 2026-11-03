-- Meu Plantão: private user data plus a versioned, reviewable clinical catalogue.
-- Applied manually through Supabase SQL Editor; retained here for version control.
begin;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  amount_brl numeric(12,2) not null check (amount_brl >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time <> end_time)
);
create index if not exists shifts_owner_date_idx on public.shifts(owner_id, work_date);

create table if not exists public.protocols (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_name text,
  external_url text,
  reviewed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists protocols_owner_title_idx on public.protocols(owner_id, title);

create table if not exists public.protocol_attachments (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.protocols(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type = 'application/pdf' or mime_type like 'image/%'),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  created_at timestamptz not null default now()
);
create index if not exists protocol_attachments_owner_idx on public.protocol_attachments(owner_id, protocol_id);

create table if not exists public.user_medication_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  medication_name text not null,
  presentation text,
  dose_per_kg_per_dose numeric,
  concentration_mg_ml numeric,
  max_dose_mg numeric,
  interval_text text,
  contraindications text,
  interactions text,
  source_url text,
  reviewed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (dose_per_kg_per_dose is null or dose_per_kg_per_dose > 0),
  check (concentration_mg_ml is null or concentration_mg_ml > 0),
  check (max_dose_mg is null or max_dose_mg > 0)
);
create index if not exists user_medications_owner_name_idx on public.user_medication_references(owner_id, medication_name);

create table if not exists public.medication_catalog (
  id text primary key,
  display_name text not null,
  category text not null,
  source_url text,
  status text not null default 'draft' check (status in ('draft','reviewed','published')),
  reviewed_on date,
  reviewer text,
  updated_at timestamptz not null default now()
);

create table if not exists public.medication_safety (
  id uuid primary key default gen_random_uuid(),
  medication_id text not null references public.medication_catalog(id) on delete cascade,
  age_range text,
  route text,
  dose_text text,
  dose_unit text,
  max_dose_text text,
  interval_text text,
  contraindications text,
  interactions text,
  precautions text,
  renal_adjustment text,
  hepatic_adjustment text,
  source_name text not null,
  source_url text not null,
  source_version text,
  reviewed_on date not null,
  status text not null default 'draft' check (status in ('draft','reviewed','published')),
  updated_at timestamptz not null default now()
);
create index if not exists medication_safety_catalog_status_idx on public.medication_safety(medication_id, status);

create table if not exists public.calculator_catalog (
  id text primary key,
  category text not null,
  display_name text not null,
  method_reference text,
  source_url text,
  status text not null default 'catalogued' check (status in ('catalogued','implemented','reviewed','published')),
  reviewed_on date,
  updated_at timestamptz not null default now()
);

alter table public.shifts enable row level security;
alter table public.protocols enable row level security;
alter table public.protocol_attachments enable row level security;
alter table public.user_medication_references enable row level security;
alter table public.medication_catalog enable row level security;
alter table public.medication_safety enable row level security;
alter table public.calculator_catalog enable row level security;

drop policy if exists shifts_owner_all on public.shifts;
create policy shifts_owner_all on public.shifts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists protocols_owner_all on public.protocols;
create policy protocols_owner_all on public.protocols for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists attachments_owner_all on public.protocol_attachments;
create policy attachments_owner_all on public.protocol_attachments for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists user_medications_owner_all on public.user_medication_references;
create policy user_medications_owner_all on public.user_medication_references for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists medication_catalog_published_read on public.medication_catalog;
create policy medication_catalog_published_read on public.medication_catalog for select to authenticated using (status = 'published');
drop policy if exists medication_safety_published_read on public.medication_safety;
create policy medication_safety_published_read on public.medication_safety for select to authenticated using (status = 'published');
drop policy if exists calculator_catalog_authenticated_read on public.calculator_catalog;
create policy calculator_catalog_authenticated_read on public.calculator_catalog for select to authenticated using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('protocol-attachments', 'protocol-attachments', false, 20971520, array['application/pdf','image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists protocol_files_owner_read on storage.objects;
create policy protocol_files_owner_read on storage.objects for select to authenticated using (bucket_id = 'protocol-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists protocol_files_owner_insert on storage.objects;
create policy protocol_files_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'protocol-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists protocol_files_owner_update on storage.objects;
create policy protocol_files_owner_update on storage.objects for update to authenticated using (bucket_id = 'protocol-attachments' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'protocol-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists protocol_files_owner_delete on storage.objects;
create policy protocol_files_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'protocol-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
