// Renders the private change history for the two allowlisted journal editors.
import { getHistory } from "@bright/backend/services/journal";
import { redirect } from "next/navigation";
import { Frame } from "../../components/frame";
import styles from "./history.module.css";

export const dynamic = "force-dynamic";

/**
 * Confirms MFA editor identity before reading and rendering the private audit feed.
 * @returns A server-rendered history page for an authorized editor.
 * @throws Redirects unauthenticated and non-editor visitors to sign-in.
 */
export default async function HistoryPage() {
  const history = await getHistory();
  if (!history) redirect("/login");
  return <Frame active="history" editor={history.editor}><section className={styles.page}><span className="eyebrow">JUST BETWEEN US</span><h1>Our changes.</h1><p className="section-intro">A quiet record of the things Ruby and Jayatci have added, changed, and remembered.</p>{history.entries.length ? <ol className={styles.list}>{history.entries.map(entry => <li className={styles.entry} key={entry.id}><div><span className={styles.actor}>{entry.actor}</span><span className={styles.summary}>{entry.summary}</span><span className={styles.goal}>{entry.goalTitle}</span></div><time dateTime={entry.changedAt}>{new Date(entry.changedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ol> : <div className="empty-state"><h2>No changes yet.</h2><p>New notes will find their way here.</p></div>}</section></Frame>;
}
