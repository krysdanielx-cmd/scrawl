# Scrawl deployment

Scrawl is a single-owner notes app. The browser talks only to the Express API. The API is the authentication and authorization boundary and is the only component that receives the Supabase service role key.

## Project

- Supabase project ID: `skdjipkozclzspumqdga`
- Supabase URL: `https://skdjipkozclzspumqdga.supabase.co`
- Application host: kitten.space subdomain, not assigned yet
- Local web: `http://localhost:5173`
- Local API: `http://localhost:8527`

## Required environment

Copy `.env.example` to `.env` and fill in:

- `SUPABASE_URL`: server-only project URL
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role secret
- `JWT_SECRET`: server-only random secret, at least 32 characters
- `JWT_EXPIRES_IN`: optional JWT lifetime, defaults to `7d`
- `PORT`: Express port, defaults to `8527`
- `CLIENT_ORIGIN`: exact allowed browser origin in production
- `NODE_ENV`: `development` or `production`

No secret may use a `VITE_` prefix. There are no required client-side environment variables in phase 1.

## Database setup

Run `supabase/migrations/202608250001_initial_schema.sql` once in the Scrawl project's SQL editor. The migration is transactional and creates the users, folders, notes, and attachments tables, indexes, note timestamp trigger, RLS, and privilege revocations.

The schema deliberately enforces one owner with `users_singleton`. The first successful signup creates the owner and the default `OGTool` and `Vision` folders. Later signup attempts return a conflict.

Do not create production test users. Do not seed production data.

## Install and verify locally

1. Use Node 20.19 or later.
2. Run `npm install`.
3. Add the server-only values to `.env`.
4. Run the SQL migration in Supabase.
5. Run `npm run dev`.
6. Open `http://localhost:5173`, create the one owner account, and confirm both default folders appear.
7. Sign out, sign back in, refresh the page, and confirm `/api/me` restores the session.
8. Confirm a second signup returns HTTP 409 and does not add another user.
9. Run `npm run check`.

## Production verification gate

Do not claim production works until all of these are true: the migration ran on the intended project; production environment variables are configured server-side; the app was rebuilt after environment changes; the live HTTPS URL loads signed out; signup or login works; `/api/me` rejects a missing or altered token; the service role key is absent from browser source and bundles; CORS rejects an unrelated origin; RLS and grants remain locked; mobile auth inputs stay at 16px or larger and do not zoom; and the live page has no horizontal overflow or console errors.

Attachments and transcription are intentionally not active in phase 1. Before uploads ship, create a private Supabase Storage bucket with a 5 MB server-enforced limit and serve downloads through authorized API routes or short-lived signed URLs. Before transcription ships, add `OPENAI_API_KEY` on the server only.
