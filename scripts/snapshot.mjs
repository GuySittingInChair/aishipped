// Fetch batches of the feed's slowest sources at build time and ship them as
// static files, so visitors anywhere get them from the CDN with no wait.
// Anything that fails is skipped; the page falls back to /api/src, then the source.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { blockRegex } from '../src/data/block.mjs';

// Everything downloaded is screened against the default never-show list here, using every text value
// in each item (tags, descriptions, hidden fields), not just what a card displays.
const BLOCK = blockRegex(await readFile(new URL('../src/data/blocklist.txt', import.meta.url), 'utf8'));
let screened = 0;
const words = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(words) : []);
const bad = (item) => BLOCK.test(words(item).join(' \n '));
function screen(d, depth = 0) {
	if (depth > 3 || !d || typeof d !== 'object') return d;
	if (Array.isArray(d)) {
		if (d.length > 2 && d.every((x) => x && typeof x === 'object')) {
			const keep = d.filter((x) => !bad(x)); screened += d.length - keep.length; return keep.map((x) => screen(x, depth + 1));
		}
		return d;
	}
	for (const [k, v] of Object.entries(d)) {
		// wikipedia: query.pages is an object keyed by page id
		if (k === 'pages' && v && !Array.isArray(v) && typeof v === 'object') {
			for (const [pk, pv] of Object.entries(v)) if (bad(pv)) { delete v[pk]; screened++; }
		} else d[k] = screen(v, depth + 1);
	}
	return d;
}
import { SOURCES } from '../api/src.js';

const COUNT = { nature: 24, featured: 60, history: 30, art: 30, photos: 30, books: 30, design: 24, curious: 22, europe: 30, random: 40, travel: 30, gutenberg: 12 };
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
		const r = await fetch(src.url(p), { headers: { 'User-Agent': 'aishipped-feed/1.0 (https://aishipped.lol; build snapshot)' }, signal: AbortSignal.timeout(30000) });
		if (!r.ok) throw new Error(r.status);
		const d = await r.json();
		// number files by success so the manifest count has no gaps
		const n = done[s]++;
		await writeFile(new URL(`${s}-${n}.json`, out), JSON.stringify(screen(src.trim ? src.trim(d, p) : d)));
		ok++;
	} catch (e) { console.warn(`snapshot ${s} ${i}: ${e.message}`); }
}
// two requests at a time per source, all sources at once: polite to each host, fast overall
await Promise.all(Object.keys(COUNT).map((s) => {
	const queue = jobs.filter((j) => j[0] === s);
	return Promise.all([0, 1].map(async () => { while (queue.length) await run(queue.shift()); }));
}));
// poems: every short poem on PoetryDB, shuffled into small files
try {
	const lists = await Promise.all(Array.from({ length: 37 }, (_, i) =>
		fetch(`https://poetrydb.org/linecount/${i + 4}/title,author,lines,linecount`, { signal: AbortSignal.timeout(45000) }).then((r) => r.json()).catch(() => [])));
	const all = lists.flat().filter((x) => x && x.lines);
	for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
	COUNT.poems = Math.floor(all.length / 30);
	for (let i = 0; i < COUNT.poems; i++) await writeFile(new URL(`poems-${i}.json`, out), JSON.stringify(screen(all.slice(i * 30, i * 30 + 30))));
} catch (e) { console.warn(`snapshot poems: ${e.message}`); }
// the Met's whole object list, so the feed can draw uniformly from all of it.
// stored as base-36 gaps between sorted IDs (mostly "1"), which compresses to almost nothing
let met = 0;
try {
	const ids = (await (await fetch('https://collectionapi.metmuseum.org/public/collection/v1/objects', { signal: AbortSignal.timeout(60000) })).json()).objectIDs.sort((a, b) => a - b);
	await writeFile(new URL('met-ids.txt', out), ids.map((v, i) => (v - (ids[i - 1] ?? 0)).toString(36)).join(','));
	met = ids.length;
} catch (e) { console.warn(`snapshot met: ${e.message}`); }
// security: three whole catalogues, small enough to take in full every build
let cyber = 0;
try {
	const get = (u) => fetch(u, { headers: { 'User-Agent': 'aishipped-feed/1.0 (https://aishipped.lol; build snapshot)' }, signal: AbortSignal.timeout(120000) }).then((r) => r.json());
	const clip = (t, n = 700) => (t && t.length > n ? t.slice(0, t.lastIndexOf(' ', n)) + '…' : t);
	const plain = (t) => t?.replace(/\(Citation:[^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
	const [kev, attack, capec] = await Promise.all([
		get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json').catch(() => null),
		get('https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json').catch(() => null),
		get('https://raw.githubusercontent.com/mitre/cti/master/capec/2.1/stix-capec.json').catch(() => null),
	]);
	const stix = (bundle, credit, linkText) => (bundle?.objects ?? [])
		.filter((o) => o.type === 'attack-pattern' && !o.revoked && !o.x_mitre_deprecated && o.description)
		.map((o) => {
			const ref = o.external_references?.find((r) => r.url) ?? {};
			return { id: `cyber:${ref.external_id ?? o.id}`, title: o.name, sub: [ref.external_id, (o.kill_chain_phases ?? []).map((k) => k.phase_name.replace(/-/g, ' ')).join(', ') || o.x_capec_likelihood_of_attack && `likelihood: ${o.x_capec_likelihood_of_attack.toLowerCase()}`].filter(Boolean).join(' · '), body: clip(plain(o.description)), link: ref.url, linkText, credit };
		});
	const all = [
		...(kev?.vulnerabilities ?? []).map((v) => ({
			id: `cyber:${v.cveID}`, title: v.vulnerabilityName, sub: [v.cveID, `exploited in the wild, listed ${v.dateAdded}`, v.knownRansomwareCampaignUse === 'Known' && 'used by ransomware'].filter(Boolean).join(' · '),
			body: clip(`${v.shortDescription} What to do: ${v.requiredAction}`), link: `https://nvd.nist.gov/vuln/detail/${v.cveID}`, linkText: 'nvd.nist.gov', credit: 'CISA Known Exploited Vulnerabilities',
		})),
		...stix(attack, 'MITRE ATT&CK', 'attack.mitre.org'),
		...stix(capec, 'MITRE CAPEC', 'capec.mitre.org'),
	];
	const keep = screen(all);
	for (let i = keep.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keep[i], keep[j]] = [keep[j], keep[i]]; }
	cyber = Math.ceil(keep.length / 25);
	for (let i = 0; i < cyber; i++) await writeFile(new URL(`cyber-${i}.json`, out), JSON.stringify(keep.slice(i * 25, i * 25 + 25)));
	console.log(`snapshot cyber: ${keep.length} of ${all.length} kept`);
} catch (e) { console.warn(`snapshot cyber: ${e.message}`); }
console.log(`snapshot: screened out ${screened} items matching the never-show list`);
await writeFile(new URL('manifest.json', out), JSON.stringify({ ...done, poems: COUNT.poems ?? 0, met, cyber }));
console.log(`snapshot: ${ok}/${jobs.length} batches`);
