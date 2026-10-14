// Encrypts owner backups with a separate local recovery key and restores verified archives.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('BRIGHT-OWNER-BACKUP-1\n');
const ivBytes = 12;
const tagBytes = 16;
const [mode, inputName, outputName, keyName] = process.argv.slice(2);
if (!['keygen', 'encrypt', 'decrypt'].includes(mode)) throw new Error('Use keygen <key-file>, encrypt <backup-directory> <archive-file> <key-file>, or decrypt <archive-file> <target-directory> <key-file>.');

/**
 * Loads the 256-bit key used for a private owner archive.
 * @param {string} path - Local key file kept separately from the archive.
 * @returns {Promise<Buffer>} The validated encryption key.
 * @throws If the file is missing or malformed. Reads only the owner's local disk.
 */
async function readKey(path) {
  const value = (await readFile(path, 'utf8')).trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('The recovery key file is invalid.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('The recovery key file is invalid.');
  return key;
}

/**
 * Waits for a tar process without exposing private archive contents in errors.
 * @param {import('node:child_process').ChildProcess} child - Running archive process.
 * @returns {Promise<void>} Resolves only after a successful exit.
 * @throws If the archive process fails; this function has no disk side effects.
 */
async function processExit(child) {
  const code = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', done);
  });
  if (code !== 0) throw new Error('The archive command failed. Check the source and destination paths.');
}

if (mode === 'keygen') {
  if (!inputName || outputName || keyName) throw new Error('Use keygen <key-file>.');
  const path = resolve(inputName);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${randomBytes(32).toString('base64')}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Recovery key saved privately to ${path}. Keep a separate copy away from the encrypted archive.`);
} else if (mode === 'encrypt') {
  if (!inputName || !outputName || !keyName) throw new Error('Use encrypt <backup-directory> <archive-file> <key-file>.');
  const source = resolve(inputName);
  const destination = resolve(outputName);
  const distance = relative(source, destination);
  if (!distance || (distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance))) throw new Error('Place the encrypted archive outside the source backup directory.');
  await stat(resolve(source, 'journal.json'));
  const key = await readKey(resolve(keyName));
  const iv = randomBytes(ivBytes);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.concat([magic, iv]), { flag: 'wx', mode: 0o600 });
  const tar = spawn('tar', ['-cf', '-', '-C', source, '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  try {
    await Promise.all([pipeline(tar.stdout, cipher, createWriteStream(destination, { flags: 'a' })), processExit(tar)]);
    await appendFile(destination, cipher.getAuthTag());
    console.log(`Encrypted backup saved to ${destination}. Keep the recovery key separately.`);
  } catch (error) {
    tar.kill();
    await rm(destination, { force: true });
    throw error;
  }
} else {
  if (!inputName || !outputName || !keyName) throw new Error('Use decrypt <archive-file> <target-directory> <key-file>.');
  const source = resolve(inputName);
  const target = resolve(outputName);
  const key = await readKey(resolve(keyName));
  const handle = await open(source, 'r');
  const header = Buffer.alloc(magic.length + ivBytes);
  const tag = Buffer.alloc(tagBytes);
  let size;
  try {
    size = (await handle.stat()).size;
    if (size <= header.length + tagBytes) throw new Error('Encrypted archive is incomplete.');
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tagBytes, size - tagBytes);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Unsupported encrypted archive format.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length));
  decipher.setAuthTag(tag);
  const temporary = resolve(tmpdir(), `bright-owner-restore-${randomBytes(16).toString('hex')}.tar`);
  try {
    await pipeline(createReadStream(source, { start: header.length, end: size - tagBytes - 1 }), decipher, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    await mkdir(target);
    const tar = spawn('tar', ['-xf', temporary, '-C', target], { stdio: ['ignore', 'ignore', 'ignore'] });
    await processExit(tar);
    console.log(`Verified backup extracted to ${target}.`);
  } finally {
    await rm(temporary, { force: true });
  }
}
