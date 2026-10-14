// Adapts Next.js routing to the server-only auth/logout service.
export { logoutPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
