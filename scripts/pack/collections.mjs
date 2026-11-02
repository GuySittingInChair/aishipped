// The allowlist: the only parts of each archive the pack is built from. Anything outside these never gets
// downloaded. Each collection says how to fetch a page of it and how to turn one item into a card (the same
// card the feed draws; mappings follow src/pages/feed.astro).

const qs = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
export const strip = (h) => (h ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const INAT = 'https://api.inaturalist.org/v1/observations';
function inat(o, src) {
	const photo = o.photos?.[0];
	if (!photo || !o.taxon) return null;
	const t = o.taxon;
	return {
		id: `nature:${o.id}`, src,
		title: t.preferred_common_name ? t.preferred_common_name[0].toUpperCase() + t.preferred_common_name.slice(1) : t.name,
		sub: [t.preferred_common_name ? t.name : '', o.place_guess, o.observed_on].filter(Boolean).join(' · '),
		img: photo.url.replace('/square.', '/large.'), imgAlt: t.preferred_common_name || t.name,
		link: o.uri, linkText: 'inaturalist.org', credit: photo.attribution,
	};
}
function loc(r, src, what) {
	const img = [...(r.image_url ?? [])].reverse().find((u) => /\.(jpg|gif|png)/.test(u));
	if (!img || !r.title) return null;
	return {
		id: `loc:${r.id}`, src,
		title: r.title.replace(/^\[|\]$/g, ''),
		sub: [r.date?.slice(0, 4), r.location?.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
		body: [r.description].flat().filter(Boolean).join(' '),
		img: img.split('#')[0], imgAlt: r.title, link: r.url, linkText: 'loc.gov', credit: `Library of Congress · ${what}`,
	};
}
function archive(r, src, kind) {
	if (!r?.title || /^\d+$/.test(r.title)) return null;
	const who = [r.creator].flat().filter(Boolean).join(', ');
	return {
		id: `${kind === 'film' ? 'film' : 'rec'}:${r.identifier}`, src,
		title: [r.title].flat()[0],
		sub: [who, r.year ?? r.date?.slice?.(0, 4), kind === 'film' ? 'Prelinger Archives' : '78rpm'].filter(Boolean).join(' · '),
		body: r.description ? strip([r.description].flat().join(' ')) : undefined,
		img: `https://archive.org/services/img/${r.identifier}`, imgAlt: kind === 'film' ? r.title : `record label: ${r.title}`,
		embed: `https://archive.org/embed/${r.identifier}?autoplay=1`,
		link: `https://archive.org/details/${r.identifier}`, linkText: 'archive.org',
		credit: kind === 'film' ? 'Internet Archive · public domain' : 'Internet Archive · Great 78 Project',
	};
}
const records = (subject) => ({
	url: (p) => `https://archive.org/advancedsearch.php?${qs({ q: `collection:georgeblood AND subject:(${subject})`, rows: 40, page: p, output: 'json' })}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=date`,
	list: (d) => d.response?.docs ?? [],
});

// the Met has no working search for a department any more, so: every object id in the department, sampled
async function metSample(dept, n, test) {
	const ids = (await (await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects?departmentIds=${dept}`)).json()).objectIDs ?? [];
	const out = [];
	for (let tries = 0; out.length < n && tries < n * 6; tries++) {
		const o = await (await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${ids[Math.floor(Math.random() * ids.length)]}`)).json().catch(() => null);
		if (o?.isPublicDomain && o.primaryImageSmall && o.title && test(o)) out.push(o);
	}
	return out;
}
const met = (o, src) => ({
	id: `met:${o.objectID}`, src, title: o.title,
	sub: [o.artistDisplayName, o.objectDate, o.culture].filter(Boolean).join(' · '),
	body: [o.medium, o.classification].filter(Boolean).join(' · '),
	img: o.primaryImageSmall, imgAlt: o.title, link: o.objectURL, linkText: 'metmuseum.org',
	credit: 'The Metropolitan Museum of Art · public domain',
});

export const UA = { 'User-Agent': 'aishipped-pack/1.0 (https://aishipped.lol; a personal offline pack)' };
export const get = (u, ms = 90000) => fetch(u, { headers: UA, signal: AbortSignal.timeout(ms) }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${u}`); return r; });

export const COLLECTIONS = {
	// nature
	birds: { group: 'nature', name: 'birds (iNaturalist, most-loved photos)', pages: 100,
		url: (p) => `${INAT}?${qs({ taxon_id: 3, quality_grade: 'research', photos: 'true', photo_license: 'cc0,cc-by,cc-by-sa,cc-by-nc', order_by: 'votes', per_page: 40, page: p })}`,
		list: (d) => d.results, card: (o) => inat(o, 'birds') },
	wildlife: { group: 'nature', name: 'wildlife (iNaturalist: mammals, reptiles, amphibians, insects)', pages: 100,
		url: (p) => `${INAT}?${qs({ iconic_taxa: 'Mammalia,Reptilia,Amphibia,Insecta', quality_grade: 'research', photos: 'true', photo_license: 'cc0,cc-by,cc-by-sa,cc-by-nc', order_by: 'votes', per_page: 40, page: p })}`,
		list: (d) => d.results, card: (o) => inat(o, 'wildlife') },
	botanical: { group: 'nature', name: 'botanical and scientific prints (Wellcome Collection)', pages: 13,
		url: (p) => `https://api.wellcomecollection.org/catalogue/v2/images?${qs({ query: 'botanical', pageSize: 40, page: p, 'locations.license': 'pdm,cc-0,cc-by' })}`,
		list: (d) => d.results,
		card: (r) => {
			const at = r.locations?.find((l) => /info\.json$/.test(l.url));
			if (!at || !r.source?.title) return null;
			const [title, ...rest] = r.source.title.split(/\.\s/);
			return { id: `wellcome:${r.id}`, src: 'botanical', title: title.slice(0, 160), body: rest.join('. ') || undefined,
				img: at.url.replace('/info.json', '/full/!900,900/0/default.jpg'), imgAlt: r.source.title.slice(0, 200),
				link: `https://wellcomecollection.org/works/${r.source.id}`, linkText: 'wellcomecollection.org', credit: 'Wellcome Collection' };
		} },
	// art and craft
	woodblock: { group: 'art', name: 'Japanese woodblock prints (Art Institute of Chicago)', pages: 100,
		url: (p) => `https://api.artic.edu/api/v1/artworks/search?q=woodblock%20print%20japan&query[term][is_public_domain]=true&fields=id,title,image_id,artist_display,date_display,medium_display&limit=40&page=${p}`,
		list: (d) => d.data,
		card: (a) => a.image_id ? { id: `art:${a.id}`, src: 'woodblock', title: a.title, sub: [a.artist_display?.split('\n')[0], a.date_display].filter(Boolean).join(' · '),
			body: a.medium_display, img: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`, imgAlt: a.title,
			link: `https://www.artic.edu/artworks/${a.id}`, linkText: 'artic.edu', credit: 'Art Institute of Chicago · public domain' } : null },
	metprints: { group: 'art', name: 'Asian prints (the Met)', sample: (n) => metSample(6, n, (o) => /print/i.test(o.classification ?? '')), card: (o) => met(o, 'metprints') },
	armour: { group: 'art', name: 'arms and armour (the Met)', sample: (n) => metSample(4, n, () => true), card: (o) => met(o, 'armour') },
	textiles: { group: 'art', name: 'textiles (V&A)', pages: 50,
		url: (p) => `https://api.vam.ac.uk/v2/objects/search?${qs({ q: 'textile', images_exist: 1, page_size: 40, page: p })}`,
		list: (d) => d.records,
		card: (r) => r._images?._iiif_image_base_url ? { id: `vam:${r.systemNumber}`, src: 'textiles', title: r._primaryTitle || r.objectType,
			sub: [r.objectType, r._primaryMaker?.name, r._primaryPlace, r._primaryDate].filter(Boolean).join(' · '),
			img: `${r._images._iiif_image_base_url}full/!900,900/0/default.jpg`, imgAlt: r._primaryTitle || r.objectType,
			link: `https://collections.vam.ac.uk/item/${r.systemNumber}/`, linkText: 'vam.ac.uk', credit: 'Victoria and Albert Museum, London' } : null },
	ceramics: { group: 'art', name: 'ceramics (Cleveland Museum of Art)', pages: 75,
		url: (p) => `https://openaccess-api.clevelandart.org/api/artworks/?${qs({ type: 'Ceramic', has_image: 1, cc0: 1, limit: 40, skip: (p - 1) * 40 })}`,
		list: (d) => d.data,
		card: (a) => a.images?.web?.url ? { id: `cma:${a.id}`, src: 'ceramics', title: a.title,
			sub: [a.creators?.[0]?.description, a.creation_date].filter(Boolean).join(' · '),
			body: [a.technique, a.wall_description || a.description || a.fun_fact].filter(Boolean).map(strip).join('\n'),
			img: a.images.web.url, imgAlt: a.title, link: a.url, linkText: 'clevelandart.org', credit: 'Cleveland Museum of Art · CC0' } : null },
	// old music and films
	jazz: { group: 'music', name: '78rpm jazz records', pages: 170, ...records('jazz'), card: (r) => archive(r, 'jazz', 'record') },
	folk: { group: 'music', name: '78rpm folk records', pages: 40, ...records('folk'), card: (r) => archive(r, 'folk', 'record') },
	classical: { group: 'music', name: '78rpm classical records', pages: 60, ...records('classical OR opera OR orchestra'), card: (r) => archive(r, 'classical', 'record') },
	films: { group: 'music', name: 'old films (Prelinger Archives)', pages: 260,
		url: (p) => `https://archive.org/advancedsearch.php?${qs({ q: 'collection:prelinger AND mediatype:movies', rows: 40, page: p, output: 'json' })}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=year`,
		list: (d) => d.response?.docs ?? [], card: (r) => archive(r, 'films', 'film') },
	// old photos, maps and books
	photochrom: { group: 'photos', name: 'colour photochroms, 1890s–1920s (Library of Congress)', pages: 600,
		url: (p) => `https://www.loc.gov/collections/detroit-publishing-company/?${qs({ fo: 'json', c: 40, sp: p })}`,
		list: (d) => d.results, card: (r) => loc(r, 'photochrom', 'Detroit Publishing Company') },
	maps: { group: 'photos', name: 'panoramic maps (Library of Congress)', pages: 37,
		url: (p) => `https://www.loc.gov/collections/panoramic-maps/?${qs({ fo: 'json', c: 40, sp: p })}`,
		list: (d) => d.results, card: (r) => loc(r, 'maps', 'panoramic maps') },
	books: { group: 'photos', name: 'classic books (Project Gutenberg, most read)', pages: 40,
		url: (p) => `https://gutendex.com/books/?page=${p}`,
		list: (d) => d.results,
		card: (b) => b?.title && b.formats?.['image/jpeg'] ? { id: `gut:${b.id}`, src: 'books', title: b.title,
			sub: (b.authors ?? []).map((a) => a.name.split(', ').reverse().join(' ')).join(', '),
			body: b.summaries?.[0] ? strip(b.summaries[0].replace(/\s*\(This is an automatically generated summary\.\)\s*/, '')) : undefined,
			img: b.formats['image/jpeg'], imgAlt: b.title, link: `https://www.gutenberg.org/ebooks/${b.id}`, linkText: 'read it free', credit: 'Project Gutenberg · public domain' } : null },
};
