// Fetch batches of the feed's slowest sources at build time and ship them as
// static files, so visitors anywhere get them from the CDN with no wait.
// Anything that fails is skipped; the page falls back to /api/src, then the source.
import { mkdir, writeFile } from 'node:fs/promises';
import { SOURCES } from '../api/src.js';

const COUNT = { nature: 40, space: 12 };
const out = new URL('../public/data/', import.meta.url);
await mkdir(out, { recursive: true });

const jobs = Object.entries(COUNT).flatMap(([s, n]) =>
	Array.from({ length: n }, (_, i) => [s, i, Math.floor((i * SOURCES[s].pages) / n)]));
let ok = 0;
async function run([s, i, p]) {
	const src = SOURCES[s];
	try {
		const r = await fetch(src.url(p), { headers: { 'User-Agent': 'aishipped.lol feed' }, signal: AbortSignal.timeout(45000) });
		if (!r.ok) throw new Error(r.status);
		const d = await r.json();
		await writeFile(new URL(`${s}-${i}.json`, out), JSON.stringify(src.trim ? src.trim(d) : d));
		ok++;
	} catch (e) { console.warn(`snapshot ${s} ${i}: ${e.message}`); }
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await run(queue.shift()); }));
await writeFile(new URL('manifest.json', out), JSON.stringify(COUNT));
console.log(`snapshot: ${ok}/${jobs.length} batches`);
