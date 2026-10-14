// Supplies local-only administrative HTTP calls without printing secrets or error payloads.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const url = process.env.OWNER_SUPABASE_URL;
const key = process.env.OWNER_SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set OWNER_SUPABASE_URL and OWNER_SUPABASE_SECRET_KEY in this local shell.');
if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1):/.test(url)) throw new Error('Use HTTPS or local Supabase.');
/** Makes an owner request. Inputs are service path and fetch options. Returns parsed data or bytes. Uses the local admin key and throws sanitized failures. */
export async function ownerRequest(path, options = {}, binary = false) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) throw new Error(`Owner request failed (${response.status}). Check configuration and access privately.`);
  if (binary) return Buffer.from(await response.arrayBuffer());
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
/** Writes private owner output under ignored _workspace. Returns absolute path. Creates restricted files and never prints their contents. */
export async function privateOutput(name, content) {
  const directory = resolve('_workspace/owner');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, name);
  await writeFile(path, content, { mode: 0o600, flag: 'wx' });
  return path;
}
