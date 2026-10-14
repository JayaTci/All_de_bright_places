// Calculates completion from the assigned participants, never from hidden goals.
import type { Goal } from "../types/journal";

// Returns true when every assigned participant has a completion date.
export function isGoalComplete(goal: Goal): boolean {
  return goal.participants.length > 0 && goal.participants.every(person => person.completedOn !== null);
}

// Counts completed goals within the supplied visible, active collection.
export function getProgress(goals: Goal[]) {
  const active = goals.filter(goal => !goal.deletedAt);
  const completed = active.filter(isGoalComplete).length;
  return { total: active.length, completed, percent: active.length ? Math.round(completed / active.length * 100) : 0 };
}
