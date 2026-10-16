// Loads the visitor or editor notebook from authorized backend services.
import { getJournal } from "@bright/backend/services/journal";
import { Journal } from "../components/journal";
export const dynamic = "force-dynamic";
/** Renders only the goals authorized for the current server session. */
export default async function Home() { return <Journal initial={await getJournal({ view: "notebook" })} />; }
