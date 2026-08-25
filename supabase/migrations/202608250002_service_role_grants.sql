begin;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.folders to service_role;
grant select, insert, update, delete on table public.notes to service_role;
grant select, insert, update, delete on table public.attachments to service_role;

commit;
