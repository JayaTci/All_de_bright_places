// Keeps navigation feedback readable while the backend loads a notebook page.
/** Announces pending navigation without simulating loaded content. */
export default function Loading() { return <p className="loading-note" role="status">Turning the page…</p>; }
