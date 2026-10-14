// Resolves verified editor identities and MFA status for each server request.
import "server-only";
import type { EditorSession, EditorUsername } from "@bright/shared";
import type { JournalClient } from "../config/supabase";
import { HttpError } from "../utils/http";

/** Verifies the Supabase user, database allowlist, and current assurance level. */
export async function editorSession(client: JournalClient): Promise<EditorSession | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const account = await client.from("editor_accounts").select("username").eq("user_id", data.user.id).maybeSingle();
  if (account.error || !account.data || !["ruby", "jayatci"].includes(account.data.username)) return null;
  const [assurance, factors] = await Promise.all([client.auth.mfa.getAuthenticatorAssuranceLevel(), client.auth.mfa.listFactors()]);
  if (assurance.error || factors.error) throw new HttpError(503, "Account verification is unavailable.");
  return { username: account.data.username as EditorUsername, aal2: assurance.data.currentLevel === "aal2", enrolled: factors.data.totp.some(factor => factor.status === "verified") };
}

/** Requires an allowlisted editor, optionally allowing their initial MFA setup. */
export async function requireEditor(client: JournalClient, requireMfa = true): Promise<EditorSession> {
  const session = await editorSession(client);
  if (!session) throw new HttpError(401, "Please sign in.");
  if (requireMfa && !session.aal2) throw new HttpError(403, "Verify your authenticator first.");
  return session;
}
