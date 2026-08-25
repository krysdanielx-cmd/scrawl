begin;

create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  singleton_key boolean not null default true check (singleton_key),
  created_at timestamptz not null default now(),
  constraint users_email_normalized check (email = lower(trim(email))),
  constraint users_email_length check (char_length(email) between 3 and 254),
  constraint users_email_unique unique (email),
  constraint users_singleton unique (singleton_key)
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint folders_name_length check (char_length(trim(name)) between 1 and 80),
  constraint folders_user_name_unique unique (user_id, name)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null default '',
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  is_published boolean not null default false,
  public_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_title_length check (char_length(title) <= 300),
  constraint notes_publication_consistent check (
    (is_published and public_slug is not null)
    or (not is_published and public_slug is null)
  ),
  constraint notes_public_slug_format check (
    public_slug is null or public_slug ~ '^[A-Za-z0-9_-]{12,64}$'
  )
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  constraint attachments_filename_length check (char_length(filename) between 1 and 255),
  constraint attachments_mime_length check (char_length(mime_type) between 1 and 255)
);

create index folders_user_position_idx on public.folders(user_id, position, created_at);
create index notes_user_updated_idx on public.notes(user_id, updated_at desc) where not is_archived;
create index notes_folder_pinned_idx on public.notes(folder_id, is_pinned desc, updated_at desc) where not is_archived;
create index notes_user_archived_idx on public.notes(user_id, updated_at desc) where is_archived;
create index attachments_note_idx on public.attachments(note_id, created_at);

create or replace function public.set_note_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_note_updated_at();

alter table public.users enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

alter table public.users force row level security;
alter table public.folders force row level security;
alter table public.notes force row level security;
alter table public.attachments force row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.folders from anon, authenticated;
revoke all on table public.notes from anon, authenticated;
revoke all on table public.attachments from anon, authenticated;
revoke all on function public.set_note_updated_at() from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.folders to service_role;
grant select, insert, update, delete on table public.notes to service_role;
grant select, insert, update, delete on table public.attachments to service_role;

commit;
