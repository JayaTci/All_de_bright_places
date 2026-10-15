// Exports journal and profile rows plus published image bytes into ignored local owner storage.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ownerRequest } from './owner-client.mjs';
const tables = ['editor_accounts', 'goals', 'goal_participants', 'memories', 'photos', 'editor_history', 'editor_profiles'];
const directory = resolve('_workspace/owner', `backup-${Date.now()}`);
await mkdir(resolve(directory, 'objects'), { recursive: true });
const snapshot = { format: 1, capturedAt: new Date().toISOString(), tables: {} };
for (const table of tables) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const columns = table === 'editor_profiles' ? 'username,bio,picture_visibility,picture_id,updated_at' : '*';
    const order = ['editor_accounts', 'editor_profiles'].includes(table) ? 'username' : table === 'goal_participants' ? 'goal_id,username' : 'id';
    const page = await ownerRequest(`/rest/v1/${table}?select=${columns}&order=${order}&limit=500&offset=${offset}`);
    rows.push(...page);
    if (page.length < 500) break;
  }
  snapshot.tables[table] = rows;
}
for (const photo of snapshot.tables.photos) {
  if (!photo.ready) continue;
  for (const variant of ['display', 'thumbnail']) {
    const bytes = await ownerRequest(`/storage/v1/object/authenticated/journal-photos/${variant}/${photo.id}.webp`, {}, true);
    await writeFile(resolve(directory, 'objects', `${variant}-${photo.id}.webp`), bytes, { mode: 0o600 });
  }
}
for (const profile of snapshot.tables.editor_profiles) {
  if (!profile.picture_id) continue;
  const bytes = await ownerRequest(`/storage/v1/object/authenticated/profile-pictures/${profile.username}/${profile.picture_id}.webp`, {}, true);
  await writeFile(resolve(directory, 'objects', `profile-${profile.username}-${profile.picture_id}.webp`), bytes, { mode: 0o600 });
}
await writeFile(resolve(directory, 'journal.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
console.log(`Backup saved privately to ${directory}. Keep editors idle during capture and store an encrypted copy separately.`);
