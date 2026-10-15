// Defines local font loading and search-index exclusions for the notebook.
import type { Metadata } from "next";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/600.css";
import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/600.css";
import "./globals.css";
import "./notebook-polish.css";
export const metadata: Metadata = { title: { default: "All de bright places", template: "%s | All de bright places" }, description: "A notebook for two. Places to go, things to try, little moments to keep.", robots: { index: false, follow: false } };
/** Wraps all routes in a language-labeled document using locally packaged fonts. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
