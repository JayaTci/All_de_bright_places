// Verifies owner backup and restore behavior against a local HTTP fixture without production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
      editor_history: [{ id: 7, actor: 'ruby', goal_title: 'Private', summary: 'Edited this goal.', changed_at: '2026-10-15T00:00:00Z' }],
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
              result = restoring && ['goals', 'editor_history'].includes(table) ? [] : tables[table];
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
      assert.equal(snapshot.tables.editor_history[0].summary, 'Edited this goal.');
      assert.deepEqual(await readFile(resolve(output, 'objects', `display-${photoId}.webp`)), photoBytes);
      restoring = true;
      await execute(process.execPath, [resolve(project, 'scripts/owner-restore.mjs'), output], { cwd: directory, env });
      assert.deepEqual(writes.map(write => write.table), ['goals', 'goal_participants', 'memories', 'photos', 'photos', 'editor_history']);
      assert.equal('id' in writes.at(-1).data[0], false);
      assert.equal(uploads.length, 2);
      assert.deepEqual(failures, []);
    } finally {
      await new Promise(resolveClosed => server.close(resolveClosed));
      assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });

test('encrypted owner archives round trip and reject the wrong recovery key',
  /** Builds a disposable snapshot, checks verified extraction, and ensures a wrong key cannot create an output directory. */
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bright-archive-test-'));
    const backup = resolve(directory, 'backup');
    const archive = resolve(directory, 'backup.adbenc');
    const key = resolve(directory, 'recovery.key');
    const wrongKey = resolve(directory, 'wrong.key');
    const journal = Buffer.from('{"format":1,"tables":{"goals":[]}}');
    try {
      await mkdir(backup);
      await writeFile(resolve(backup, 'journal.json'), journal);
      await execute(process.execPath, [resolve(project, 'scripts/owner-archive.mjs'), 'keygen', key]);
      await execute(process.execPath, [resolve(project, 'scripts/owner-archive.mjs'), 'encrypt', backup, archive, key]);
      const extracted = resolve(directory, 'extracted');
      await execute(process.execPath, [resolve(project, 'scripts/owner-archive.mjs'), 'decrypt', archive, extracted, key]);
      assert.deepEqual(await readFile(resolve(extracted, 'journal.json')), journal);
      await execute(process.execPath, [resolve(project, 'scripts/owner-archive.mjs'), 'keygen', wrongKey]);
      const rejected = resolve(directory, 'rejected');
      await assert.rejects(execute(process.execPath, [resolve(project, 'scripts/owner-archive.mjs'), 'decrypt', archive, rejected, wrongKey]));
      await assert.rejects(access(rejected));
    } finally {
      assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });

test('owner recovery writes a link accepted by the app and resets only the selected factor',
  /** Runs the owner recovery script against a disposable Auth fixture and checks the private output without exposing a real token. */
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bright-recovery-test-'));
    const calls = [];
    const server = createServer(
      /** Emulates the minimum owner Auth endpoints needed to issue and inspect a recovery link. */
      async (request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        calls.push(`${request.method} ${path}`);
        response.setHeader('Content-Type', 'application/json');
        if (path === '/rest/v1/editor_accounts') response.end(JSON.stringify([{ user_id: 'test-user' }]));
        else if (path === '/auth/v1/admin/users/test-user') response.end(JSON.stringify({ email: 'ruby@local.test' }));
        else if (path === '/auth/v1/admin/generate_link') response.end(JSON.stringify({ hashed_token: 'fixture-token', action_link: 'http://localhost/auth/v1/verify?token=wrong' }));
        else if (path === '/auth/v1/admin/users/test-user/factors') response.end(JSON.stringify([{ id: 'old-factor', factor_type: 'totp' }]));
        else if (path === '/auth/v1/admin/users/test-user/factors/old-factor') response.end('{}');
        else { response.statusCode = 404; response.end('{}'); }
      });
    await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
    const url = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, OWNER_SUPABASE_URL: url, OWNER_SUPABASE_SECRET_KEY: 'test-owner-secret', OWNER_RECOVERY_REDIRECT: 'http://localhost:3000/auth/recovery' };
    try {
      await execute(process.execPath, [resolve(project, 'scripts/owner-recovery.mjs'), 'ruby', '--reset-mfa'], { cwd: directory, env });
      const [name] = await readdir(resolve(directory, '_workspace/owner'));
      const link = new URL(await readFile(resolve(directory, '_workspace/owner', name), 'utf8'));
      assert.equal(link.pathname, '/auth/recovery');
      assert.equal(link.searchParams.get('token_hash'), 'fixture-token');
      assert.equal(link.searchParams.get('type'), 'recovery');
      assert.ok(calls.includes('DELETE /auth/v1/admin/users/test-user/factors/old-factor'));
      assert.ok(calls.indexOf('POST /auth/v1/admin/generate_link') < calls.indexOf('DELETE /auth/v1/admin/users/test-user/factors/old-factor'));
    } finally {
      await new Promise(resolveClosed => server.close(resolveClosed));
      assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });
