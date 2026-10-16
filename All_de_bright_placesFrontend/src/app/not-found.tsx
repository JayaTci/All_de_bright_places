// Provides a quiet recovery path for unavailable routes.
import Link from "next/link";
import { Frame } from "../components/frame";
/** Renders a missing page message without leaking private goal existence. */
export default function NotFound() { return <Frame><section className="empty-state"><h1>A page we haven’t written.</h1><p>Let’s find our way back to the notebook.</p><Link href="/" className="button">Back to our list</Link></section></Frame>; }
