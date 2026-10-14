// Exposes account tools only when the journal service grants an MFA editor session.
import { getJournal } from "@bright/backend/services/journal";
import { Journal } from "../../components/journal";
export const dynamic = "force-dynamic";
/** Renders account and Trash tools using server-confirmed editor identity. */
export default async function Account() { return <Journal initial={await getJournal()} view="account" />; }
