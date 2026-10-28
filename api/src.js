// Edge-cached relay for the feed's slowest sources (iNaturalist, NASA APOD).
// Each (s, p) pair is one fixed batch, so the CDN can serve it to everyone instantly.
const DAY0 = Date.UTC(2016, 0, 1);
const ymd = (p) => new Date(DAY0 + p * 864e5).toISOString().slice(0, 10);
const page = (x) => x && { title: x.title, titles: x.titles && { normalized: x.titles.normalized }, description: x.description, extract: x.extract, pageid: x.pageid, thumbnail: x.thumbnail && { source: x.thumbnail.source }, content_urls: x.content_urls && { desktop: { page: x.content_urls.desktop?.page } } };

const PREFIXES = 'ABCDEFGHIJKLMNOPRSTUVWZ'.split('').flatMap((a) => 'aeioulnr'.split('').map((b) => a + b));
const SUBJECTS = ['love', 'science_fiction', 'fantasy', 'mystery', 'history', 'poetry', 'philosophy', 'adventure', 'astronomy', 'animals', 'cooking', 'mathematics', 'music', 'art', 'travel', 'humor', 'biography', 'psychology', 'ocean', 'architecture', 'gardening', 'myths', 'physics', 'short_stories'];
const NASA_Q = ['nebula', 'galaxy', 'aurora', 'saturn', 'jupiter', 'mars surface', 'apollo', 'space shuttle launch', 'earth from orbit', 'hubble', 'webb', 'astronaut spacewalk', 'moon', 'comet', 'solar flare', 'hurricane from space', 'iss', 'rover', 'x-15', 'wind tunnel', 'supernova', 'star cluster'];
const meta = (m = {}) => Object.fromEntries(['ImageDescription', 'DateTimeOriginal', 'Artist', 'LicenseShortName'].filter((k) => m[k]).map((k) => [k, { value: m[k].value }]));

const VAM_Q = ['pattern', 'poster', 'textile', 'ceramic', 'jewellery', 'dress', 'tile', 'wallpaper', 'kimono', 'teapot', 'chair', 'tapestry', 'mask', 'glass', 'illustration', 'photograph', 'shoe', 'silk', 'map', 'clock', 'dragon', 'bird', 'flower', 'ship', 'theatre', 'toy'];
const WELLCOME_Q = ['botany', 'anatomy', 'astronomy', 'alchemy', 'insects', 'skeleton', 'microscope', 'phrenology', 'herbal', 'zoology', 'brain', 'eye', 'heart', 'mushroom', 'plague', 'pharmacy', 'tattoo', 'dream', 'magic', 'moon', 'ocean', 'birds'];

const EU_Q = ['painting', 'map', 'manuscript', 'poster', 'photograph', 'costume', 'botanical', 'ship', 'castle', 'portrait', 'landscape', 'folk art', 'jewellery', 'bird', 'bicycle', 'carnival', 'calligraphy', 'mosaic', 'astronomy', 'music instrument', 'sculpture', 'fashion', 'textile', 'window'];

const wikiRandom = (host) => `${host}/w/api.php?action=query&format=json&generator=random&grnnamespace=0&grnlimit=30&prop=extracts|pageimages|description&exintro=1&explaintext=1&exlimit=20&pithumbsize=800`;
const wikiTrim = (d) => ({ query: { pages: Object.values(d.query?.pages ?? {}).map((x) => ({ pageid: x.pageid, title: x.title, description: x.description, extract: x.extract, thumbnail: x.thumbnail && { source: x.thumbnail.source } })) } });

