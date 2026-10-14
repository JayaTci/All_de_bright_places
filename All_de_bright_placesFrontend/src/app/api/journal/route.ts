// Adapts Next.js routing to the server-only journal service.
export { journalGET as GET } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
