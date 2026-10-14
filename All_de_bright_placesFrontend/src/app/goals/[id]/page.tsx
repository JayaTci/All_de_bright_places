// Routes a single dream while retaining backend-enforced visibility.
import { getJournal } from "@bright/backend/services/journal";
import { Journal } from "../../../components/journal";
export const dynamic = "force-dynamic";
/** Awaits the framework route parameters and passes authorized data to the view. */
export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Journal initial={await getJournal()} view="goal" goalId={id} />; }
