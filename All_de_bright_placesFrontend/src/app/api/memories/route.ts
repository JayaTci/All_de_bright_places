// Adapts Next.js routing to the server-only memories service.
export { memoriesPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
