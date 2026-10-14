// Defines the public journal contract without authentication emails or credentials.
export type EditorUsername = "ruby" | "jayatci";
export type Visibility = "public" | "private";
export type Category = "Travel" | "Adventure" | "Food" | "Learning" | "Creative" | "Everyday" | "Other";
export interface GoalParticipant { username: EditorUsername; completedOn: string | null }
export interface Photo { id: string; memoryId: string; caption: string; width: number; height: number }
export interface Memory { id: string; goalId: string; author: EditorUsername; occurredOn: string; note: string; revision: number; createdAt: string; photos: Photo[] }
export interface Goal {
  id: string; title: string; description: string; category: Category; visibility: Visibility;
  position: number; revision: number; deletedAt: string | null; createdAt: string; updatedAt: string;
  participants: GoalParticipant[]; memories: Memory[];
}
export interface EditorSession { username: EditorUsername; aal2: boolean; enrolled: boolean }
export interface HistoryEntry { id: number; actor: EditorUsername; goalTitle: string; summary: string; changedAt: string }
export interface JournalData { goals: Goal[]; editor: EditorUsername | null; configured: boolean; unavailable: boolean }
export interface GoalInput { title: string; description: string; category: Category; visibility: Visibility; participants: EditorUsername[] }
export interface ApiError { error: string; code?: string }
