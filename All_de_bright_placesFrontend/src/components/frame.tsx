// Provides the shared notebook header, navigation, and footer without loading editor controls.
import Link from "next/link";
import { LockKeyhole, Sun } from "lucide-react";
import type { ReactNode } from "react";

/** Shows the active route and keeps the page content reachable by keyboard. */
export function Frame({ children, active, editor }: { children: ReactNode; active?: "notebook" | "memories" | "history" | "account"; editor?: string | null }) {
  return <div className="site-frame"><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><Link href="/" className="brand" aria-label="All de bright places home"><Sun size={31} strokeWidth={1.4} /><span>all de bright places<span className="brand-caption">a notebook for two</span></span></Link><nav aria-label="Main navigation"><Link className={active === "notebook" ? "active" : ""} aria-current={active === "notebook" ? "page" : undefined} href="/">The list</Link><Link className={active === "memories" ? "active" : ""} aria-current={active === "memories" ? "page" : undefined} href="/memories">Our memories</Link>{editor && <Link className={active === "history" ? "active" : ""} aria-current={active === "history" ? "page" : undefined} href="/history">Our changes</Link>}<Link className="account-link" aria-current={active === "account" ? "page" : undefined} href={editor ? "/account" : "/login"}><LockKeyhole size={14} /><span>{editor ? "Our corner" : "Just us"}</span></Link></nav></header><main id="main">{children}</main><footer className="site-footer"><span><Sun size={16} /> made for the days we’ll remember.</span><span>Ruby &amp; Jayatci <span className="footer-dot">·</span> a life, in little moments</span></footer></div>;
}
