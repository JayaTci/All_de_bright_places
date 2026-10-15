// Adapts Next.js routing to visibility-checked picture reads and owner writes.
export { profilePictureGET as GET, profilePicturePOST as POST, profilePictureDELETE as DELETE } from "@bright/backend/routes/handlers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
