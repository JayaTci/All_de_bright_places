# All de bright places

A shared bucket list and memory journal for Ruby and Jayatci. Visitors can see goals marked public. Only the two MFA-verified editors can view private goals, make changes, or open the change history.

Each editor can add a short public bio and a profile picture from **Our corner**. The picture can be **Public** or **Friends only**; friends means the two MFA-verified editors. New pictures start Public. The homepage shows both profiles, with initials when a picture is absent or hidden from a visitor.

## Run locally

Requirements: Node.js 22 or later, pnpm 10, Docker Desktop, and the Supabase CLI.

1. Install dependencies with `pnpm install`.
2. Start local Supabase with `pnpm db:start`.
3. Set the local Supabase URL and publishable key in the ignored `All_de_bright_placesFrontend/.env.local`. Add the two server-only editor email mappings. See [local setup](docs/setup.md).
4. Start the web app with `pnpm dev`. It opens at `http://127.0.0.1:3000`. Private goals appear after editor sign-in and authenticator verification.

The local database uses the migrations in `All_de_bright_placesDatabase/migrations`. Production setup, editor provisioning, backup, and recovery instructions are in [owner operations](docs/owner-operations.md).

## Project checks

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Data and privacy

Private goals, memories, photos, Friends only profile pictures, and the editor change history are protected by server authorization and database policies. Owner-specific goal text is kept outside this public repository. Keep service credentials in local environment files. The project uses an MIT license for its application code. Personal journal content and reference artwork are not covered by that license.
