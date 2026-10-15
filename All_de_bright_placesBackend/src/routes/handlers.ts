// Implements uncached journal, account, MFA, and image APIs behind thin Next.js routes.
import "server-only";
import { z } from "zod";
import { goalInputSchema, goalMutationSchema, memoryInputSchema, memoryMutationSchema, loginSchema, profileInputSchema, usernameSchema } from "@bright/shared";
import { connection, serverClient } from "../config/supabase";
import { editorSession, requireEditor } from "../services/auth";
import { getJournal } from "../services/journal";
import { MAX_UPLOAD_BYTES, normalizePhoto, photoPaths } from "../services/photos";
import { getProfile, getProfiles, MAX_PROFILE_PICTURE_BYTES, profilePicturePath, publishProfilePicture, removeProfilePicture } from "../services/profiles";
import { api, assertOrigin, databaseError, HttpError, identifier, json, PRIVATE_HEADERS, readJson, readUpload } from "../utils/http";

type RouteContext = { params: Promise<{ id: string }> };
type ProfileRouteContext = { params: Promise<{ username: string }> };
// Rejects unknown profile paths before they reach database or storage queries.
function profileUsername(value: string) {
  const result = usernameSchema.safeParse(value);
  if (!result.success) throw new HttpError(404, "Profile not found.");
  return result.data;
}
const verifySchema = z.object({ factorId: z.uuid().optional(), code: z.string().regex(/^\d{6}$/) });
const passwordSchema = z.object({ password: z.string().min(12).max(128) });
const recoverySchema = z.object({ tokenHash: z.string().min(16).max(512), type: z.enum(["recovery", "invite"]) });

/** Serves visible goals, distinguishing empty journals from unavailable services. */
export async function journalGET() { return api(async () => json(await getJournal())); }

/** Returns both public biographies and picture links allowed for this viewer. */
export async function profilesGET() {
  return api(async () => {
    const client = await serverClient(); const session = await editorSession(client);
    return json({ profiles: await getProfiles(client, Boolean(session?.aal2)) });
  });
}

/** Saves only the MFA-verified caller's public bio and picture audience. */
export async function profilePATCH(request: Request, context: ProfileRouteContext) {
  return api(async () => {
    assertOrigin(request); const username = profileUsername((await context.params).username);
    const client = await serverClient(); const session = await requireEditor(client);
    if (session.username !== username) throw new HttpError(403, "This profile belongs to another editor.");
    const input = await readJson(request, profileInputSchema);
    const result = await client.rpc("update_editor_profile", { p_username: username, p_bio: input.bio, p_visibility: input.pictureVisibility }); databaseError(result.error);
    return json({ profile: await getProfile(client, username, true) });
  });
}

/** Streams only the active picture when database and Storage visibility both permit it. */
export async function profilePictureGET(_request: Request, context: ProfileRouteContext) {
  return api(async () => {
    const username = profileUsername((await context.params).username);
    const client = await serverClient(); const session = await editorSession(client);
    const profile = await getProfile(client, username, Boolean(session?.aal2));
    if (!profile.pictureVersion) throw new HttpError(404, "Picture not found.");
    const result = await client.storage.from("profile-pictures").download(profilePicturePath(username, profile.pictureVersion));
    if (result.error || !result.data) throw new HttpError(404, "Picture not found.");
    return new Response(result.data, { headers: { ...PRIVATE_HEADERS, "Content-Type": "image/webp", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  });
}

/** Replaces only the caller's picture after bounded raster normalization. */
export async function profilePicturePOST(request: Request, context: ProfileRouteContext) {
  return api(async () => {
    assertOrigin(request); const username = profileUsername((await context.params).username);
    const client = await serverClient(); const session = await requireEditor(client);
    if (session.username !== username) throw new HttpError(403, "This profile belongs to another editor.");
    const form = await readUpload(request, MAX_PROFILE_PICTURE_BYTES + 65_536); const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a picture to upload.");
    if (file.size > MAX_PROFILE_PICTURE_BYTES) throw new HttpError(413, "Choose a picture smaller than 3 MB.");
    return json({ profile: await publishProfilePicture(client, username, new Uint8Array(await file.arrayBuffer())) });
  });
}

/** Removes only the caller's picture and returns the initial fallback profile. */
export async function profilePictureDELETE(request: Request, context: ProfileRouteContext) {
  return api(async () => {
    assertOrigin(request); const username = profileUsername((await context.params).username);
    const client = await serverClient(); const session = await requireEditor(client);
    if (session.username !== username) throw new HttpError(403, "This profile belongs to another editor.");
    return json({ profile: await removeProfilePicture(client, username) });
  });
}

/** Creates a validated goal through the transactional database service. */
export async function goalsPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); await requireEditor(client);
    const input = await readJson(request, goalInputSchema);
    const result = await client.rpc("create_goal", { p_payload: input }); databaseError(result.error);
    return json({ id: result.data }, 201);
  });
}

/** Applies a revision-checked edit, completion, order, or Trash operation. */
export async function goalPATCH(request: Request, context: RouteContext) {
  return api(async () => {
    assertOrigin(request); const id = identifier((await context.params).id); const client = await serverClient(); await requireEditor(client);
    const input = await readJson(request, goalMutationSchema);
    const payload = input.action === "edit" ? input.input : input.action === "complete" ? { username: input.username, completedOn: input.completedOn } : input.action === "move" ? { direction: input.direction } : {};
    const result = await client.rpc("mutate_goal", { p_id: id, p_revision: input.revision, p_action: input.action, p_payload: payload }); databaseError(result.error);
    return json({ ok: true });
  });
}

/** Adds a dated memory attributed to the verified caller by the database. */
export async function memoriesPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); await requireEditor(client);
    const input = await readJson(request, memoryInputSchema);
    const result = await client.rpc("create_memory", { p_goal_id: input.goalId, p_occurred_on: input.occurredOn, p_note: input.note }); databaseError(result.error);
    return json({ id: result.data }, 201);
  });
}

/** Applies a revision-checked memory edit or deletion. */
export async function memoryPATCH(request: Request, context: RouteContext) {
  return api(async () => {
    assertOrigin(request); const id = identifier((await context.params).id); const client = await serverClient(); await requireEditor(client);
    const input = await readJson(request, memoryMutationSchema);
    const payload = input.action === "edit" ? { occurredOn: input.occurredOn, note: input.note } : {};
    const result = await client.rpc("mutate_memory", { p_id: id, p_revision: input.revision, p_action: input.action, p_payload: payload }); databaseError(result.error);
    return json({ ok: true });
  });
}

/** Processes one photograph, atomically reserves capacity, and publishes both variants. */
export async function photoPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); await requireEditor(client);
    const form = await readUpload(request, MAX_UPLOAD_BYTES + 65_536);
    const memoryId = z.uuid().safeParse(form.get("memoryId"));
    const caption = z.string().trim().max(500).safeParse(form.get("caption") || "");
    const file = form.get("file");
    if (!memoryId.success || !caption.success || !(file instanceof File)) throw new HttpError(400, "Please check the photograph details.");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Choose a photograph smaller than 3 MB.");
    const variants = await normalizePhoto(new Uint8Array(await file.arrayBuffer()));
    const reservation = await client.rpc("reserve_photo", { p_memory_id: memoryId.data, p_caption: caption.data }); databaseError(reservation.error);
    const id = identifier(reservation.data as string); const bucket = client.storage.from("journal-photos"); const paths = photoPaths(id);
    try {
      const display = await bucket.upload(paths[0], variants.display, { contentType: "image/webp", cacheControl: "0", upsert: false }); databaseError(display.error);
      const thumbnail = await bucket.upload(paths[1], variants.thumbnail, { contentType: "image/webp", cacheControl: "0", upsert: false }); databaseError(thumbnail.error);
      const update = await client.from("photos").update({ width: variants.width, height: variants.height, ready: true }).eq("id", id).select("id").single(); databaseError(update.error);
      return json({ id }, 201);
    } catch (error) {
      await bucket.remove(paths); await client.rpc("cancel_photo", { p_id: id }); throw error;
    }
  });
}

/** Removes accessible photograph variants before deleting their database metadata. */
export async function photoDELETE(request: Request, context: RouteContext) {
  return api(async () => {
    assertOrigin(request); const id = identifier((await context.params).id); const client = await serverClient(); await requireEditor(client);
    const photo = await client.from("photos").select("id").eq("id", id).maybeSingle(); databaseError(photo.error);
    if (!photo.data) throw new HttpError(404, "Photograph not found.");
    const removed = await client.storage.from("journal-photos").remove(photoPaths(id)); databaseError(removed.error);
    const result = await client.rpc("delete_photo", { p_id: id }); databaseError(result.error);
    return json({ ok: true });
  });
}

/** Rechecks caller RLS on every photograph request and returns private, uncached bytes. */
export async function mediaGET(request: Request, context: RouteContext) {
  return api(async () => {
    const id = identifier((await context.params).id); const variant = new URL(request.url).searchParams.get("variant") || "display";
    if (!["thumbnail", "display"].includes(variant)) throw new HttpError(400, "Invalid photograph variant.");
    const client = await serverClient();
    // Prime the caller's session before RLS checks; a private image is fetched
    // independently of the page request that rendered its URL.
    const { data: { user } } = await client.auth.getUser();
    const photo = await client.from("photos").select("id").eq("id", id).eq("ready", true).maybeSingle(); databaseError(photo.error);
    if (!photo.data) {
      if (user) console.warn("Memory photograph metadata was not visible to its authenticated requester.");
      throw new HttpError(404, "Photograph not found.");
    }
    const result = await client.storage.from("journal-photos").download(`${variant}/${id}.webp`);
    if (result.error || !result.data) {
      console.warn("Memory photograph storage object was not readable.", result.error?.name);
      throw new HttpError(404, "Photograph not found.");
    }
    return new Response(result.data, { headers: { ...PRIVATE_HEADERS, "Content-Type": "image/webp", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  });
}

/** Authenticates a fixed username through its server-private email mapping and CAPTCHA. */
export async function loginPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const input = await readJson(request, loginSchema); const client = await serverClient();
    const email = input.username === "ruby" ? process.env.RUBY_AUTH_EMAIL : process.env.JAYATCI_AUTH_EMAIL;
    if (!email) throw new HttpError(503, "Sign-in is not configured.");
    const production = process.env.NODE_ENV === "production";
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
    const bypass = !production && local && process.env.ALLOW_LOCAL_CAPTCHA_BYPASS === "true";
    if (!bypass && (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || !input.captchaToken)) throw new HttpError(400, "Complete the sign-in verification.");
    const result = await client.auth.signInWithPassword({ email, password: input.password, options: { captchaToken: input.captchaToken } });
    if (result.error) throw new HttpError(401, "Sign-in failed. Check your details and try again.");
    const session = await editorSession(client);
    if (!session || session.username !== input.username) { await client.auth.signOut(); throw new HttpError(401, "Sign-in failed. Check your details and try again."); }
    return json({ session });
  });
}

