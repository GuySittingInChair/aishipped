// Edge-cached relay for the feed's slowest sources (iNaturalist, NASA APOD).
// Each (s, p) pair is one fixed batch, so the CDN can serve it to everyone instantly.
const SOURCES = {
	nature: {
		pages: 190,
		ttl: 86400,
		url: (p) => `https://api.inaturalist.org/v1/observations?quality_grade=research&photos=true&order_by=votes&per_page=50&page=${p + 1}`,
	},
	space: {
		pages: 30,
		ttl: 3600,
		url: () => `https://api.nasa.gov/planetary/apod?api_key=${process.env.NASA_KEY || 'DEMO_KEY'}&count=10&thumbs=true`,
	},
};

export async function GET(request) {
	const q = new URL(request.url).searchParams;
	const src = SOURCES[q.get('s')];
	const p = Number(q.get('p'));
	if (!src || !Number.isInteger(p) || p < 0 || p >= src.pages) return new Response('bad request', { status: 400 });
	const r = await fetch(src.url(p), { headers: { 'User-Agent': 'aishipped.lol feed' } });
	if (!r.ok) return new Response('upstream error', { status: 502, headers: { 'Cache-Control': 'no-store' } });
	return new Response(await r.text(), {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': `public, max-age=300, s-maxage=${src.ttl}, stale-while-revalidate=${src.ttl * 7}`,
		},
	});
}
