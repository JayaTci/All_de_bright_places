// Creates request-scoped Supabase clients without administrative credentials.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Reads public connection settings from the server environment. */
export function connection() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/** Creates a caller-scoped client; cookie writes are allowed in route handlers. */
export async function serverClient() {
  const config = connection();
  if (!config) throw new Error("SERVICE_UNAVAILABLE");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: values => {
        // Server components cannot write cookies; the session proxy refreshes them.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Read-only render. */ }
      },
    },
  });
}
export type JournalClient = Awaited<ReturnType<typeof serverClient>>;
