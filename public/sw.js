// Keeps the feed page, its snapshots and recent images on the device so return visits open instantly.
// Same-origin: serve from cache, refresh in the background. Images: cache first, capped.
const PAGES = 'feed-pages-v1';
const IMAGES = 'feed-images-v1';
const MAX_IMAGES = 400;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
	const req = e.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin === location.origin && !url.pathname.startsWith('/api/')) {
		e.respondWith(caches.open(PAGES).then(async (c) => {
			const hit = await c.match(req);
			const fresh = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
			if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
			return fresh;
		}));
	} else if (req.destination === 'image') {
		e.respondWith(caches.open(IMAGES).then(async (c) => {
			const hit = await c.match(req);
			if (hit) return hit;
			const r = await fetch(req);
			if (r.ok || r.type === 'opaque') {
				c.put(req, r.clone());
				c.keys().then((k) => k.slice(0, Math.max(0, k.length - MAX_IMAGES)).forEach((x) => c.delete(x)));
			}
			return r;
		}));
	}
});
