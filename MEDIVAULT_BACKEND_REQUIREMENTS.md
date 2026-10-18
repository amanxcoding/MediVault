# MediVault backend requirements

## Current implementation boundary

See [BACKEND_IMPLEMENTATION.md](BACKEND_IMPLEMENTATION.md) for the current backend foundation, route inventory, configuration, and incomplete production work. The authenticated shell now loads family, record, timeline, medication, dose-log, profile, and share-link data through same-origin APIs. The signed-out preview remains fictional. Supabase credentials are present locally, but live schema/auth isolation has not been verified; do not use real patient data until database checks and security tests pass.

The repository began as a static HTML/CSS/JavaScript prototype. The authenticated view uses the server layer described in `BACKEND_IMPLEMENTATION.md`; the signed-out preview still uses fictional fixtures and local-only changes.

The signed-out demo QR flow remains local-only. The authenticated share view uses the server share endpoints and provides an opaque, expiring link, but does not yet render a QR image. Do not use demo QR cards to protect real records.

## Required before production health data

1. **Authentication and family ownership**
   - Configure Supabase Auth, Google OAuth credentials, allowed callback URLs, and production redirect URLs.
   - Keep project URL and publishable key in the supported client configuration. Never put a service-role key or other server secret in browser code.
   - Model users, families, family membership, and permissions with stable UUIDs. Define who can add, edit, delete, and share each patient’s data.

2. **Database isolation**
   - Persist patients, records, medications, dose events, and appointments using `member_id` foreign keys.
   - Enable and test Row Level Security on every patient-linked table. Policies must verify authenticated family membership and role for every read and write.
   - Use server-side queries that enforce the same family and patient scope. Do not treat frontend filters as authorization.

3. **Private documents**
   - Store originals in private buckets with unpredictable object keys. Do not use public buckets or permanent public URLs.
   - Authorize each preview/download on the server. For shared access, check the active token, allowed member, scope, expiry, and revocation before returning each document.
   - Add upload validation, malware/content checks, size limits, durable metadata, and a retention/deletion policy.

4. **Share-token service**
   - Create server endpoints for share creation, read-only history access, document access, and immediate revocation.
   - Generate at least 128 bits of cryptographic randomness server-side and store only a token hash with `member_id`, scope, expiry, revocation state, and creation metadata.
   - Enforce expiry and revocation on every page and document request. Rate-limit token endpoints and return generic failures for invalid, expired, and revoked links.
   - Apply `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow` at the HTTP response layer. Avoid logging tokens or medical content. Keep QR URLs limited to the opaque token.
   - Write audit events for creation, access, document access, and revocation without including medical data in analytics or routine logs.

5. **Medical facts and OCR**
   - If OCR is added, store extracted values with source-record ID, page, date, extraction method, confidence/uncertainty, reviewer, and verification state.
   - Keep extracted content unverified until a user or authorized reviewer confirms it. Preserve edit history and source links; never infer a diagnosis or treatment recommendation from an uncertain extraction.

6. **Verification**
   - Add integration tests for cross-family and cross-patient access, full versus emergency scope, token guessing resistance, expiry, revocation, stale document links, and concurrent access.
   - Verify private storage policies and database RLS directly, not only through UI tests. Add deployment headers, production OAuth callbacks, backup/restore, and monitoring checks.

The local demo should remain populated only with clearly labeled fictional data until these server controls and tests are in place.
