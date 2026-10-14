// Verifies owner backup and restore behavior against a local HTTP fixture without production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
const execute = promisify(execFile);
const project = resolve('.');

test('backup exports photo bytes and restore publishes only after both variants arrive',
  /** Creates a disposable API fixture. Runs owner scripts as child processes, checks output ordering and bytes, and removes local test artifacts. */
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bright-owner-test-'));
    const photoId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const photoBytes = Buffer.from('fixture-webp-bytes');
    const tables = {
      editor_accounts: [{ user_id: 'original-ruby', username: 'ruby' }, { user_id: 'original-jayatci', username: 'jayatci' }],
      goals: [{ id: 'goal', title: 'Private', visibility: 'private' }],
      goal_participants: [{ goal_id: 'goal', username: 'ruby', completed_on: null }],
      memories: [{ id: 'memory', goal_id: 'goal', author: 'ruby', note: 'Private note' }],
      photos: [{ id: photoId, memory_id: 'memory', width: 100, height: 100, ready: true }],
    };
    let restoring = false;
    const uploads = [];
    const writes = [];
    const failures = [];
    const server = createServer(
      /** Emulates paginated table exports and storage writes. Checks authentication and records restore side effects before returning fixture responses. */
      async (request, response) => {
        try {
          assert.equal(request.headers.apikey, 'test-owner-secret');
          const path = new URL(request.url, 'http://localhost');
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          let result = null;
          if (path.pathname.startsWith('/rest/v1/')) {
            const table = path.pathname.split('/').at(-1);
            if (request.method === 'GET') {
              result = restoring && table === 'goals' ? [] : tables[table];
              if (Number(path.searchParams.get('offset') ?? 0) > 0) result = [];
            } else {
              const data = JSON.parse(body.toString());
              writes.push({ table, data });
              if (table === 'photos' && request.method === 'POST') assert.equal(data[0].ready, false);
              if (table === 'photos' && request.method === 'PATCH') {
                assert.equal(uploads.length, 2);
                assert.equal(data.ready, true);
              }
            }
          } else if (request.method === 'GET') {
            response.end(photoBytes);
            return;
          } else {
            assert.deepEqual(body, photoBytes);
            uploads.push(path.pathname);
          }
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(result));
        } catch (error) {
          failures.push(error);
          response.statusCode = 500;
          response.end('{}');
        }
      });
    await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
    const url = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, OWNER_SUPABASE_URL: url, OWNER_SUPABASE_SECRET_KEY: 'test-owner-secret', OWNER_RESTORE_CONFIRM_URL: url };
    try {
      const backup = await execute(process.execPath, [resolve(project, 'scripts/owner-backup.mjs')], { cwd: directory, env });
      assert.equal(backup.stdout.includes('test-owner-secret'), false);
      const ownerDirectory = resolve(directory, '_workspace/owner');
      const [name] = await readdir(ownerDirectory);
      const output = resolve(ownerDirectory, name);
      const snapshot = JSON.parse(await readFile(resolve(output, 'journal.json'), 'utf8'));
      assert.equal(snapshot.tables.memories[0].note, 'Private note');
      assert.deepEqual(await readFile(resolve(output, 'objects', `display-${photoId}.webp`)), photoBytes);
      restoring = true;
      await execute(process.execPath, [resolve(project, 'scripts/owner-restore.mjs'), output], { cwd: directory, env });
      assert.deepEqual(writes.map(write => write.table), ['goals', 'goal_participants', 'memories', 'photos', 'photos']);
      assert.equal(uploads.length, 2);
      assert.deepEqual(failures, []);
    } finally {
      await new Promise(resolveClosed => server.close(resolveClosed));
      assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });
