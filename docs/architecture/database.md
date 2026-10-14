# Journal database

The authoritative baseline is `All_de_bright_placesDatabase/migrations/202610140001_journal.sql`. Run `node scripts/db-sync-migrations.mjs` before using the Supabase CLI. Its generated mirror is local-only.

`editor_accounts` holds two immutable Auth IDs and usernames. Only the owner administration tools can change this table. JWT user metadata never grants editor status. An editor session must also carry `aal2` to read private content or mutate journal content. An `aal1` editor can read their own allowlist row to complete authenticator enrollment.

Goals carry publication state, manual position, revision, and soft deletion. Participants carry individual completion dates. Memories and photos inherit goal visibility. Deleted goals and memories remain readable by both MFA-authenticated editors. Visitors cannot see deleted content or pending photo reservations.

All goal and memory writes use security-definer RPCs with an empty search path and an explicit editor/MFA check. Direct table write grants are absent, except the three photo finalization columns. Goal and memory mutation RPCs compare the supplied revision inside a row lock and raise `CONFLICT` for stale writes. Manual moves serialize allocation and atomically swap neighbor positions. Participant replacement preserves existing participants' completion dates.

Photo reservations lock the memory and enforce ten attachments, including pending reservations. Failed uploads must remove any written variants before calling `cancel_photo`. Attachment deletion removes the variants first and then calls `delete_photo`. Owners can inspect orphaned reservations during maintenance.

The private `journal-photos` bucket accepts only WebP files up to 3 MB. Paths are `display/{photoId}.webp` and `thumbnail/{photoId}.webp`. Downloads use the authenticated-object operation and check current publication state. Public goals can be downloaded using the anonymous application key. Listing is editor-only. No policy permits signed URLs or batch signed URLs. The server media adapter must send `Cache-Control: private, no-store` and must not use the Next.js image optimizer.

Policies use the official operation helpers described in [Supabase Storage Helper Functions](https://supabase.com/docs/guides/storage/schema/helper-functions). A Supabase deployment without these helpers must be upgraded before migration. Do not replace the operation restriction with unrestricted `SELECT` access.

Run local database tests with:

```powershell
node scripts/db-sync-migrations.mjs
pnpm exec supabase --workdir All_de_bright_placesDatabase start
pnpm exec supabase --workdir All_de_bright_placesDatabase db reset
pnpm exec supabase --workdir All_de_bright_placesDatabase test db
```

Tests run inside a rollback transaction with simulated anonymous, unapproved, password-only, and MFA editor claims. They exercise parent visibility, mutation denial, stale revisions, cross-editor access, and download/signing distinctions. No production seed content is installed.
