// Verifies request bounds, privacy-safe errors, and immutable editor authorization.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api, assertOrigin, databaseError, HttpError, readJson, readUpload } from "../src/utils/http";
import { editorSession, requireEditor } from "../src/services/auth";
import type { JournalClient } from "../src/config/supabase";

/** Builds a controlled provider double with a forged metadata username. */
function authClient(allowlisted: boolean, aal2: boolean) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: allowlisted ? { username: "ruby" } : null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "immutable-id", user_metadata: { username: "ruby" } } }, error: null }),
        mfa: {
          getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: aal2 ? "aal2" : "aal1" }, error: null }),
          listFactors: vi.fn().mockResolvedValue({ data: { totp: [{ status: "verified" }] }, error: null }),
        },
      },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    } as unknown as JournalClient, eq,
  };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("request security", () => {
  it("rejects missing and foreign origins, while accepting a configured canonical origin", () => {
    const url = "https://preview.example/api/goals";
    expect(() => assertOrigin(new Request(url))).toThrow(HttpError);
    expect(() => assertOrigin(new Request(url, { headers: { origin: "https://attacker.example" } }))).toThrow(HttpError);
    vi.stubEnv("SITE_URL", "https://journal.example");
    expect(() => assertOrigin(new Request(url, { headers: { origin: "https://journal.example" } }))).not.toThrow();
  });
  it("bounds streamed JSON rather than trusting a small declared length", async () => {
    const request = new Request("https://journal.example", { method: "POST", body: JSON.stringify({ note: "x".repeat(33_000) }), headers: { "content-type": "application/json", "content-length": "1" } });
    await expect(readJson(request, z.object({ note: z.string() }))).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed JSON and invalid input without exposing validation details", async () => {
    const request = new Request("https://journal.example", { method: "POST", body: "not-json", headers: { "content-type": "application/json" } });
    await expect(readJson(request, z.object({ note: z.string() }))).rejects.toMatchObject({ status: 400 });
  });
  it("bounds multipart bytes when no length header exists", async () => {
    const form = new FormData(); form.set("file", new Blob(["x".repeat(1024)]), "image.webp");
    await expect(readUpload(new Request("https://journal.example", { method: "POST", body: form }), 64)).rejects.toMatchObject({ status: 413 });
  });
  it("maps concurrency errors and hides provider diagnostics", async () => {
    expect(() => databaseError({ code: "P0001", message: "CONFLICT" })).toThrow("This entry changed.");
    const response = await api(async () => { throw new Error("SQL secret private-email@example.com"); });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("private-email");
  });
});

describe("editor authorization", () => {
  it("does not authorize forged metadata without the immutable user allowlist", async () => {
    const mock = authClient(false, true);
    expect(await editorSession(mock.client)).toBeNull();
    expect(mock.eq).toHaveBeenCalledWith("user_id", "immutable-id");
    await expect(requireEditor(mock.client)).rejects.toMatchObject({ status: 401 });
  });
  it("denies writes before MFA but permits initial authenticator setup", async () => {
    const { client } = authClient(true, false);
    await expect(requireEditor(client)).rejects.toMatchObject({ status: 403 });
    await expect(requireEditor(client, false)).resolves.toEqual({ username: "ruby", aal2: false, enrolled: true });
  });
  it("returns only the safe editor session after MFA", async () => {
    const { client } = authClient(true, true);
    expect(await requireEditor(client)).toEqual({ username: "ruby", aal2: true, enrolled: true });
  });
});
