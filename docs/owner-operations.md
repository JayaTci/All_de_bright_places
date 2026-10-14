# Owner operations

These scripts run only on an owner's machine. Set `OWNER_SUPABASE_URL` and `OWNER_SUPABASE_SECRET_KEY` privately in the current shell. Never configure the administrative key in Vercel, browser environment variables, public CI, or tracked files. Local output goes into ignored `_workspace/owner`. Windows users should restrict this directory's ACL to their own account and store exported backups encrypted.

## Provisioning

Apply migrations first. In Supabase Auth, disable project-wide public signup while keeping the email provider enabled for password sign-in. Disabling the email provider also blocks the two owner-created accounts from signing in. Enable TOTP enrollment/verification and configure the approved site URL and `/auth/recovery` redirect URL. Configure Turnstile in the Auth dashboard separately. Use the publishable key and URL in the application.

Set `OWNER_RUBY_EMAIL` and `OWNER_JAYATCI_EMAIL` privately, then run `node scripts/owner-provision.mjs`. The script generates strong temporary passwords, creates confirmed Auth users, and writes their immutable IDs to the editor allowlist. Read the generated private output to obtain temporary credentials and the IDs needed by server configuration. It skips already provisioned usernames. If provisioning interrupts between Auth user creation and allowlist insertion, inspect the dashboard and associate the existing user rather than creating duplicates.

Deliver credentials to each editor yourself through your chosen private channel. Neither script sends messages. Each editor should change their temporary password and enroll an authenticator at first sign-in.

## Recovery

Set `OWNER_RECOVERY_REDIRECT` to the application's approved `/auth/recovery` URL. Run `node scripts/owner-recovery.mjs ruby` or replace the name with `jayatci`. The recovery link is saved privately and its contents are never printed.

After verifying the editor's identity yourself, use `--reset-mfa` only when their authenticator is lost. This removes the account's TOTP factors. The next password session still cannot access private journal data until a new factor is enrolled and verified. Recovery links expire and must not be committed or shared publicly. Delete local temporary credential and recovery files after use.

## Content backup and restoration

Keep editors idle during capture because REST table exports are not a single database snapshot. Run `node scripts/owner-backup.mjs`. It exports all content tables, including Trash and private notes, and downloads both variants of every ready photo. It records account IDs for reference. Auth passwords and MFA secrets are intentionally not exported.

Test restoration against a separate local or staging project. Apply the migration and provision both target editors. Set owner environment variables to that target, and set `OWNER_RESTORE_CONFIRM_URL` to the exact same target URL. Run `node scripts/owner-restore.mjs <backup-directory>`. The target must have no goals. Content associations use usernames, so fresh target Auth IDs work. Restored photos remain pending until both variants have uploaded.

If this same restoration interrupts, run it again with `--resume`. This flag permits idempotent merging into that interrupted target. Do not use it to merge independent journals. Compare counts for goals, participants, memories, and photos, open representative public/private/Trash content, and verify both image variants. A restoration test is complete only after those checks pass.

Run `node --test All_de_bright_placesDatabase/tests/owner-tools.test.mjs` for the automated local HTTP fixture check. It verifies content export, actual photo byte handling, restore order, and delayed photo publication. It does not substitute for restoring against a real Supabase target.

Before production deployment, run the database authorization suite, configure login rate limiting in Vercel, verify the Auth/Turnstile settings, and check that only runtime publishable credentials are configured. Deploy migrations from a reviewed local environment. Free service limits and pausing behavior should be verified in the hosting dashboards at launch.
