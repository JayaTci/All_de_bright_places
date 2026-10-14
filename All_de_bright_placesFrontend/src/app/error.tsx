// Presents recoverable rendering failures without exposing backend details.
"use client";
/** Lets a visitor retry the failed route while keeping error details private. */
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="empty-state"><h1>This page needs a moment.</h1><p>Please try opening it again.</p><button className="button" onClick={reset}>Try again</button></section>; }
