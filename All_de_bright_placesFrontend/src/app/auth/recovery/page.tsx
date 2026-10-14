// Provides the owner-assisted account recovery entrypoint.
import { Suspense } from "react";
import { Recovery } from "../../../components/auth";
/** Renders recovery without exposing URL tokens to server logs or page copy. */
export default function RecoveryPage() { return <Suspense fallback={<p className="loading-note">Opening a fresh page…</p>}><Recovery /></Suspense>; }
