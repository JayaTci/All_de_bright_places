// Refreshes request-scoped sessions without using page redirects as authorization.
export { refreshSession as proxy } from "@bright/backend/middleware/session";
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"] };
