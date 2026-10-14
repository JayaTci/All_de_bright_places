// Mirrors authoritative SQL migrations into the Supabase CLI layout before local commands.
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve('All_de_bright_placesDatabase/migrations');
const target = resolve('All_de_bright_placesDatabase/supabase/migrations');
await mkdir(target, { recursive: true });
for (const file of await readdir(source)) {
  if (file.endsWith('.sql')) await copyFile(resolve(source, file), resolve(target, file));
}
console.log('Supabase CLI migrations synchronized.');
