// Provides same-origin requests that preserve server authorization and actionable errors.
export class ApiFailure extends Error {
  constructor(message: string, public status: number) { super(message); }
}
/** Sends a journal request and exposes failures without losing the caller's draft. */
export async function request<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new ApiFailure(response.status === 409 ? "This entry changed while you were editing. Your draft is safe. Reload the journal and review it before saving again." : data.error || "We could not save this. Please try again.", response.status);
  return data as T;
}
