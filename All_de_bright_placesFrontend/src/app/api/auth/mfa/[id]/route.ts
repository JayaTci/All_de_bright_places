// Adapts Next.js routing to the server-only auth/mfa/[id] service.
export { factorDELETE as DELETE } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
