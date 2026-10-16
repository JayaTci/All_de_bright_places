// Presents username sign-in, mandatory authenticator verification, and recovery flows.
"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { EditorSession } from "@bright/shared";
import { request } from "../services/api";
import { Frame } from "./frame";

declare global { interface Window { turnstile?: { render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string; remove: (id: string) => void } } }

/** Mounts Cloudflare's challenge explicitly and removes it when the form unmounts. */
function Challenge({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null); const [ready, setReady] = useState(false);
  useEffect(() => { if (!ready || !container.current || !window.turnstile || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return; const id = window.turnstile.render(container.current, { sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, callback: onToken, "expired-callback": () => onToken(""), "error-callback": () => onToken("") }); return () => window.turnstile?.remove(id); }, [ready, onToken]);
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} /><div ref={container} /></>;
}

/** Coordinates sign-in and authenticator enrollment through server-only authentication. */
export function SignIn() {
  const params = useSearchParams(); const [session, setSession] = useState<EditorSession | null>(null); const [username, setUsername] = useState("ruby"); const [password, setPassword] = useState(""); const [code, setCode] = useState(""); const [token, setToken] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null); const [configured, setConfigured] = useState(true); const [factors, setFactors] = useState<{ id: string; friendlyName?: string }[]>([]);
  useEffect(() => { void request<{ session: EditorSession | null; configured: boolean; factors?: { id: string; friendlyName?: string }[] }>("/api/auth/session", undefined, "GET").then(result => { setSession(result.session); setConfigured(result.configured); setFactors(result.factors || []); }).catch(() => setError("Sign-in could not connect. Please try again shortly.")); }, []);
  /** Signs in with a username and moves password-only sessions into the MFA step. */
  async function login() { setBusy(true); setError(""); try { const result = await request<{ session: EditorSession }>("/api/auth/login", { username, password, captchaToken: token }); setPassword(""); setSession(result.session); if (result.session.aal2) window.location.assign("/account"); } catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-in failed."); } finally { setBusy(false); } }
  /** Generates a temporary authenticator secret, displayed only in the active session. */
  async function enroll() { setBusy(true); setError(""); try { setEnrollment(await request("/api/auth/mfa/enroll")); } catch (failure) { setError(String(failure)); } finally { setBusy(false); } }
  /** Completes an MFA challenge and then loads the authorized account view. */
  async function verify() { setBusy(true); setError(""); try { await request("/api/auth/mfa/verify", { factorId: enrollment?.factorId, code }); setCode(""); window.location.assign("/account"); } catch (failure) { setError(failure instanceof Error ? failure.message : "Verification failed."); } finally { setBusy(false); } }
  return <Frame><section className="auth-page"><div className="auth-intro"><span className="eyebrow">JUST THE TWO OF US</span><h1>A key to<br />our little corner.</h1><p>A few pages are only ours.<br />Sign in to write the next one.</p><span className="auth-doodle" aria-hidden="true">♡</span></div><div className="auth-paper"><LockKeyhole size={26} strokeWidth={1.4} /><h2>{session ? "One more little step" : "Hello, you."}</h2>{!configured && <p role="status" className="service-banner">Our accounts are not set up yet. The public notebook is still open.</p>}{!session ? <form className="editor-form" onSubmit={event => { event.preventDefault(); void login(); }}><label>Your name<select autoComplete="username" value={username} onChange={event => setUsername(event.target.value)}><option value="ruby">Ruby</option><option value="jayatci">Jayatci</option></select></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>{process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && <Challenge onToken={setToken} />}<button className="button primary" disabled={busy || !configured || (!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !token)}>{busy ? "Opening…" : "Open our corner"}<ArrowRight size={16} /></button></form> : <><p>{session.enrolled ? "Enter the six-digit code from your authenticator." : "Set up your authenticator to keep our private pages safe."}</p>{(!session.enrolled || (session.aal2 && params?.get("manage") === "mfa")) && !enrollment && <button className="button primary" disabled={busy} onClick={() => void enroll()}>Set up an authenticator</button>}{enrollment && <div className="enrollment"><img src={enrollment.qrCode} width={190} height={190} alt="Scan this QR code with your authenticator app" /><label>Or enter this setup key<input readOnly value={enrollment.secret} /></label><p className="field-note">Keep this key private. It will disappear when you leave this page.</p></div>}{(session.enrolled || enrollment) && <form className="editor-form" onSubmit={event => { event.preventDefault(); void verify(); }}><label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label><button className="button primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : enrollment ? "Verify new authenticator" : "Verify and continue"}</button></form>}{session.aal2 && params?.get("manage") === "mfa" && factors.map(factor => <button key={factor.id} className="text-button" disabled={busy || factors.length < 2} onClick={async () => { setBusy(true); try { await request(`/api/auth/mfa/${factor.id}`, undefined, "DELETE"); setFactors(factors.filter(item => item.id !== factor.id)); } catch (failure) { setError(String(failure)); } finally { setBusy(false); } }}>Remove {factor.friendlyName || "previous authenticator"}</button>)}</>}{error && <p className="error" role="alert">{error}</p>}<p className="auth-help">Lost your password or phone? The project owner can help you recover your account.</p></div></section></Frame>;
}

/** Redeems owner-generated links before allowing a replacement password. */
export function Recovery() {
  const params = useSearchParams();
  const [verified, setVerified] = useState(false);
  const [linkVerified, setLinkVerified] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [needsEnrollment, setNeedsEnrollment] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);

  /** Resumes recovery after a redeemed link without requesting the one-time token again. */
  async function loadSession() {
    const result = await request<{ session: EditorSession | null }>("/api/auth/session", undefined, "GET");
    if (!result.session) throw new Error("Your recovery session could not be opened. Please try again.");
    setSessionReady(true);
    if (result.session.aal2) setVerified(true);
    else if (!result.session.enrolled) {
      setNeedsEnrollment(true);
      setEnrollment(await request("/api/auth/mfa/enroll"));
    }
  }

  /** Redeems the URL once, then removes its token before checking MFA state. */
  async function verifyLink() {
    setBusy(true); setMessage("");
    try {
      const tokenHash = params?.get("token_hash");
      const type = params?.get("type");
      if (!tokenHash || !["recovery", "invite"].includes(type || "")) throw new Error("This recovery link is incomplete. Ask the owner for a new one.");
      await request("/api/auth/recovery", { tokenHash, type });
      setLinkVerified(true);
      window.history.replaceState({}, "", "/auth/recovery");
      await loadSession();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "This link could not be verified."); }
    finally { setBusy(false); }
  }

  /** Retries the step that failed after a valid recovery link was redeemed. */
  async function retryRecovery() {
    setBusy(true); setMessage("");
    try {
      if (!sessionReady) await loadSession();
      else if (needsEnrollment) setEnrollment(await request("/api/auth/mfa/enroll"));
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Recovery could not continue. Please try again."); }
    finally { setBusy(false); }
  }

  /** Requires an authenticator challenge before exposing the password replacement step. */
  async function verifyAuthenticator() {
    setBusy(true); setMessage("");
    try { await request("/api/auth/mfa/verify", { factorId: enrollment?.factorId, code }); setCode(""); setVerified(true); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : "Verification failed."); }
    finally { setBusy(false); }
  }

  /** Changes the recovered password and clears the recovery page through sign-in. */
  async function save() {
    setBusy(true); setMessage("");
    try { await request("/api/auth/password", { password }); setPassword(""); window.location.assign("/login"); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : "The password could not be changed."); }
    finally { setBusy(false); }
  }

  return <Frame><section className="recovery-page auth-paper">
    <h1>A fresh little start.</h1><p>Your private pages are waiting for you.</p>
    {!linkVerified ? <button className="button primary" disabled={busy} onClick={() => void verifyLink()}>Verify recovery link</button>
      : !sessionReady ? <button className="button primary" disabled={busy} onClick={() => void retryRecovery()}>Continue recovery</button>
      : !verified ? <>
        <p>Verify your authenticator before choosing a new password.</p>
        {needsEnrollment && !enrollment && <button className="button primary" disabled={busy} onClick={() => void retryRecovery()}>Set up an authenticator</button>}
        {enrollment && <div className="enrollment"><img src={enrollment.qrCode} width={190} height={190} alt="Scan with your authenticator app" /><label>Setup key<input readOnly value={enrollment.secret} /></label></div>}
        {(!needsEnrollment || enrollment) && <form className="editor-form" onSubmit={event => { event.preventDefault(); void verifyAuthenticator(); }}><label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label><button className="button primary" disabled={busy || code.length !== 6}>Verify authenticator</button></form>}
      </> : <form className="editor-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} /></label><button className="button primary" disabled={busy}>Set password and continue</button></form>}
    {message && <p role="alert" className="error">{message}</p>}
  </section></Frame>;
}