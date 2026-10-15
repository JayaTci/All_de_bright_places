// Validates every journal mutation before it reaches backend services.
import { z } from "zod";
import { CATEGORIES, EDITORS } from "../constants/journal";

export const usernameSchema = z.enum(EDITORS);
export const profileInputSchema = z.object({ bio: z.string().trim().max(240), pictureVisibility: z.enum(["public", "friends"]) });
export const dateSchema = z.iso.date();
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(160), description: z.string().trim().max(4000),
  category: z.enum(CATEGORIES), visibility: z.enum(["public", "private"]),
  participants: z.array(usernameSchema).min(1).max(2).refine(values => new Set(values).size === values.length, "Choose each person once."),
});
const revisionSchema = z.number().int().positive();
export const goalMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), revision: revisionSchema, input: goalInputSchema }),
  z.object({ action: z.literal("complete"), revision: revisionSchema, username: usernameSchema, completedOn: dateSchema.nullable() }),
  z.object({ action: z.literal("trash"), revision: revisionSchema }),
  z.object({ action: z.literal("restore"), revision: revisionSchema }),
  z.object({ action: z.literal("move"), revision: revisionSchema, direction: z.enum(["up", "down"]) }),
]);
export const memoryInputSchema = z.object({ goalId: z.uuid(), occurredOn: dateSchema, note: z.string().trim().min(1).max(4000) });
export const memoryMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), revision: revisionSchema, occurredOn: dateSchema, note: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("delete"), revision: revisionSchema }),
]);
export const loginSchema = z.object({ username: z.string().trim().toLowerCase().pipe(usernameSchema), password: z.string().min(1).max(128), captchaToken: z.string().max(4096).optional() });
