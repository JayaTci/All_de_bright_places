// Routes a single dream while retaining backend-enforced visibility.
import { getJournal } from "@bright/backend/services/journal";
import { notFound } from "next/navigation";
import { Journal } from "../../../components/journal";
export const dynamic = "force-dynamic";
/** Awaits the framework route parameters and passes authorized data to the view. */
export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) notFound(); return <Journal initial={await getJournal({ view: "goal", goalId: id })} view="goal" goalId={id} />; }
