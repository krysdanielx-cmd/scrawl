-- Scrawl 003: plain-text mirror of note content for search, plus trigram indexes.
-- Additive only. content_text is maintained by the API from the Tiptap JSON doc.

begin;

create extension if not exists pg_trgm;

alter table public.notes
  add column if not exists content_text text not null default '';

create index if not exists notes_title_trgm_idx
  on public.notes using gin (title gin_trgm_ops);

create index if not exists notes_content_text_trgm_idx
  on public.notes using gin (content_text gin_trgm_ops);

create index if not exists notes_public_slug_idx
  on public.notes (public_slug) where is_published;

commit;