export const SOURCES = {
	random: { pages: 60, ttl: 3600, url: () => wikiRandom('https://en.wikipedia.org'), trim: wikiTrim },
	travel: { pages: 60, ttl: 3600, url: () => wikiRandom('https://en.wikivoyage.org'), trim: wikiTrim },
	europe: {
		pages: EU_Q.length * 4,
		ttl: 86400 * 7,
		url: (p) => `https://api.europeana.eu/record/v2/search.json?query=${encodeURIComponent(EU_Q[p % EU_Q.length])}&wskey=api2demo&rows=24&start=${1 + Math.floor(p / EU_Q.length) * 100}&media=true&reusability=open&qf=TYPE:IMAGE`,
		trim: (d) => ({ items: (d.items ?? []).map((i) => ({ id: i.id, title: i.title?.slice(0, 1).map((t) => t.slice(0, 300)), edmPreview: i.edmPreview, dcCreator: i.dcCreator?.slice(0, 1), year: i.year, country: i.country, guid: i.guid, dataProvider: i.dataProvider, rights: i.rights })) }),
	},
	design: {
		pages: VAM_Q.length * 2,
		ttl: 86400 * 7,
		url: (p) => `https://api.vam.ac.uk/v2/objects/search?q=${VAM_Q[p % VAM_Q.length]}&images_exist=1&page_size=20&page=${1 + Math.floor(p / VAM_Q.length)}`,
		trim: (d, p) => ({ q: VAM_Q[p % VAM_Q.length], records: d.records.map((r) => ({ systemNumber: r.systemNumber, objectType: r.objectType, _primaryTitle: r._primaryTitle, _primaryMaker: r._primaryMaker && { name: r._primaryMaker.name }, _primaryPlace: r._primaryPlace, _primaryDate: r._primaryDate, _images: { _iiif_image_base_url: r._images?._iiif_image_base_url } })) }),
	},
	curious: {
		pages: WELLCOME_Q.length,
		ttl: 86400 * 7,
		url: (p) => `https://api.wellcomecollection.org/catalogue/v2/images?query=${WELLCOME_Q[p]}&pageSize=40&locations.license=pdm,cc-0,cc-by`,
		trim: (d, p) => ({ q: WELLCOME_Q[p], results: d.results.map((r) => ({ id: r.id, source: r.source, locations: r.locations?.filter((l) => /info\.json$/.test(l.url)).slice(0, 1).map((l) => ({ url: l.url, license: { label: l.license?.label } })) })) }),
	},
	art: {
		pages: 2050,
		ttl: 86400 * 7,
		url: (p) => `https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=20&skip=${p * 20}`,
		trim: (d) => ({ data: d.data.map((a) => ({
			id: a.id, title: a.title, url: a.url, creation_date: a.creation_date, technique: a.technique,
			wall_description: a.wall_description, description: a.description, fun_fact: a.fun_fact,
			images: a.images?.web && { web: { url: a.images.web.url } },
			creators: a.creators?.slice(0, 1).map((c) => ({ id: c.id, description: c.description })),
		})) }),
	},
	photos: {
		pages: PREFIXES.length,
		ttl: 86400 * 7,
		url: (p) => `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=Category:Featured_pictures_on_Wikimedia_Commons&gcmtype=file&gcmlimit=20&gcmstartsortkeyprefix=${PREFIXES[p]}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800`,
		trim: (d) => ({ query: { pages: Object.values(d.query?.pages ?? {}).map((x) => ({
			pageid: x.pageid, title: x.title,
			imageinfo: x.imageinfo?.slice(0, 1).map((i) => ({ thumburl: i.thumburl, descriptionurl: i.descriptionurl, extmetadata: meta(i.extmetadata) })),
		})) } }),
	},
	books: {
		pages: SUBJECTS.length * 15,
		ttl: 86400 * 7,
		url: (p) => `https://openlibrary.org/subjects/${SUBJECTS[p % SUBJECTS.length]}.json?limit=20&offset=${Math.floor(p / SUBJECTS.length) * 20}`,
		trim: (d, p) => ({ subject: SUBJECTS[p % SUBJECTS.length], works: d.works.map((w) => ({ key: w.key, title: w.title, cover_id: w.cover_id, authors: w.authors?.map((a) => ({ name: a.name })), first_publish_year: w.first_publish_year, has_fulltext: w.has_fulltext })) }),
	},
	nasa: {
		pages: NASA_Q.length * 3,
		ttl: 86400 * 7,
		url: (p) => `https://images-api.nasa.gov/search?q=${encodeURIComponent(NASA_Q[p % NASA_Q.length])}&media_type=image&page=${1 + Math.floor(p / NASA_Q.length)}`,
		trim: (d) => ({ collection: { items: d.collection.items.slice(0, 30).map((i) => ({ links: i.links?.slice(0, 1).map((l) => ({ href: l.href })), data: i.data.slice(0, 1).map((m) => ({ nasa_id: m.nasa_id, title: m.title, date_created: m.date_created, center: m.center, description: m.description?.slice(0, 1200), photographer: m.photographer, secondary_creator: m.secondary_creator })) })) } }),
	},
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
	const r = await fetch(src.url(p), { headers: { 'User-Agent': 'aishipped-feed/1.0 (https://aishipped.lol; build snapshot)' }, signal: AbortSignal.timeout(25000) });
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
