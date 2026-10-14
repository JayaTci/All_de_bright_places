// Adapts Next.js routing to the server-only memories/[id] service.
export { memoryPATCH as PATCH } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
