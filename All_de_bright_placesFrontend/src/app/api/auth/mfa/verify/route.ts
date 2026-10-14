// Adapts Next.js routing to the server-only auth/mfa/verify service.
export { mfaVerifyPOST as POST } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
