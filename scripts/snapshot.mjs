// Fetch batches of the feed's slowest sources at build time and ship them as
// static files, so visitors anywhere get them from the CDN with no wait.
// Anything that fails is skipped; the page falls back to /api/src, then the source.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { SOURCES } from '../api/src.js';

const COUNT = { nature: 40, space: 12, featured: 60, history: 30 };
const out = new URL('../public/data/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const jobs = Object.entries(COUNT).flatMap(([s, n]) =>
	Array.from({ length: n }, (_, i) => [s, i, Math.floor((i * SOURCES[s].pages) / n)]));
let ok = 0;
const done = Object.fromEntries(Object.keys(COUNT).map((s) => [s, 0]));
async function run([s, i, p]) {
	const src = SOURCES[s];
	try {
		const r = await fetch(src.url(p), { headers: { 'User-Agent': 'aishipped.lol feed' }, signal: AbortSignal.timeout(45000) });
		if (!r.ok) throw new Error(r.status);
		const d = await r.json();
		// number files by success so the manifest count has no gaps
		const n = done[s]++;
		await writeFile(new URL(`${s}-${n}.json`, out), JSON.stringify(src.trim ? src.trim(d, p) : d));
		ok++;
	} catch (e) { console.warn(`snapshot ${s} ${i}: ${e.message}`); }
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await run(queue.shift()); }));
// poems: every short poem on PoetryDB, shuffled into small files
try {
	const lists = await Promise.all(Array.from({ length: 37 }, (_, i) =>
		fetch(`https://poetrydb.org/linecount/${i + 4}/title,author,lines,linecount`, { signal: AbortSignal.timeout(45000) }).then((r) => r.json()).catch(() => [])));
	const all = lists.flat().filter((x) => x && x.lines);
	for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
	COUNT.poems = Math.floor(all.length / 30);
	for (let i = 0; i < COUNT.poems; i++) await writeFile(new URL(`poems-${i}.json`, out), JSON.stringify(all.slice(i * 30, i * 30 + 30)));
} catch (e) { console.warn(`snapshot poems: ${e.message}`); }
await writeFile(new URL('manifest.json', out), JSON.stringify({ ...done, poems: COUNT.poems ?? 0 }));
console.log(`snapshot: ${ok}/${jobs.length} batches`);
