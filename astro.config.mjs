// @ts-check
import { defineConfig } from 'astro/config';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// The commit this build came from, written to /build.txt so anyone can look up GitHub's fingerprints for it
// (scripts/verify-live.mjs). Vercel and GitHub Actions both name the commit; a local build asks git.
const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
	|| (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'unknown'; } })();
const buildStamp = {
	name: 'build-stamp',
	hooks: { 'astro:build:done': ({ dir }) => writeFileSync(new URL('build.txt', dir), COMMIT + '\n') },
};

// The only servers the pages may fetch from: the public collections behind the feed, and Ollama on the
// visitor's own computer. Anything else (an injected tracker, a swapped-in script) is refused by the browser.
const API = [
	'https://en.wikipedia.org', 'https://*.wikipedia.org', 'https://commons.wikimedia.org', 'https://api.wikimedia.org',
	'https://www.wikidata.org', 'https://query.wikidata.org',
	'https://www.loc.gov', 'https://api.inaturalist.org', 'https://api.europeana.eu', 'https://api.vam.ac.uk',
	'https://api.wellcomecollection.org', 'https://openaccess-api.clevelandart.org', 'https://api.artic.edu',
	'https://collectionapi.metmuseum.org', 'https://gutendex.com', 'https://archive.org', 'https://openlibrary.org',
	'https://poetrydb.org', 'https://earthquake.usgs.gov', 'https://mastodon.social', 'https://hacker-news.firebaseio.com',
	'https://images-api.nasa.gov',
	'http://localhost:11434', 'http://127.0.0.1:11434',
	'http://127.0.0.1:8790',   // your own pack (scripts/pack/serve.mjs)
];

// https://astro.build/config
export default defineConfig({
	integrations: [buildStamp],
	// inline the CSS so the page paints without a second round trip
	build: { inlineStylesheets: 'always' },
	// and the script: one request for the whole page
	vite: { build: { assetsInlineLimit: 200_000 } },
	// Content Security Policy: only this site's own scripts and styles run (each pinned by its hash), so text
	// or code slipped into a museum API reply, a CDN or the network can't execute or phone home
	security: {
		csp: {
			algorithm: 'SHA-256',
			directives: [
				"default-src 'self'",
				`connect-src 'self' ${API.join(' ')}`,
				"img-src 'self' https: data: blob: http://127.0.0.1:8790",
				"media-src 'self' https: blob:",
				'frame-src https://archive.org',
				"font-src 'self'",
				"object-src 'none'",
				"base-uri 'none'",
				"form-action 'self'",
				"worker-src 'self'", // the feed's own offline cache (/sw.js)
				"manifest-src 'self'",
			],
			// style attributes can't run code; the homepage diagram uses them for its stagger
			styleDirective: { resources: [{ resource: "'unsafe-inline'", kind: 'attribute' }] },
		},
	},
});
