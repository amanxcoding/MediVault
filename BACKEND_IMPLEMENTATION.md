# MediVault backend foundation

## Repository audit

The repository started as a plain HTML/CSS/JavaScript prototype and now includes a Next.js App Router API layer and Supabase SQL foundation. The signed-out preview uses fictional demo data and browser-only changes; the authenticated workspace uses same-origin APIs and requires a verified Supabase Auth session. The project-root `.env.local` has non-empty Supabase URL, publishable key, and server secret settings (values intentionally not recorded here); `APP_BASE_URL` and OCR settings are not configured. `.gitignore` excludes `.env.*` while allowing `.env.example`.

The implementation adds a Next.js App Router server around the existing shell and assets, typed Route Handlers, Supabase SSR session handling, a PostgreSQL migration with RLS, and private-storage operations. The email, password-reset, and Google OAuth controls call the new auth routes. When an Auth session is verified, `backend-ui.js` switches to an authenticated API workspace for family, records, timeline, medications, dose history, profile, and share-link actions. Unauthenticated visitors still see the fictional demo. Labs/providers, OCR, scheduled reminders, adult invitations, and QR image generation are not live features.

## Architecture and authorization

- Next.js Route Handlers are under `app/api/`; request/response helpers and input contracts are in `lib/`.
- Cookie sessions use `@supabase/ssr`; `proxy.ts` refreshes the Auth session and API handlers independently validate the caller with `auth.getUser()`.
- The publishable key is used with RLS. The secret-key client is server-only and is limited to creating short-lived document URLs after share authorization. `SUPABASE_SERVICE_ROLE_KEY` remains accepted as a legacy fallback.
- Family admins can manage dependent profiles. An adult's self profile is separate; adult access grants require the adult's explicit grant row. Account invitation, adult account linking, and consent UI are not implemented.
- `supabase/migrations/202610170001_initial_medivault_schema.sql` creates normalized family, member, record, extraction, condition, allergy, medication, dose, timeline, share, audit, lab, notification, and reminder tables; ownership constraints; triggers; a private `medical-records` bucket; and RLS/storage policies. It does not alter Supabase-managed `storage.objects` RLS; Storage policy creation is permission-aware.
- Record uploads validate size and PDF/JPEG/PNG/WEBP signatures, use collision-resistant per-family/member/record paths, and remove the object/metadata on later failure where possible. Record access creates a 60-second signed URL and audits access. Share document URLs are issued only after the share RPC rechecks token hash, expiry, revocation, patient, and record scope; links expire after 45 seconds.
- Share tokens are 256-bit random URL-safe values. Only SHA-256 hashes are stored. The raw token is returned on creation and passed to public share APIs in POST bodies; the doctor URL keeps it in a URL fragment so it is not sent in the page request. Shares are revocable and scope-limited. Full-history share references a snapshot of records at creation; later records are not added to that share.
- Rate limiting in `lib/rate-limit.ts` is process-local and suitable only for development/single-instance behavior. Replace it with a shared rate limiter before production.

## Implemented endpoints

| Endpoint | Operation |
| --- | --- |
| `GET /api/status` | Configuration status without secret values |
| `POST /api/auth/email` | Email/password sign-up or sign-in |
| `GET /api/auth/google` | Configured Google OAuth redirect |
| `GET /api/auth/callback` | Safe allowlisted OAuth callback |
| `POST /api/auth/signout` | Sign out current session |
| `POST /api/auth/reset` | Request password reset |
| `GET /api/families` | Accessible family workspaces |
| `GET, POST /api/families/:familyId/members` | List/create dependent profiles |
| `PATCH /api/members/:memberId` | Update or archive an authorized dependent profile |
| `GET, PATCH /api/profile` | Read/update the signed-in user's own profile |
| `GET, POST /api/members/:memberId/records` | Patient-scoped list/filter/upload |
| `GET, PATCH, DELETE /api/records/:recordId` | Authorized document preview, metadata update, archive |
| `GET /api/members/:memberId/timeline` | Patient-scoped saved timeline and records |
| `GET, POST /api/members/:memberId/medications` | List/create medication records |
| `GET, POST /api/medications/:medicationId/doses` | Read dose history and record a taken/skipped/missed dose (database uniqueness prevents duplicate scheduled doses) |
| `GET, POST /api/shares` | List/create scoped share sessions |
| `DELETE /api/shares/:shareId` | Revoke a share |
| `POST /api/public/share/resolve` | Resolve a token to scoped, non-document history data |
| `POST /api/public/share/document` | Reauthorize and issue a short-lived document redirect |

All private routes return generic errors and no-store responses. `GET /api/families` and related member endpoints rely on RLS for filtering; IDs in a request are never treated as authorization by themselves.

## Setup

