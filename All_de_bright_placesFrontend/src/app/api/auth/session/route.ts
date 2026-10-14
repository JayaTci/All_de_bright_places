// Adapts Next.js routing to the server-only auth/session service.
export { sessionGET as GET } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
