// Adapts Next.js routing to the server-only goals/[id] service.
export { goalPATCH as PATCH } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
