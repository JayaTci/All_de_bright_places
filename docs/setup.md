# Local setup

The local site needs both Next.js and Supabase. Docker Desktop must be running before `pnpm db:start`.

1. Run `pnpm install` at the repository root.
2. Run `pnpm db:start`. This starts local Supabase and applies the tracked migrations. The optional Vector log collector is excluded because the app does not use it.
3. Run `pnpm exec supabase --workdir All_de_bright_placesDatabase status` in your own terminal. Copy only the local API URL and publishable key into an ignored `All_de_bright_placesFrontend/.env.local`, using `.env.example` as a guide. The status output also contains administrative credentials, so keep it private.
4. Set `RUBY_AUTH_EMAIL` and `JAYATCI_AUTH_EMAIL` in that same file to the emails of the two owner-provisioned local accounts. Set `ALLOW_LOCAL_CAPTCHA_BYPASS=true` only for local Supabase when CAPTCHA is disabled there.
5. Provision the two accounts with `scripts/owner-provision.mjs` as described in [owner operations](owner-operations.md). The owner-only goal seed, if available, must be applied after migrations. It is intentionally absent from Git.
6. Run `pnpm dev`, then open `http://127.0.0.1:3000/login`. Each editor signs in, enrolls an authenticator, and verifies a code before private goals appear.

Keep `auth.enable_signup = false` and `auth.email.enable_signup = true` in the local Supabase config. The first setting blocks public signup. The second allows the two provisioned accounts to use email passwords. `pnpm exec supabase --workdir All_de_bright_placesDatabase stop` preserves local database data; `pnpm db:reset` deletes and recreates it.

To load the ignored owner seed into an empty local journal, first confirm `select count(*) from public.goals` returns zero in the local database. Then run:

```powershell
docker exec supabase_db_all-de-bright-places psql -U postgres -d postgres -Atc "select count(*) from public.goals;"
docker cp All_de_bright_placesDatabase/seeds/private_initial_goals.sql supabase_db_all-de-bright-places:/tmp/private_initial_goals.sql
docker exec supabase_db_all-de-bright-places psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/private_initial_goals.sql
```

The seed is intended to run once per empty database. Running it again inserts duplicate goals.
