// Fetches the visible journal and converts database rows into safe shared DTOs.
import "server-only";
import type { Category, EditorUsername, Goal, HistoryEntry, JournalData, Visibility } from "@bright/shared";
import { connection, serverClient } from "../config/supabase";
import { editorSession } from "./auth";
import { getProfiles } from "./profiles";

interface PhotoRow { id: string; memory_id: string; caption: string; width: number; height: number; ready: boolean }
interface MemoryRow { id: string; goal_id: string; author: EditorUsername; occurred_on: string; note: string; revision: number; created_at: string; deleted_at: string | null; photos: PhotoRow[] }
interface GoalRow { id: string; title: string; description: string; category: Category; visibility: Visibility; position: number; revision: number; deleted_at: string | null; created_at: string; updated_at: string; goal_participants: { username: EditorUsername; completed_on: string | null }[]; memories: MemoryRow[] }
export type JournalScope = { view: "notebook" | "memories" | "account" } | { view: "goal"; goalId: string };

/** Converts nested rows without exposing storage paths or authentication identifiers. */
export function mapGoal(row: GoalRow): Goal {
  return {
    id: row.id, title: row.title, description: row.description, category: row.category, visibility: row.visibility,
    position: row.position, revision: row.revision, deletedAt: row.deleted_at, createdAt: row.created_at, updatedAt: row.updated_at,
    participants: (row.goal_participants || []).map(p => ({ username: p.username, completedOn: p.completed_on })),
    memories: (row.memories || []).filter(m => !m.deleted_at).map(m => ({
      id: m.id, goalId: m.goal_id, author: m.author, occurredOn: m.occurred_on, note: m.note, revision: m.revision, createdAt: m.created_at,
      photos: (m.photos || []).filter(p => p.ready).map(p => ({ id: p.id, memoryId: p.memory_id, caption: p.caption, width: p.width, height: p.height })),
    })).sort((a: { occurredOn: string }, b: { occurredOn: string }) => b.occurredOn.localeCompare(a.occurredOn)),
  };
}

/**
 * Reads only the current page's authorized journal data under caller RLS.
 * @param scope - The page and optional goal identifier being displayed.
 * @returns Visible goals and the profiles needed by this page, or an outage state.
 */
export async function getJournal(scope: JournalScope = { view: "notebook" }): Promise<JournalData> {
  if (!connection()) return { goals: [], profiles: [], editor: null, configured: false, unavailable: false };
  try {
    const client = await serverClient(); const session = await editorSession(client);
    const editor = session?.aal2 ? session.username : null;
    if (scope.view === "account" && !editor) return { goals: [], profiles: [], editor, configured: true, unavailable: false };
    let query = client.from("goals").select("*,goal_participants(*),memories(*,photos(*))").order("position");
    if (!editor) query = query.eq("visibility", "public").is("deleted_at", null);
    else if (scope.view === "account") query = query.not("deleted_at", "is", null);
    else query = query.is("deleted_at", null);
    if (scope.view === "goal") query = query.eq("id", scope.goalId);
    const profilesPromise = scope.view === "notebook" || scope.view === "account" ? getProfiles(client, Boolean(editor)).catch(() => []) : Promise.resolve([]);
    const [result, profiles] = await Promise.all([query, profilesPromise]);
    if (result.error) return { goals: [], profiles: [], editor, configured: true, unavailable: true };
    const goals = (result.data || []).map(mapGoal);
    return { goals, profiles, editor, configured: true, unavailable: false };
  } catch { return { goals: [], profiles: [], editor: null, configured: true, unavailable: true }; }
}

/**
 * Reads editor history with one identity check and no unrelated journal query.
 * @returns The editor and up to 100 entries, or null for an unverified viewer.
 * @throws If the database or account verification is unavailable.
 */
export async function getHistory(): Promise<{ editor: EditorUsername; entries: HistoryEntry[] } | null> {
  if (!connection()) return null;
  const client = await serverClient();
  const session = await editorSession(client);
  if (!session?.aal2) return null;
  const result = await client.from("editor_history").select("id,actor,goal_title,summary,changed_at").order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(100);
  if (result.error) throw new Error("HISTORY_UNAVAILABLE");
  return { editor: session.username, entries: (result.data || []).map(entry => ({ id: entry.id, actor: entry.actor as EditorUsername, goalTitle: entry.goal_title, summary: entry.summary, changedAt: entry.changed_at })) };
}
