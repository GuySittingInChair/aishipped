// Build (or add to) your personal pack: only the collections you allow (scripts/pack/collections.mjs), screened
// against the never-show list, every card judged once by a model on your own computer (Ollama), its picture
// saved locally so the pack works offline. New cards wait in the review queue until you keep or toss them
// (npm run pack:serve, then open http://127.0.0.1:8793).
//
//   npm run pack                       adds up to perCollection new cards from each allowed collection
//   npm run pack -- --only=birds,jazz  just those
//   npm run pack -- --per=5            this many each, this time
//   npm run pack -- --no-judge         skip the model (everything goes to your review queue)
//
// Everything lives in pack/ (not in git): config.json (edit it: which collections, the model, the rule it
// judges by), cards.json, rejected.json (what was dropped and why), media/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { blockRegex } from '../../src/data/block.mjs';
import { COLLECTIONS, get, strip } from './collections.mjs';

const DIR = new URL('../../pack/', import.meta.url);
const at = (f) => new URL(f, DIR);
const readJSON = async (f, d) => { try { return JSON.parse(await readFile(at(f), 'utf8')); } catch { return d; } };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1] ?? (process.argv.includes(`--${k}`) ? true : undefined);

await mkdir(at('media/'), { recursive: true });
const DEFAULT = {
	model: 'qwen3:4b-instruct-2507-q4_K_M',
	ollama: 'http://127.0.0.1:11434',
	perCollection: 20,
	collections: Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, true])),
	judge: 'Keep a card only if it is about nature (animals, plants, landscapes), art and craftsmanship (including historic arms and armour), old music, old films, '
		+ 'old photographs, maps or classic books. Reject anything about people in the news, politics, current wars, '
		+ 'technology or tech companies, celebrities, advertising, or anything that just reads oddly or feels out of place.',
};
const config = { ...DEFAULT, ...(await readJSON('config.json', {})) };
config.collections = { ...DEFAULT.collections, ...config.collections };
await writeFile(at('config.json'), JSON.stringify(config, null, 2));

const cards = await readJSON('cards.json', []);
const rejected = await readJSON('rejected.json', []);
const pages = await readJSON('pages.json', {});
const known = new Set([...cards.map((c) => c.id), ...rejected.map((c) => c.id)]);
const save = () => Promise.all([
	writeFile(at('cards.json'), JSON.stringify(cards, null, 1)),
	writeFile(at('rejected.json'), JSON.stringify(rejected, null, 1)),
	writeFile(at('pages.json'), JSON.stringify(pages)),
]);

// The never-show list: the site's default, plus your own additions in pack/never.txt, against everything the card
// shows. (Not every raw field: iNaturalist's carry uploaders' usernames and icons, and its own social links.)
const BLOCK = blockRegex([await readFile(new URL('../../src/data/blocklist.txt', import.meta.url), 'utf8'), await readFile(at('never.txt'), 'utf8').catch(() => '')].join('\n'));
const shows = (c) => [c.title, c.sub, c.body, c.imgAlt, c.credit, c.link].filter(Boolean).join(' \n ');

// The judge: one question per card to the model on this computer.
const noJudge = arg('no-judge') === true;
async function judge(card) {
	if (noJudge) return { keep: true, reason: 'not judged (--no-judge)' };
	const text = [`From: ${COLLECTIONS[card.src].name}`, `Title: ${card.title}`, card.sub && `Details: ${card.sub}`, card.body && `Text: ${card.body.slice(0, 900)}`, card.credit && `Credit: ${card.credit}`].filter(Boolean).join('\n');
	const r = await fetch(`${config.ollama}/api/chat`, {
		method: 'POST',
		signal: AbortSignal.timeout(120000),
		body: JSON.stringify({
			model: config.model, stream: false, options: { temperature: 0 },
			format: { type: 'object', properties: { keep: { type: 'boolean' }, reason: { type: 'string' } }, required: ['keep', 'reason'] },
			messages: [
				{ role: 'system', content: `You screen cards for one person's personal feed. Their rule:\n${config.judge}\nAnswer in JSON: keep (true or false) and reason (a few words). If unsure, reject.` },
				{ role: 'user', content: text },
			],
		}),
	});
	if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
	const out = JSON.parse((await r.json()).message.content);
	return { keep: !!out.keep, reason: String(out.reason ?? '').slice(0, 200) };
}
if (!noJudge) {
	try { await judge.call(null, { src: Object.keys(COLLECTIONS)[0], title: 'a robin on a branch' }); }
	catch (e) { console.error(`Can't reach ${config.model} through Ollama at ${config.ollama} (${e.message}).\nStart Ollama, or \`ollama pull ${config.model}\`, or run with --no-judge.`); process.exit(1); }
}

