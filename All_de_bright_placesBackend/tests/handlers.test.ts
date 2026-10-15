// Exercises API fail-closed behavior without real accounts or credentials.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), connection: vi.fn(), session: vi.fn(), requireEditor: vi.fn() }));
vi.mock("../src/config/supabase", () => ({ serverClient: mocks.client, connection: mocks.connection }));
vi.mock("../src/services/auth", () => ({ editorSession: mocks.session, requireEditor: mocks.requireEditor }));
import { getJournal, mapGoal } from "../src/services/journal";
import { goalsPOST, loginPOST, sessionGET, mfaVerifyPOST, factorDELETE } from "../src/routes/handlers";
import { HttpError } from "../src/utils/http";

/** Creates same-origin JSON mutation requests for security scenarios. */
function request(path: string, body: unknown) {
  return new Request(`http://localhost:3000/api/${path}`, { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("API failure states", () => {
  it("exposes a configured-false empty journal and no fake session", async () => {
    mocks.connection.mockReturnValue(null);
    expect(await getJournal()).toEqual({ goals: [], profiles: [], editor: null, configured: false, unavailable: false });
    const response = await sessionGET();
    expect(await response.json()).toEqual({ session: null, configured: false, factors: [] });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("returns sanitized unavailable responses when cookie/provider setup fails", async () => {
    mocks.connection.mockReturnValue({ url: "https://service.example", key: "public" });
    mocks.client.mockRejectedValue(new Error("cookie secret"));
    const response = await sessionGET();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
  it("keeps loaded journal goals when profile reads fail", async () => {
    mocks.connection.mockReturnValue({ url: "https://service.example", key: "public" }); mocks.session.mockResolvedValue(null);
    const row = { id: "goal", title: "Visible", description: "", category: "Travel", visibility: "public", position: 1, revision: 1,
      deleted_at: null, created_at: "2026-10-14", updated_at: "2026-10-14", goal_participants: [], memories: [] };
    const goalQuery = { select: () => ({ order: () => ({ eq: () => ({ is: async () => ({ data: [row], error: null }) }) }) }) };
    const profileQuery = { select: () => ({ in: async () => ({ data: null, error: { code: "SERVICE_FAILURE" } }) }) };
    mocks.client.mockResolvedValue({ from: (table: string) => table === "goals" ? goalQuery : profileQuery });
    const journal = await getJournal();
    expect(journal.goals).toHaveLength(1); expect(journal.goals[0].title).toBe("Visible");
    expect(journal.profiles).toEqual([]); expect(journal.unavailable).toBe(false);
  });
  it("never publishes unfinished photographs or deleted memory contents in DTOs", () => {
    const mapped = mapGoal({
      id: "goal", title: "Travel", description: "", category: "Travel", visibility: "public", position: 1, revision: 1,
      deleted_at: null, created_at: "2026-10-14", updated_at: "2026-10-14", goal_participants: [{ username: "ruby", completed_on: null }],
      memories: [{ id: "memory", goal_id: "goal", author: "ruby", occurred_on: "2026-10-14", note: "A memory", revision: 1, created_at: "2026-10-14", deleted_at: null,
        photos: [{ id: "ready", memory_id: "memory", caption: "Visible", width: 10, height: 10, ready: true }, { id: "pending", memory_id: "memory", caption: "Hidden", width: 0, height: 0, ready: false }] },
        { id: "deleted", goal_id: "goal", author: "ruby", occurred_on: "2026-10-14", note: "Deleted note", revision: 1, created_at: "2026-10-14", deleted_at: "2026-10-14", photos: [] }],
    });
    expect(mapped.memories).toHaveLength(1); expect(mapped.memories[0].photos.map(photo => photo.id)).toEqual(["ready"]);
    expect(JSON.stringify(mapped)).not.toContain("Deleted note"); expect(JSON.stringify(mapped)).not.toContain("pending");
  });
  it("denies a mutation before RPC execution without MFA", async () => {
    const rpc = vi.fn(); mocks.client.mockResolvedValue({ rpc }); mocks.requireEditor.mockRejectedValue(new HttpError(403, "Verify your authenticator first."));
    const response = await goalsPOST(request("goals", {}));
    expect(response.status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it("validates goal fields before sending a database mutation", async () => {
    const rpc = vi.fn(); mocks.client.mockResolvedValue({ rpc }); mocks.requireEditor.mockResolvedValue({ username: "ruby", aal2: true });
    const response = await goalsPOST(request("goals", { title: "" }));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed without CAPTCHA configuration in production despite a bypass flag", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ALLOW_LOCAL_CAPTCHA_BYPASS", "true"); vi.stubEnv("RUBY_AUTH_EMAIL", "private@example.com"); vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const signInWithPassword = vi.fn(); mocks.client.mockResolvedValue({ auth: { signInWithPassword } });
    const response = await loginPOST(request("auth/login", { username: "ruby", password: "password" }));
    expect(response.status).toBe(400); expect(signInWithPassword).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private@example.com");
  });
  it("never permits verification of a factor belonging to another user", async () => {
    const challengeAndVerify = vi.fn(); mocks.client.mockResolvedValue({ auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [], all: [] }, error: null }), challengeAndVerify } } });
    mocks.requireEditor.mockResolvedValue({ username: "ruby", aal2: false });
    const response = await mfaVerifyPOST(request("auth/mfa/verify", { factorId: "11111111-1111-4111-8111-111111111111", code: "123456" }));
    expect(response.status).toBe(400); expect(challengeAndVerify).not.toHaveBeenCalled();
  });
  it("rejects removing the last verified authenticator", async () => {
    const id = "11111111-1111-4111-8111-111111111111"; const unenroll = vi.fn();
    mocks.client.mockResolvedValue({ auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [{ id, status: "verified" }] }, error: null }), unenroll } } });
    mocks.requireEditor.mockResolvedValue({ username: "ruby", aal2: true });
    const response = await factorDELETE(request("auth/factors", {}), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400); expect(unenroll).not.toHaveBeenCalled();
  });
  it("verifies a newly enrolled factor from all factors rather than verified-only TOTP", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const challengeAndVerify = vi.fn().mockResolvedValue({ error: null });
    mocks.client.mockResolvedValue({ auth: { mfa: { listFactors: vi.fn().mockResolvedValue({ data: { totp: [], all: [{ id, status: "unverified", factor_type: "totp" }] }, error: null }), challengeAndVerify } } });
    mocks.requireEditor.mockResolvedValueOnce({ username: "ruby", aal2: false }).mockResolvedValueOnce({ username: "ruby", aal2: true, enrolled: true });
    const response = await mfaVerifyPOST(request("auth/mfa/verify", { factorId: id, code: "123456" }));
    expect(response.status).toBe(200); expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: id, code: "123456" });
  });
});
