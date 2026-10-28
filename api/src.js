// Edge-cached relay for the feed's slowest sources (iNaturalist, NASA APOD).
// Each (s, p) pair is one fixed batch, so the CDN can serve it to everyone instantly.
export const SOURCES = {
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
	const body = src.trim ? JSON.stringify(src.trim(await r.json())) : await r.text();
	return new Response(body, {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'public, max-age=300',
			'Vercel-CDN-Cache-Control': `max-age=${src.ttl}, stale-while-revalidate=${src.ttl * 7}`,
		},
	});
}
