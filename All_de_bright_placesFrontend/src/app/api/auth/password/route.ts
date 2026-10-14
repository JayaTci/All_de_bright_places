// Adapts Next.js routing to the server-only auth/password service.
export { passwordPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
