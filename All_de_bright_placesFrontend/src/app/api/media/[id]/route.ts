// Adapts Next.js routing to the server-only media/[id] service.
export { mediaGET as GET } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
