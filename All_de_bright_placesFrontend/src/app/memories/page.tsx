// Loads the photograph journal through the same visibility checks as the notebook.
import { getJournal } from "@bright/backend/services/journal";
import { Journal } from "../../components/journal";
export const dynamic = "force-dynamic";
/** Presents dated memories that belong to visible, active goals. */
export default async function Memories() { return <Journal initial={await getJournal()} view="memories" />; }
