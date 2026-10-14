// Adapts Next.js routing to the server-only photos/[id] service.
export { photoDELETE as DELETE } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
