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

test('backup exports image bytes and restore publishes only after uploads arrive',
  /** Creates a disposable API fixture. Runs owner scripts as child processes, checks output ordering and bytes, and removes local test artifacts. */
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bright-owner-test-'));
    const photoId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const photoBytes = Buffer.from('fixture-webp-bytes');
    const pictureId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const profileBytes = Buffer.from('fixture-profile-webp-bytes');
    const tables = {
      editor_accounts: [{ user_id: 'original-ruby', username: 'ruby' }, { user_id: 'original-jayatci', username: 'jayatci' }],
      goals: [{ id: 'goal', title: 'Private', visibility: 'private' }],
      goal_participants: [{ goal_id: 'goal', username: 'ruby', completed_on: null }],
      memories: [{ id: 'memory', goal_id: 'goal', author: 'ruby', note: 'Private note' }],
      photos: [{ id: photoId, memory_id: 'memory', width: 100, height: 100, ready: true }],
      editor_history: [{ id: 7, actor: 'ruby', goal_title: 'Private', summary: 'Edited this goal.', changed_at: '2026-10-15T00:00:00Z' }],
      editor_profiles: [
        { username: 'ruby', bio: 'A little about Ruby.', picture_visibility: 'friends', picture_id: pictureId, pending_picture_id: null, pending_picture_at: null, stale_picture_id: null, updated_at: '2026-10-15T00:00:00Z' },
        { username: 'jayatci', bio: 'A little about Jayatci.', picture_visibility: 'public', picture_id: null, pending_picture_id: null, pending_picture_at: null, stale_picture_id: null, updated_at: '2026-10-15T00:00:00Z' },
      ],
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
              if (path.searchParams.get('order') === 'username') result = [...result].sort((left, right) => left.username.localeCompare(right.username));
              const selected = path.searchParams.get('select');
              if (selected && selected !== '*') result = result.map(row => Object.fromEntries(selected.split(',').map(field => [field, row[field]])));
            } else {
              const data = JSON.parse(body.toString());
              writes.push({ table, data });
              if (table === 'photos' && request.method === 'POST') assert.equal(data[0].ready, false);
              if (table === 'photos' && request.method === 'PATCH') {
                assert.equal(uploads.length, 2);
                assert.equal(data.ready, true);
              }
              if (table === 'editor_profiles' && data.picture_id) {
                assert.ok(uploads.includes(`/storage/v1/object/profile-pictures/ruby/${pictureId}.webp`));
              }
            }
          } else if (request.method === 'GET') {
            response.end(path.pathname.includes('profile-pictures') ? profileBytes : photoBytes);
            return;
          } else {
            assert.deepEqual(body, path.pathname.includes('profile-pictures') ? profileBytes : photoBytes);
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
      const ruby = snapshot.tables.editor_profiles.find(profile => profile.username === 'ruby');
      assert.equal(ruby.picture_visibility, 'friends');
      assert.equal('pending_picture_id' in ruby, false);
      assert.equal('pending_picture_at' in ruby, false);
      assert.equal('stale_picture_id' in ruby, false);
      assert.deepEqual(await readFile(resolve(output, 'objects', `display-${photoId}.webp`)), photoBytes);
      assert.deepEqual(await readFile(resolve(output, 'objects', `profile-ruby-${pictureId}.webp`)), profileBytes);
      restoring = true;
      await execute(process.execPath, [resolve(project, 'scripts/owner-restore.mjs'), output], { cwd: directory, env });
      assert.deepEqual(writes.map(write => write.table), ['goals', 'goal_participants', 'memories', 'photos', 'photos', 'editor_history', 'editor_profiles', 'editor_profiles', 'editor_profiles']);
      assert.equal('id' in writes.find(write => write.table === 'editor_history').data[0], false);
      const profileWrites = writes.filter(write => write.table === 'editor_profiles');
      assert.equal(profileWrites[0].data.picture_id, null);
      assert.equal(profileWrites[1].data.picture_id, null);
      assert.equal(profileWrites[1].data.pending_picture_at, null);
      assert.equal(profileWrites[2].data.picture_id, pictureId);
      assert.equal(uploads.length, 3);
      assert.deepEqual(failures, []);
    } finally {
      await new Promise(resolveClosed => server.close(resolveClosed));
      assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });

