// The SHA-256 of every file in dist/, as JSON on stdout. GitHub Actions runs this on each commit to main,
// signs the result and keeps it on the `fingerprints` branch, where scripts/verify-live.mjs looks it up.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = {};
for (const f of (await readdir(dist, { recursive: true, withFileTypes: true })).filter((d) => d.isFile())) {
	const full = join(f.parentPath ?? f.path, f.name);
	files[relative(dist, full).split('\\').join('/')] = createHash('sha256').update(await readFile(full)).digest('hex');
}
const commit = (await readFile(join(dist, 'build.txt'), 'utf8')).trim();
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
console.log(JSON.stringify({ site: 'https://aishipped.lol', commit, node: process.version, files: sorted }, null, 1));
