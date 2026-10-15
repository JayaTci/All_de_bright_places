// Maps fixed editor profiles to safe public DTOs and manages private picture objects.
import "server-only";
import sharp from "sharp";
import type { EditorProfile, EditorUsername, PictureVisibility } from "@bright/shared";
import type { JournalClient } from "../config/supabase";
import { databaseError, HttpError } from "../utils/http";

export const MAX_PROFILE_PICTURE_BYTES = 3 * 1024 * 1024;
const BUCKET = "profile-pictures";
interface ProfileRow { username: EditorUsername; bio: string; picture_visibility: PictureVisibility; picture_id: string | null }

// Builds the only permitted object path from a fixed username and generated UUID.
export function profilePicturePath(username: EditorUsername, id: string) { return `${username}/${id}.webp`; }

/**
 * Returns only profile fields safe for a viewer, omitting a restricted image URL.
 * @param row - A public profile row without account identifiers or storage credentials.
 * @param verifiedEditor - Whether the caller is one of the two MFA-verified editors.
 * @returns A profile suitable for the homepage or account form.
 */
export function mapProfile(row: ProfileRow, verifiedEditor: boolean): EditorProfile {
  const visible = Boolean(row.picture_id && (row.picture_visibility === "public" || verifiedEditor));
  return {
    username: row.username, bio: row.bio, pictureVisibility: row.picture_visibility,
    hasPicture: visible, pictureVersion: visible ? row.picture_id : null,
    pictureUrl: visible ? `/api/profiles/${row.username}/picture?v=${row.picture_id}` : null,
  };
}

/**
 * Reads the two fixed profiles through RLS and maps picture access for the caller.
 * @param client - Caller-scoped Supabase client.
 * @param verifiedEditor - Whether MFA has been verified for a fixed editor.
 * @returns Both profiles in their fixed display order.
 * @throws When profile storage is unavailable.
 */
export async function getProfiles(client: JournalClient, verifiedEditor: boolean): Promise<EditorProfile[]> {
  const result = await client.from("editor_profiles").select("username,bio,picture_visibility,picture_id").in("username", ["ruby", "jayatci"]);
  databaseError(result.error);
  const rows = (result.data || []) as ProfileRow[];
  return (["ruby", "jayatci"] as const).flatMap(username => {
    const row = rows.find(profile => profile.username === username);
    return row ? [mapProfile(row, verifiedEditor)] : [];
  });
}

/**
 * Reads one profile using the same visibility policy as the homepage.
 * @param client - Caller-scoped Supabase client.
 * @param username - Fixed editor username.
 * @param verifiedEditor - Whether MFA has been verified.
 * @returns The requested safe profile.
 * @throws When the profile is absent or the database is unavailable.
 */
export async function getProfile(client: JournalClient, username: EditorUsername, verifiedEditor: boolean): Promise<EditorProfile> {
  const result = await client.from("editor_profiles").select("username,bio,picture_visibility,picture_id").eq("username", username).maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new HttpError(404, "Profile not found.");
  return mapProfile(result.data as ProfileRow, verifiedEditor);
}

/**
 * Validates raster input and produces a square WebP without EXIF, ICC, or other metadata.
 * @param bytes - Browser-uploaded JPEG, PNG, or WebP bytes.
 * @returns One bounded 512-pixel square WebP buffer.
 * @throws When the image is oversized, unsupported, or unreadable.
 */
export async function normalizeProfilePicture(bytes: Uint8Array): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_PROFILE_PICTURE_BYTES) throw new HttpError(413, "Choose a picture smaller than 3 MB.");
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) throw new HttpError(400, "Choose a JPEG, PNG, or WebP picture.");
    const output = await image.rotate().resize(512, 512, { fit: "cover", position: "centre" }).webp({ quality: 82 }).toBuffer();
    if (output.length > MAX_PROFILE_PICTURE_BYTES) throw new HttpError(413, "This picture is too large after processing.");
    return output;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "This picture could not be read."); }
}

/**
 * Removes interrupted or replaced objects before another profile picture mutation.
 * @param client - MFA-verified owner's Supabase client.
 * @param username - Owner of the generated object paths.
 * @param failedReservationId - This request's failed reservation, which may be cleared before lease expiry.
 * @returns Nothing after both cleanup markers are cleared.
 * @throws On storage or database failure, retaining markers for the next retry.
 */
export async function cleanProfilePictureObjects(client: JournalClient, username: EditorUsername, failedReservationId?: string): Promise<void> {
  const state = await client.rpc("profile_picture_cleanup_state", { p_username: username }); databaseError(state.error);
  const row = (state.data as { pending_id: string | null; pending_at: string | null; stale_id: string | null }[] | null)?.[0];
  if (!row) throw new HttpError(503, "Profile picture cleanup is unavailable.");
  // Another request may still be uploading. Only its own failed reservation or an expired lease may be reclaimed.
  const expired = row.pending_at !== null && Date.now() - Date.parse(row.pending_at) > 5 * 60_000;
  const pending = row.pending_id && (row.pending_id === failedReservationId || expired) ? row.pending_id : null;
  for (const [id, rpc] of [[pending, "clear_profile_pending"], [row.stale_id, "clear_profile_stale"]] as const) {
    if (!id) continue;
    const removed = await client.storage.from(BUCKET).remove([profilePicturePath(username, id)]); databaseError(removed.error);
    const cleared = await client.rpc(rpc, { p_username: username, p_id: id }); databaseError(cleared.error);
  }
}

/**
 * Publishes a normalized image with a reservation, preserving recoverable cleanup state.
 * @param client - MFA-verified owner's Supabase client.
 * @param username - Owner of the destination profile.
 * @param bytes - Validated browser upload bytes.
 * @returns The updated profile with an authorized picture URL.
 * @throws On upload, database, or cleanup failure.
 */
export async function publishProfilePicture(client: JournalClient, username: EditorUsername, bytes: Uint8Array): Promise<EditorProfile> {
  const image = await normalizeProfilePicture(bytes);
  await cleanProfilePictureObjects(client, username);
  const id = crypto.randomUUID();
  const reserved = await client.rpc("reserve_profile_picture", { p_username: username, p_id: id }); databaseError(reserved.error);
  try {
    const uploaded = await client.storage.from(BUCKET).upload(profilePicturePath(username, id), image, { contentType: "image/webp", cacheControl: "0", upsert: false });
    databaseError(uploaded.error);
    const finalized = await client.rpc("finalize_profile_picture", { p_username: username, p_id: id }); databaseError(finalized.error);
  } catch (error) {
    try { await cleanProfilePictureObjects(client, username, id); } catch { /* Reservation remains for a future retry. */ }
    throw error;
  }
  try { await cleanProfilePictureObjects(client, username); } catch { /* Published picture remains current; tracked stale object is retried next time. */ }
  return getProfile(client, username, true);
}

/**
 * Hides the owner's image immediately and removes its private object with retry tracking.
 * @param client - MFA-verified owner's Supabase client.
 * @param username - Owner of the profile.
 * @returns The updated profile with its initial fallback.
 * @throws On database or storage failure.
 */
export async function removeProfilePicture(client: JournalClient, username: EditorUsername): Promise<EditorProfile> {
  await cleanProfilePictureObjects(client, username);
  const result = await client.rpc("remove_profile_picture", { p_username: username }); databaseError(result.error);
  try { await cleanProfilePictureObjects(client, username); } catch { /* Removal is already visible; tracked object is retried next time. */ }
  return getProfile(client, username, true);
}
