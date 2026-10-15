# Owner operations

These scripts run only on an owner's machine. Set `OWNER_SUPABASE_URL` and `OWNER_SUPABASE_SECRET_KEY` privately in the current shell. Never configure the administrative key in Vercel, browser environment variables, public CI, or tracked files. Local output goes into ignored `_workspace/owner`. Windows users should restrict this directory's ACL to their own account and store exported backups encrypted.

## Provisioning

Apply migrations first. In Supabase Auth, disable project-wide public signup while keeping the email provider enabled for password sign-in. Disabling the email provider also blocks the two owner-created accounts from signing in. Enable TOTP enrollment/verification and configure the approved site URL and `/auth/recovery` redirect URL. Configure Turnstile in the Auth dashboard separately. Use the publishable key and URL in the application.

Set `OWNER_RUBY_EMAIL` and `OWNER_JAYATCI_EMAIL` privately, then run `node scripts/owner-provision.mjs`. The script generates strong temporary passwords, creates confirmed Auth users, and writes their immutable IDs to the editor allowlist. Read the generated private output to obtain temporary credentials and the IDs needed by server configuration. It skips already provisioned usernames. If provisioning interrupts between Auth user creation and allowlist insertion, inspect the dashboard and associate the existing user rather than creating duplicates.

Deliver credentials to each editor yourself through your chosen private channel. Neither script sends messages. Each editor should change their temporary password and enroll an authenticator at first sign-in.

## Recovery

Set `OWNER_RECOVERY_REDIRECT` to the application's exact approved `/auth/recovery` URL. Run `node scripts/owner-recovery.mjs ruby` or replace the name with `jayatci`. The script saves a site URL containing `token_hash` and `type=recovery`, which the recovery page can redeem. Its contents are never printed.

After verifying the editor's identity yourself, use `--reset-mfa` only when their authenticator is lost. This removes the account's TOTP factors. The next password session still cannot access private journal data until a new factor is enrolled and verified. Recovery links expire and must not be committed or shared publicly. Delete local temporary credential and recovery files after use.

## Content backup and restoration

Keep editors idle during capture because REST table exports are not a single database snapshot. Run `node scripts/owner-backup.mjs`. It exports all content tables, including Trash, private notes, editor change history, public profile bios, picture privacy settings, and published profile pictures. It downloads both variants of every ready memory photo and the bytes of each published profile picture. In-progress and stale profile uploads are excluded. It records account IDs for reference. Auth passwords and MFA secrets are intentionally not exported.

Create a recovery key once with `node scripts/owner-archive.mjs keygen _workspace/owner/backup-recovery.key`. Encrypt each snapshot with `node scripts/owner-archive.mjs encrypt <backup-directory> <external-destination>.adbenc _workspace/owner/backup-recovery.key`. The archive uses AES-256-GCM, so a damaged archive or wrong key is rejected. Keep a copy of the encrypted archive off this computer and keep a copy of the key in a separate safe place. A copy on the same disk alone does not protect against disk failure. Never commit either file.

To open an encrypted archive, run `node scripts/owner-archive.mjs decrypt <archive>.adbenc <new-empty-directory> <recovery-key-file>`. The tool verifies the archive before extracting it. Use the extracted directory with `owner-restore.mjs` against a separate target.

Test restoration against a separate local or staging project. Apply all migrations, including the profile migration, and provision both target editors. Set owner environment variables to that target, and set `OWNER_RESTORE_CONFIRM_URL` to the exact same target URL. Run `node scripts/owner-restore.mjs <backup-directory>`. The target must have no goals. Content associations use usernames, so fresh target Auth IDs work. Restored memory photos remain pending until both variants have uploaded. Restored profile pictures remain unpublished until their object upload succeeds. Older format-one backups without profiles remain accepted and leave the target's default empty profiles in place.

If this same restoration interrupts, run it again with `--resume`. This flag permits idempotent merging into that interrupted target. Do not use it to merge independent journals. Compare counts for goals, participants, memories, photos, and profiles. Open representative public/private/Trash content and verify both memory photo variants. Check each profile bio, picture privacy mode, and image bytes from the restored bucket. A restoration test is complete only after those checks pass.

Run `node --test All_de_bright_placesDatabase/tests/owner-tools.test.mjs` for the automated local HTTP fixture check. It verifies content export, actual image byte handling, restore order, delayed image publication, and compatibility with older snapshots. It does not substitute for restoring against a real Supabase target.

## Login rate limit

In the Vercel project Firewall, keep one active rate limit rule with both conditions: request path equals `/api/auth/login` and request method equals `POST`. Use a fixed window of 300 seconds, a limit of 10 requests, the IP counting key, and the default 429 response. The rule counts all matching login requests, including attempts that fail CAPTCHA or password verification. Vercel applies firewall changes without a redeploy. Hobby includes one rate limit rule per project; check the current plan limits before adding another.

Before production deployment, run the database authorization suite, verify the Auth/Turnstile and firewall settings, and check that only runtime publishable credentials are configured. Deploy migrations from a reviewed local environment. Free service limits and pausing behavior should be verified in the hosting dashboards at launch.
