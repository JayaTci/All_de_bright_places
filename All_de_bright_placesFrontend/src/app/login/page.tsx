// Suspends query-dependent authentication UI for safe server rendering.
import { Suspense } from "react";
import { SignIn } from "../../components/auth";
/** Renders the username and authenticator flow. */
export default function Login() { return <Suspense fallback={<p className="loading-note">Opening our corner…</p>}><SignIn /></Suspense>; }
