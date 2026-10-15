// Adapts Next.js routing to the server-only public profile listing.
export { profilesGET as GET } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