1. Create a Supabase project. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_BASE_URL`, and the server-only `SUPABASE_SECRET_KEY` for privileged storage operations. `SUPABASE_SERVICE_ROLE_KEY` is accepted as a legacy fallback. Keep secret keys server-only. No secrets belong in browser code or source control.
2. The user reports that the latest read-only SQL Editor check returned no MediVault base tables or expected functions. A separate read-only REST request using only the publishable key returned HTTP 401 / SQLSTATE 42501, `permission denied for table families`; because the request used the anonymous role and anon is intentionally denied table access, it does not establish whether the table exists. Neither result was independently checked through an authenticated SQL catalog query here. Review the current state and SQL Editor role before applying anything. For an empty application schema, the initial migration is the only repository file that creates the tables/functions. It is new-project SQL and is not safe to rerun over an existing MediVault schema.
3. `supabase/recover_medivault_schema.sql` is for a partial installation only; it deliberately stops if required tables/functions are missing and cannot initialize an empty schema. It never creates/drops application tables or alters Supabase-managed Storage ownership/RLS. Missing Storage permissions produce warnings; a project owner may need to configure the private bucket and scoped Storage policies.
4. Run the read-only verifier in the SQL Editor before and after any future repair, then run the RLS integration test with dedicated isolated-project test credentials. The integration test creates and removes synthetic users and a synthetic PDF fixture; never point it at a production project.
5. In Supabase Auth, enable email/password and configure email confirmation/reset templates and redirect allowlists. Set callback URL to `${APP_BASE_URL}/api/auth/callback`. For Google, configure the Google provider in Supabase with its OAuth client credentials and allow the same callback URL. The application does not need Google client secrets in its environment.
6. Supabase manages RLS on `storage.objects`. The migration does not change its table-level RLS configuration. It creates the private `medical-records` bucket when absent, leaves existing bucket settings unchanged, and attempts to add scoped policies only when the SQL role permits. Verify the bucket and policy expressions with the read-only verifier and in the project dashboard.
7. Install and run with `pnpm install`, `pnpm dev`; open `http://localhost:3000`. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` are the project checks.

`APP_BASE_URL` must be the canonical HTTPS origin in production. `OCR_PROVIDER_ENDPOINT` and `OCR_PROVIDER_API_KEY` are placeholders for a future OCR adapter; there is currently no OCR provider call or background queue, and uploads truthfully return `not_configured`. `CRON_SECRET` is reserved; no scheduler or reminder delivery worker is implemented. There is no email delivery provider beyond Supabase Auth emails.

## Current limitations and production work

- The signed-in workspace uses the APIs but has not been verified against the current database. Demo fixtures remain only for signed-out use. Labs/providers, OCR, background reminders, adult invitations/account linking/consent, QR image generation, field review workflows, and global search remain incomplete.
- The user reports that the SQL Editor found no MediVault tables/functions. The anonymous REST check returned permission denied for `families`, which is expected under least privilege and inconclusive about table existence. No authenticated SQL catalog query or migration was run from this workspace. Database-backed authentication, schema application, Storage policies, RLS cross-user checks, and deployment have not been verified.
- OCR, field review/confirmation endpoints and UI, profile editing, adult invitations/account linking/consent UI, global search, emergency-only curated field snapshots, real lab catalog/provider/booking integration, notification delivery, reminder scheduling, and dashboard metrics are incomplete.
- The migration encodes database-side RLS and least-privilege table grants. Its share RPC generates the bearer token inside the database so authenticated clients cannot choose a weak token hash. The remote migration state is unknown after the failed SQL Editor attempt. Before handling real health data, test the policies in an isolated Supabase project, review consent/retention and jurisdiction-specific privacy obligations, define backup/restore and incident response, and replace process-local rate limits.
- An already issued signed storage URL remains usable until its short expiry, and downloaded copies cannot be revoked. This implementation does not claim legal or regulatory compliance.
- A server secret key was pasted into an earlier conversation. Rotate it in Supabase and update the server environment before using privileged storage operations. Secret values are not included in this document.

## Checks run in this workspace

- TypeScript type-check: passed after adding profile and patient-profile handlers.
- ESLint: passed with 0 errors; 8 existing unused-variable warnings remain in `app.js`, `medivault.js`, and `redesign.js`.
- Node tests: 2 share-token unit tests passed. The RLS integration test was skipped because isolated test-project credentials are not configured.
- Next.js production build: passed after retrying with elevated filesystem permission when the sandboxed build worker received `EPERM` writing `.next`.
- No migration was applied and no live database schema checks were run here. Read-only verification is `supabase/verify_medivault_schema.sql`; `supabase/recover_medivault_schema.sql` only repairs a complete but partially configured schema.

## Deployment notes

Deploy the Next.js app to Vercel with the same server environment variables. Configure Supabase Auth's production site URL and redirect allowlist for the deployment's canonical HTTPS host. Apply migrations through a reviewed release process, never against production as an unreviewed local experiment. Restrict secret-key access and rotate it if exposed. Add a shared rate-limit provider, monitoring, synthetic-data security tests, backup/restore verification, a production OCR/job provider if needed, and frontend integration before enabling real patient workflows.
