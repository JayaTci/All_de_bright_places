// Adapts Next.js routing to the server-only owned profile update.
export { profilePATCH as PATCH } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
