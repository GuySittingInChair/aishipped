// Your pack, served from this computer only (127.0.0.1): the review screen at http://127.0.0.1:8793, and the
// cards you kept, for the feed's "my pack" switch. Nothing here is reachable from outside this machine.
//
//   npm run pack:serve
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COLLECTIONS } from './collections.mjs';

const PORT = 8793; // not 8790: fake chat lives there
const DIR = new URL('../../pack/', import.meta.url);
const at = (f) => new URL(f, DIR);
// the feed may read your kept cards from these pages (the live site, and the site running locally)
const ORIGINS = new Set(['https://aishipped.lol', 'http://localhost:4321', 'http://localhost:4329', `http://127.0.0.1:${PORT}`]);
const TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', html: 'text/html; charset=utf-8', json: 'application/json' };

const load = async (f, d) => { try { return JSON.parse(await readFile(at(f), 'utf8')); } catch { return d; } };
const store = async (f, v) => { await writeFile(at(`${f}.tmp`), JSON.stringify(v, null, 1)); await rename(at(`${f}.tmp`), at(f)); };
// Meaning matching for the feed's taste: texts in, nomic-embed-text vectors out, from your own Ollama. Every
// vector is kept in pack/embeds.jsonl, so no card is ever embedded twice and the GPU is left alone.
const OLLAMA = 'http://127.0.0.1:11434';
let vecs = null; // key -> base64 float32
const vkey = (model, t) => createHash('sha1').update(`${model}\0${t}`).digest('base64url');
async function embed(model, input) {
	if (!vecs) {
		vecs = new Map();
		for (const l of (await readFile(at('embeds.jsonl'), 'utf8').catch(() => '')).split('\n')) {
			try { const { k, v } = JSON.parse(l); vecs.set(k, v); } catch {}
		}
	}
	const keys = input.map((t) => vkey(model, t));
	const need = [...new Set(input.filter((t, i) => !vecs.has(keys[i])))];
	let fresh = 0;
	for (let i = 0; i < need.length; i += 64) {
		const part = need.slice(i, i + 64);
		const r = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', body: JSON.stringify({ model, input: part }), signal: AbortSignal.timeout(60000) });
		if (!r.ok) throw new Error(`ollama said ${r.status}: ${(await r.text()).slice(0, 200)}`);
		const { embeddings } = await r.json();
		const lines = part.map((t, j) => {
			const k = vkey(model, t), v = Buffer.from(new Float32Array(embeddings[j]).buffer).toString('base64');
			vecs.set(k, v);
			return JSON.stringify({ k, v });
		});
		await mkdir(DIR, { recursive: true });
		await appendFile(at('embeds.jsonl'), lines.join('\n') + '\n');
		fresh += part.length;
	}
	const out = keys.map((k) => { const b = Buffer.from(vecs.get(k), 'base64'); return [...new Float32Array(b.buffer, b.byteOffset, b.length / 4)].map((x) => +x.toFixed(5)); });
	return { embeddings: out, cached: input.length - fresh, fresh };
}

const shape = (c) => ({ ...c, img: `http://127.0.0.1:${PORT}/media/${c.file}`, from: COLLECTIONS[c.src]?.name ?? c.src, group: COLLECTIONS[c.src]?.group });

createServer(async (req, res) => {
	const origin = req.headers.origin;
	if (origin && ORIGINS.has(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	if (req.method === 'OPTIONS') {
		res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true' });
		return res.end();
	}
	const send = (code, body, type = TYPES.json) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	try {
		if (url.pathname === '/' && req.method === 'GET') return send(200, await readFile(new URL('./review.html', import.meta.url)), TYPES.html);
		if (url.pathname === '/api/cards' && req.method === 'GET') {
			const want = url.searchParams.get('status') ?? 'kept';
			return send(200, (await load('cards.json', [])).filter((c) => c.status === want).map(shape));
		}
		if (url.pathname === '/api/stats' && req.method === 'GET') {
			const cards = await load('cards.json', []);
			const count = (s) => cards.filter((c) => c.status === s).length;
			return send(200, { review: count('review'), kept: count('kept'), rejected: (await load('rejected.json', [])).length });
		}
		if (url.pathname === '/api/verdict' && req.method === 'POST') {
			// only from the review page itself
			if (origin && origin !== `http://127.0.0.1:${PORT}`) return send(403, { error: 'only the review screen can change the pack' });
			let body = '';
			for await (const chunk of req) body += chunk;
			const { id, keep } = JSON.parse(body);
			const cards = await load('cards.json', []);
			const card = cards.find((c) => c.id === id);
			if (!card) return send(404, { error: 'no such card' });
			if (keep) card.status = 'kept';
			else {
				// tossed: gone from the pack, its picture deleted, remembered so it never comes back
				cards.splice(cards.indexOf(card), 1);
				const rejected = await load('rejected.json', []);
				rejected.push({ id: card.id, src: card.src, title: card.title, why: 'you tossed it' });
				await store('rejected.json', rejected);
				await unlink(at(`media/${card.file}`)).catch(() => {});
			}
			card.reviewed = new Date().toISOString();
			await store('cards.json', cards);
			return send(200, { ok: true });
		}
		if (url.pathname === '/api/embed' && req.method === 'POST') {
			// the feed's pages only (or curl on this machine, which sends no Origin)
			if (origin && !ORIGINS.has(origin)) return send(403, { error: 'not from the feed' });
			let body = '';
			for await (const chunk of req) { body += chunk; if (body.length > 2e6) return send(413, { error: 'too much text' }); }
			const { model = 'nomic-embed-text', input } = JSON.parse(body);
			if (!/^[\w.:/-]{1,80}$/.test(model) || !Array.isArray(input) || input.length > 512 || input.some((t) => typeof t !== 'string'))
				return send(400, { error: 'want {model, input: [up to 512 texts]}' });
			return send(200, await embed(model, input.map((t) => t.slice(0, 2000))));
		}
		const media = url.pathname.match(/^\/media\/([\w.-]+)$/);
		if (media && req.method === 'GET') return send(200, await readFile(at(`media/${media[1]}`)), TYPES[media[1].split('.').pop()] ?? 'application/octet-stream');
		send(404, { error: 'not found' });
	} catch (e) {
		send(500, { error: e.message });
	}
}).listen(PORT, '127.0.0.1', () => console.log(`your pack: review at http://127.0.0.1:${PORT}, taste matching at /api/embed (Ctrl+C to stop)`));
