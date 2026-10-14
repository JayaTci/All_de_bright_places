// Restores content to an explicitly selected empty target after owner account provisioning.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ownerRequest, url } from './owner-client.mjs';
const directory = process.argv[2];
if (!directory || process.env.OWNER_RESTORE_CONFIRM_URL !== url) throw new Error('Supply a backup folder and set OWNER_RESTORE_CONFIRM_URL exactly to the target URL.');
const snapshot = JSON.parse(await readFile(resolve(directory, 'journal.json'), 'utf8'));
if (snapshot.format !== 1) throw new Error('Unsupported backup format.');
const accounts = await ownerRequest('/rest/v1/editor_accounts?select=username,user_id');
if (!['ruby', 'jayatci'].every(username => accounts.some(account => account.username === username))) throw new Error('Provision both target accounts before restoration.');
const rows = await ownerRequest('/rest/v1/goals?select=id&limit=1');
if (rows.length && !process.argv.includes('--resume')) throw new Error('Target contains journal content. Use a fresh target or --resume for this same interrupted restore.');
for (const table of ['goals', 'goal_participants', 'memories', 'photos']) {
  const records = snapshot.tables[table];
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100).map(row => table === 'photos' ? { ...row, ready: false } : row);
    await ownerRequest(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(batch) });
  }
}
for (const photo of snapshot.tables.photos) {
  if (!photo.ready) continue;
  for (const variant of ['display', 'thumbnail']) {
    const bytes = await readFile(resolve(directory, 'objects', `${variant}-${photo.id}.webp`));
    await ownerRequest(`/storage/v1/object/journal-photos/${variant}/${photo.id}.webp`, { method: 'POST', headers: { 'Content-Type': 'image/webp', 'x-upsert': 'true' }, body: bytes });
  }
  await ownerRequest(`/rest/v1/photos?id=eq.${photo.id}`, { method: 'PATCH', body: JSON.stringify({ ready: true }) });
}
console.log('Content restoration complete. Verify row counts and representative public and private photographs before using the target.');
