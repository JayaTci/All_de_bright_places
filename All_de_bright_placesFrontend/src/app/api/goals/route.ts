// Adapts Next.js routing to the server-only goals service.
export { goalsPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