test('older format-one snapshots restore without a profile table',
  /** Restores a snapshot predating profiles against a disposable API and rejects any profile-table request. */
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bright-old-restore-test-'));
    const backup = resolve(directory, 'backup');
    const requests = [];
    const server = createServer(
      /** Answers only the legacy restore endpoints, recording any unexpected profile access. */
      async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        requests.push(pathname);
        response.setHeader('Content-Type', 'application/json');
        if (pathname.includes('editor_profiles')) {
          response.statusCode = 404;
          response.end('{}');
        } else if (pathname.endsWith('/editor_accounts')) {
          response.end(JSON.stringify([{ username: 'ruby', user_id: 'ruby-id' }, { username: 'jayatci', user_id: 'jayatci-id' }]));
        } else {
          response.end('[]');
        }
      });
    await mkdir(backup);
    await writeFile(resolve(backup, 'journal.json'), JSON.stringify({
      format: 1, tables: { goals: [], goal_participants: [], memories: [], photos: [] },
    }));
    await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
    const url = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, OWNER_SUPABASE_URL: url, OWNER_SUPABASE_SECRET_KEY: 'test-owner-secret', OWNER_RESTORE_CONFIRM_URL: url };
    try {
      await execute(process.execPath, [resolve(project, 'scripts/owner-restore.mjs'), backup], { cwd: directory, env });
      assert.equal(requests.some(path => path.includes('editor_profiles')), false);
    } finally {
      await new Promise(resolveClosed => server.close(resolveClosed));
      assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  });

test('interrupted profile uploads resume without publishing missing picture bytes',
  /** Fails one profile upload, then retries the same restore and checks publication follows successful upload. */
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'bright-profile-resume-test-'));
    const backup = resolve(directory, 'backup');
    const pictureId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const profileBytes = Buffer.from('resume-profile-webp-bytes');
    const events = [];
    let hasGoal = false;
    let failUpload = true;
    const server = createServer(
      /** Simulates a target that retains journal rows after the first run but loses the first object upload. */
      async (request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        response.setHeader('Content-Type', 'application/json');
        if (pathname.endsWith('/editor_accounts')) response.end(JSON.stringify([{ username: 'ruby', user_id: 'ruby-id' }, { username: 'jayatci', user_id: 'jayatci-id' }]));
        else if (pathname.endsWith('/goals') && request.method === 'GET') response.end(JSON.stringify(hasGoal ? [{ id: 'goal' }] : []));
        else if (pathname.endsWith('/goals') && request.method === 'POST') { hasGoal = true; response.end('[]'); }
        else if (pathname.endsWith('/editor_profiles')) {
          const data = JSON.parse(body.toString());
          events.push(data.picture_id ? 'publish' : 'hide');
          if (data.picture_id) assert.ok(events.includes('upload'));
          response.end('{}');
        } else if (pathname.includes('/storage/v1/object/profile-pictures/')) {
          assert.deepEqual(body, profileBytes);
          if (failUpload) { failUpload = false; response.statusCode = 500; response.end('{}'); }
          else { events.push('upload'); response.end('{}'); }
        } else response.end('[]');
      });
    await mkdir(resolve(backup, 'objects'), { recursive: true });
    await writeFile(resolve(backup, 'journal.json'), JSON.stringify({ format: 1, tables: {
      goals: [{ id: 'goal', title: 'A goal' }], goal_participants: [], memories: [], photos: [],
      editor_profiles: [{ username: 'ruby', bio: 'Hello', picture_visibility: 'friends', picture_id: pictureId, updated_at: '2026-10-15T00:00:00Z' }],
    } }));
    await writeFile(resolve(backup, 'objects', `profile-ruby-${pictureId}.webp`), profileBytes);
    await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
    const url = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, OWNER_SUPABASE_URL: url, OWNER_SUPABASE_SECRET_KEY: 'test-owner-secret', OWNER_RESTORE_CONFIRM_URL: url };
    try {
      await assert.rejects(execute(process.execPath, [resolve(project, 'scripts/owner-restore.mjs'), backup], { cwd: directory, env }));
      assert.deepEqual(events, ['hide']);
      await execute(process.execPath, [resolve(project, 'scripts/owner-restore.mjs'), backup, '--resume'], { cwd: directory, env });
      assert.deepEqual(events, ['hide', 'hide', 'upload', 'publish']);
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
