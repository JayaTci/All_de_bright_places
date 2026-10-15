// Verifies profile image normalization, visibility mapping, and owner-only API writes.
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn(), requireEditor: vi.fn() }));
vi.mock("../src/config/supabase", () => ({ serverClient: mocks.client }));
vi.mock("../src/services/auth", () => ({ editorSession: mocks.session, requireEditor: mocks.requireEditor }));
import { cleanProfilePictureObjects, mapProfile, normalizeProfilePicture } from "../src/services/profiles";
import { profilePATCH, profilePicturePOST } from "../src/routes/handlers";
import { HttpError } from "../src/utils/http";

afterEach(() => vi.resetAllMocks());

describe("editor profiles", () => {
  it("exposes a public picture to visitors and hides a Friends picture until MFA", () => {
    const base = { username: "ruby" as const, bio: "Hello", picture_id: "11111111-1111-4111-8111-111111111111" };
    const publicProfile = mapProfile({ ...base, picture_visibility: "public" }, false);
    const privateProfile = mapProfile({ ...base, picture_visibility: "friends" }, false);
    const editorProfile = mapProfile({ ...base, picture_visibility: "friends" }, true);
    expect(publicProfile.pictureUrl).toContain("/api/profiles/ruby/picture");
    expect(privateProfile.pictureUrl).toBeNull(); expect(privateProfile.pictureVersion).toBeNull();
    expect(editorProfile.pictureUrl).toContain("/api/profiles/ruby/picture");
    expect(JSON.stringify(privateProfile)).not.toContain(base.picture_id);
  });

  it("produces a square metadata-free WebP and rejects unsupported formats", async () => {
    const input = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#d0a070" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const picture = await normalizeProfilePicture(input);
    const metadata = await sharp(picture).metadata();
    expect(metadata.format).toBe("webp"); expect(metadata.width).toBe(512); expect(metadata.height).toBe(512);
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    await expect(normalizeProfilePicture(new TextEncoder().encode("<svg></svg>"))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a cross-profile PATCH before any database mutation", async () => {
    const rpc = vi.fn(); mocks.client.mockResolvedValue({ rpc });
    mocks.requireEditor.mockResolvedValue({ username: "jayatci", aal2: true });
    const request = new Request("http://localhost:3000/api/profiles/ruby", { method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ bio: "Hi", pictureVisibility: "friends" }) });
    const response = await profilePATCH(request, { params: Promise.resolve({ username: "ruby" }) });
    expect(response.status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a password-only upload before parsing picture bytes", async () => {
    const rpc = vi.fn(); mocks.client.mockResolvedValue({ rpc });
    mocks.requireEditor.mockRejectedValue(new HttpError(403, "Verify your authenticator first."));
    const request = new Request("http://localhost:3000/api/profiles/ruby/picture", { method: "POST", headers: { origin: "http://localhost:3000" }, body: new FormData() });
    const response = await profilePicturePOST(request, { params: Promise.resolve({ username: "ruby" }) });
    expect(response.status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves a concurrent upload reservation and its object", async () => {
    const remove = vi.fn(); const rpc = vi.fn().mockResolvedValue({ data: [{ pending_id: "11111111-1111-4111-8111-111111111111", pending_at: new Date().toISOString(), stale_id: null }], error: null });
    await cleanProfilePictureObjects({ rpc, storage: { from: () => ({ remove }) } } as never, "ruby");
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
