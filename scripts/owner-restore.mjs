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
// Change history has no child references, so target-generated IDs can preserve its original order.
const history = snapshot.tables.editor_history ?? [];
const existingHistory = [];
for (let offset = 0; ; offset += 500) {
  const page = await ownerRequest(`/rest/v1/editor_history?select=actor,goal_title,summary,changed_at&order=id&limit=500&offset=${offset}`);
  existingHistory.push(...page);
  if (page.length < 500) break;
}
if (existingHistory.length && !process.argv.includes('--resume')) throw new Error('Target contains change history. Use a fresh target or --resume for this same interrupted restore.');
if (existingHistory.some((row, index) => !history[index] || ['actor', 'goal_title', 'summary', 'changed_at'].some(field => row[field] !== history[index][field]))) {
  throw new Error('Target change history does not match the backup prefix. Use a fresh target.');
}
for (let offset = existingHistory.length; offset < history.length; offset += 100) {
  const batch = history.slice(offset, offset + 100).map(row => ({ actor: row.actor, goal_title: row.goal_title, summary: row.summary, changed_at: row.changed_at }));
  await ownerRequest('/rest/v1/editor_history', { method: 'POST', body: JSON.stringify(batch) });
}
console.log('Content restoration complete. Verify row counts and representative public and private photographs before using the target.');
