// Private mode's picture relay: the feed asks this site for a picture, this site fetches it from the museum
// or library, so the museum sees Vercel's address instead of the visitor's. Only the image servers below,
// only pictures, at most 8 MB, cached on the CDN for a week. Anything else is refused, so it can't be used
// as a general-purpose proxy.
const HOSTS = new Set([
	'upload.wikimedia.org', 'thumb.wikimedia.org',
	'tile.loc.gov',
	'inaturalist-open-data.s3.amazonaws.com', 'static.inaturalist.org',
	'iiif.wellcomecollection.org',
	'api.europeana.eu',
	'framemark.vam.ac.uk',
	'openaccess-cdn.clevelandart.org',
	'covers.openlibrary.org',
	'www.gutenberg.org',
	'images-assets.nasa.gov',
	'www.artic.edu',
]);
const MAX = 8 * 1024 * 1024;

export async function GET(request) {
	let u;
	try { u = new URL(new URL(request.url).searchParams.get('u') ?? ''); } catch { return new Response('bad url', { status: 400 }); }
	if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || u.username || u.password) return new Response('host not allowed', { status: 403 });
	let r;
	try {
		r = await fetch(u, { headers: { 'User-Agent': 'aishipped-feed/1.0 (https://aishipped.lol; private-mode image relay)' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
	} catch { return new Response('upstream timeout', { status: 504, headers: { 'Cache-Control': 'no-store' } }); }
	// a redirect must still land on an allowed image server
	if (!HOSTS.has(new URL(r.url).hostname)) return new Response('redirected off the list', { status: 403 });
	const type = r.headers.get('content-type') ?? '';
	if (!r.ok || !type.startsWith('image/')) return new Response('not a picture', { status: 502, headers: { 'Cache-Control': 'no-store' } });
	const len = Number(r.headers.get('content-length') ?? 0);
	if (len > MAX) return new Response('too big', { status: 413 });
	const body = await r.arrayBuffer();
	if (body.byteLength > MAX) return new Response('too big', { status: 413 });
	return new Response(body, {
		headers: {
			'Content-Type': type,
			'Cache-Control': 'public, max-age=86400',
			'Vercel-CDN-Cache-Control': 'max-age=604800, stale-while-revalidate=2592000',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'",
		},
	});
}
