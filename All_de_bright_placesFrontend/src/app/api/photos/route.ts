// Adapts Next.js routing to the server-only photos service.
export { photoPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
