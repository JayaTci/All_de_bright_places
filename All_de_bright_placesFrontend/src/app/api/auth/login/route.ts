// Adapts Next.js routing to the server-only auth/login service.
export { loginPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