// Pictures saved here, so the pack doesn't need the internet.
async function keepPicture(card) {
	const r = await get(card.img, 60000);
	const ext = (r.headers.get('content-type') ?? '').includes('png') ? 'png' : (r.headers.get('content-type') ?? '').includes('gif') ? 'gif' : 'jpg';
	const file = `${card.id.replace(/[^a-z0-9_-]+/gi, '_')}.${ext}`;
	await writeFile(at(`media/${file}`), Buffer.from(await r.arrayBuffer()));
	return file;
}

// two judgements at a time (the Ollama service runs two in parallel)
async function pool(items, n, fn) {
	const out = [];
	let i = 0;
	await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
	return out;
}

const only = typeof arg('only') === 'string' ? arg('only').split(',') : null;
const per = +(arg('per') ?? config.perCollection);
const tally = { kept: 0, judgedOut: 0, blocked: 0, failed: 0 };
for (const [id, C] of Object.entries(COLLECTIONS)) {
	if (only ? !only.includes(id) : !config.collections[id]) continue;
	let added = 0;
	for (let round = 0; round < 4 && added < per; round++) {
		// fetch a page not tried before (or a sample, for the Met)
		let items = [];
		try {
			if (C.sample) items = await C.sample(Math.min(30, (per - added) * 2));
			else {
				const done = new Set(pages[id] ?? []);
				let p = 1 + Math.floor(Math.random() * C.pages);
				for (let k = 0; k < 20 && done.has(p); k++) p = 1 + Math.floor(Math.random() * C.pages);
				(pages[id] ??= []).push(p);
				items = C.list(await (await get(C.url(p))).json()) ?? [];
			}
		} catch (e) { console.log(`  ${id}: couldn't fetch (${e.message})`); tally.failed++; continue; }
		const fresh = [];
		for (const raw of items) {
			const card = C.card(raw);
			if (!card || known.has(card.id)) continue;
			for (const k of ['title', 'sub', 'body', 'imgAlt']) if (card[k]) card[k] = strip(card[k]);   // (some titles carry HTML)
			known.add(card.id);
			if (BLOCK && BLOCK.test(shows(card))) { rejected.push({ id: card.id, src: id, title: card.title, why: 'never-show list' }); tally.blocked++; continue; }
			fresh.push(card);
		}
		const verdicts = await pool(fresh.slice(0, (per - added) * 2), 2, (c) => judge(c).catch((e) => ({ keep: false, reason: `judge failed: ${e.message}` })));
		for (let k = 0; k < verdicts.length && added < per; k++) {
			const card = fresh[k], v = verdicts[k];
			if (!v) continue;
			if (!v.keep) { rejected.push({ id: card.id, src: id, title: card.title, why: `judge: ${v.reason}` }); tally.judgedOut++; continue; }
			try { card.file = await keepPicture(card); } catch { tally.failed++; continue; }
			cards.push({ ...card, status: 'review', judged: { ...v, model: noJudge ? null : config.model }, added: new Date().toISOString() });
			added++;
			tally.kept++;
		}
		await save();
	}
	console.log(`${id}: +${added} for review`);
}
await save();
const waiting = cards.filter((c) => c.status === 'review').length;
console.log(`\n${tally.kept} new cards waiting for you, ${tally.judgedOut} turned down by the judge, ${tally.blocked} on the never-show list, ${tally.failed} failed.`);
console.log(`${waiting} in your review queue, ${cards.filter((c) => c.status === 'kept').length} kept. Review: npm run pack:serve, then open http://127.0.0.1:8793`);
