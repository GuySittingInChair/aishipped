// Edge-cached relay for the feed's slowest sources (iNaturalist, NASA APOD).
// Each (s, p) pair is one fixed batch, so the CDN can serve it to everyone instantly.
const DAY0 = Date.UTC(2016, 0, 1);
const ymd = (p) => new Date(DAY0 + p * 864e5).toISOString().slice(0, 10);
const page = (x) => x && { title: x.title, titles: x.titles && { normalized: x.titles.normalized }, description: x.description, extract: x.extract, pageid: x.pageid, thumbnail: x.thumbnail && { source: x.thumbnail.source }, content_urls: x.content_urls && { desktop: { page: x.content_urls.desktop?.page } } };

export const SOURCES = {
	featured: {
		pages: 3900,
		ttl: 86400 * 30,
		url: (p) => `https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd(p).replace(/-/g, '/')}`,
		trim: (d, p) => ({
			date: ymd(p),
			tfa: page(d.tfa),
			image: d.image && { title: d.image.title, thumbnail: d.image.thumbnail, file_page: d.image.file_page, description: d.image.description, artist: d.image.artist && { text: d.image.artist.text }, license: d.image.license && { type: d.image.license.type } },
			onthisday: d.onthisday?.map((e) => ({ year: e.year, text: e.text, pages: e.pages?.slice(0, 3).map(page) })),
			dyk: d.dyk?.map((y) => ({ html: y.html, text: y.text })),
		}),
	},
	history: {
		pages: 2000,
		ttl: 86400 * 7,
		url: (p) => `https://www.loc.gov/photos/?fo=json&c=25&sp=${p + 1}&fa=online-format:image`,
		trim: (d) => ({ results: d.results.map((r) => ({ id: r.id, title: r.title, date: r.date, location: r.location, description: r.description, image_url: r.image_url, url: r.url })) }),
	},
	nature: {
		pages: 190,
		ttl: 86400,
		// keep only what the cards use: ~1 MB down to ~30 KB
		trim: (d) => ({
			results: d.results.map((o) => ({
				id: o.id, uri: o.uri, place_guess: o.place_guess, observed_on: o.observed_on,
				taxon: o.taxon && { id: o.taxon.id, name: o.taxon.name, preferred_common_name: o.taxon.preferred_common_name, wikipedia_url: o.taxon.wikipedia_url },
				photos: o.photos?.slice(0, 1).map((ph) => ({ url: ph.url, attribution: ph.attribution })),
			})),
		}),
		url: (p) => `https://api.inaturalist.org/v1/observations?quality_grade=research&photos=true&order_by=votes&per_page=50&page=${p + 1}`,
	},
	space: {
		pages: 30,
		ttl: 3600,
		url: () => `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_KEY || 'DEMO_KEY'}&count=10&thumbs=true`,
	},
};

export async function GET(request) {
	try { return await relay(request); } catch {
		return new Response('upstream timeout', { status: 504, headers: { 'Cache-Control': 'no-store' } });
	}
}

async function relay(request) {
	const q = new URL(request.url).searchParams;
	const src = SOURCES[q.get('s')];
	const p = Number(q.get('p'));
	if (!src || !Number.isInteger(p) || p < 0 || p >= src.pages) return new Response('bad request', { status: 400 });
	const r = await fetch(src.url(p), { headers: { 'User-Agent': 'aishipped.lol feed' }, signal: AbortSignal.timeout(25000) });
	if (!r.ok) return new Response('upstream error', { status: 502, headers: { 'Cache-Control': 'no-store' } });
	const body = src.trim ? JSON.stringify(src.trim(await r.json(), p)) : await r.text();
	return new Response(body, {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'public, max-age=300',
			'Vercel-CDN-Cache-Control': `max-age=${src.ttl}, stale-while-revalidate=${src.ttl * 7}`,
		},
	});
}
