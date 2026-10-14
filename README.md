# All de bright places

A shared bucket list and memory journal for Ruby and Jayatci. Visitors can see goals marked public. Only the two MFA-verified editors can view private goals, make changes, or open the change history.

## Run locally

Requirements: Node.js 22 or later, pnpm 10, and the Supabase CLI.

1. Install dependencies with `pnpm install`.
2. Start local Supabase with `pnpm db:start`.
3. Copy `.env.example` to `All_de_bright_placesFrontend/.env.local` and set the local Supabase publishable key and Turnstile values.
4. Start the web app with `pnpm dev`. It opens at `http://127.0.0.1:3000`.

The local database uses the migrations in `All_de_bright_placesDatabase/migrations`. Production setup, editor provisioning, backup, and recovery instructions are in [owner operations](docs/owner-operations.md).

## Project checks

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Data and privacy

Private goals, memories, photos, and the editor change history are protected by server authorization and database policies. Owner-specific goal text is kept outside this public repository. Keep service credentials in local environment files. The project uses an MIT license for its application code. Personal journal content and reference artwork are not covered by that license.
