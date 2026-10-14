// Refreshes Supabase cookies through the thin Next.js frontend session proxy.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { connection } from "../config/supabase";

/** Refreshes caller cookies on request and response; never reads journal data. */
export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request }); const config = connection();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: values => {
      values.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
  } });
  try { await client.auth.getUser(); } catch { /* The UI exposes service availability. */ }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