/** Returns safe account state, never the authentication user or their email. */
export async function sessionGET() {
  return api(async () => {
    if (!connection()) return json({ session: null, configured: false, factors: [] });
    const client = await serverClient(); const session = await editorSession(client);
    if (!session) return json({ session: null, configured: true, factors: [] });
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw new HttpError(503, "Account verification is unavailable.");
    return json({ session, configured: true, factors: factors.data.totp.map(factor => ({ id: factor.id, friendlyName: factor.friendly_name || "Authenticator", status: factor.status })) });
  });
}

/** Clears the current caller's authentication session. */
export async function logoutPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); const result = await client.auth.signOut({ scope: "local" });
    if (result.error) throw new HttpError(503, "Sign-out is temporarily unavailable.");
    return json({ ok: true });
  });
}

/** Enrolls the caller's initial or replacement authenticator without exposing secrets elsewhere. */
export async function mfaEnrollPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); const session = await requireEditor(client, false);
    if (session.enrolled && !session.aal2) throw new HttpError(403, "Verify your current authenticator first.");
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw new HttpError(503, "Account verification is unavailable.");
    // A restarted enrollment replaces abandoned QR codes rather than exhausting the factor limit.
    for (const factor of factors.data.all.filter(factor => factor.factor_type === "totp" && factor.status === "unverified")) {
      const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw new HttpError(400, "Restarting authenticator setup failed. Try again.");
    }
    const result = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Notebook ${new Date().toISOString()}`, issuer: "All de bright places" });
    if (result.error) throw new HttpError(400, "An authenticator could not be added. Try again.");
    return json({ factorId: result.data.id, qrCode: result.data.totp.qr_code, secret: result.data.totp.secret });
  });
}

/** Verifies the caller's six-digit code and upgrades their cookie session to MFA. */
export async function mfaVerifyPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); await requireEditor(client, false);
    const input = await readJson(request, verifySchema);
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw new HttpError(503, "Account verification is unavailable.");
    const factorId = input.factorId || factors.data.totp.find(factor => factor.status === "verified")?.id;
    if (!factorId || !factors.data.all.some(factor => factor.factor_type === "totp" && factor.id === factorId)) throw new HttpError(400, "Choose your authenticator before verification.");
    const result = await client.auth.mfa.challengeAndVerify({ factorId, code: input.code });
    if (result.error) throw new HttpError(400, "That authenticator code could not be verified.");
    return json({ session: await requireEditor(client) });
  });
}

/** Updates a fully authenticated editor's password, including after MFA recovery. */
export async function passwordPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); await requireEditor(client);
    const input = await readJson(request, passwordSchema); const result = await client.auth.updateUser({ password: input.password });
    if (result.error) throw new HttpError(400, "The password could not be changed. Choose another password.");
    return json({ ok: true });
  });
}

/** Exchanges an owner-generated recovery token and verifies immutable editor membership. */
export async function recoveryPOST(request: Request) {
  return api(async () => {
    assertOrigin(request); const client = await serverClient(); const input = await readJson(request, recoverySchema);
    const result = await client.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
    if (result.error) throw new HttpError(400, "This recovery link is invalid or has expired.");
    const session = await editorSession(client);
    if (!session) { await client.auth.signOut(); throw new HttpError(403, "This recovery link is not permitted."); }
    return json({ session });
  });
}

/** Removes an owned authenticator only after another verified factor is available. */
export async function factorDELETE(request: Request, context: RouteContext) {
  return api(async () => {
    assertOrigin(request); const id = identifier((await context.params).id); const client = await serverClient(); await requireEditor(client);
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) throw new HttpError(503, "Authenticator management is unavailable.");
    const own = factors.data.totp.find(factor => factor.id === id);
    if (!own) throw new HttpError(404, "Authenticator not found.");
    if (!factors.data.totp.some(factor => factor.id !== id && factor.status === "verified")) throw new HttpError(400, "Verify a replacement authenticator before removing this one.");
    const result = await client.auth.mfa.unenroll({ factorId: id });
    if (result.error) throw new HttpError(400, "The authenticator could not be removed.");
    return json({ ok: true });
  });
}
