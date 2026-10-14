// Offers development-only public fixtures for visual review without granting editor access.
import { notFound } from "next/navigation";
import { Journal } from "../../components/journal";
import type { Goal } from "@bright/shared";
export const dynamic = "force-dynamic";
/** Supplies a read-only notebook preview and rejects every production request. */
export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  const titles = ["Watch the sunrise somewhere new", "Get lost in a city we’ve never been to", "Make pasta from scratch (and make a mess)", "Sleep under a sky full of stars", "Learn to say ‘I love you’ in five languages", "Take a photograph in every place we go", "Dance in the kitchen for no reason"];
  const categories: Goal["category"][] = ["Travel", "Travel", "Food", "Adventure", "Learning", "Creative", "Everyday"];
  const goals: Goal[] = titles.map((title, index) => ({ id: `preview-${index}`, title, description: "A little dream we’re making room for.", category: categories[index]!, visibility: "public", position: index, revision: 1, deletedAt: null, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", participants: [{ username: "ruby", completedOn: index === 2 || index === 6 ? "2026-10-13" : null }, { username: "jayatci", completedOn: index === 2 || index === 6 ? "2026-10-13" : null }], memories: [] }));
  return <Journal initial={{ goals, editor: null, configured: false, unavailable: false }} />;
}
