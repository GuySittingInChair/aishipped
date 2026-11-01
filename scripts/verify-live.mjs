// Check that the live site is exactly what the public source builds to, without trusting the site itself.
//
//   node scripts/verify-live.mjs            pages, scripts and feed data (a few MB)
//   node scripts/verify-live.mjs --all      also the music files (~250 MB)
//
// It reads which commit the site says it is from /build.txt, fetches the fingerprints GitHub Actions made for
// that commit (from GitHub, not from the site), downloads every file from the site and compares SHA-256s.
// Needs Node 18 or newer and nothing else. Exit code 0 = every file matches.
import { createHash } from 'node:crypto';

const SITE = process.env.SITE ?? 'https://aishipped.lol';
const REPO = 'GuySittingInChair/aishipped';
const all = process.argv.includes('--all');
const MEDIA = /\.(mp3|ogg|flac|wav|m4a|mp4|webm|zip)$/i;

const get = async (url) => {
	const r = await fetch(url, { cache: 'no-store', redirect: 'follow' });
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	return Buffer.from(await r.arrayBuffer());
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

const commit = (await get(`${SITE}/build.txt`)).toString().trim();
console.log(`${SITE} says it was built from commit ${commit}`);
if (!/^[0-9a-f]{40}$/.test(commit)) { console.log('that is not a commit id: cannot verify'); process.exit(2); }

let manifest;
try { manifest = JSON.parse((await get(`https://raw.githubusercontent.com/${REPO}/fingerprints/builds/${commit}.json`)).toString()); }
catch { console.log(`GitHub has no fingerprints for that commit (yet: the workflow takes a few minutes after a push).`); process.exit(2); }

// is the live site the newest commit, or an older one being replayed?
try {
	const head = JSON.parse((await get(`https://api.github.com/repos/${REPO}/commits/main`)).toString()).sha;
	console.log(head === commit ? 'that is the newest commit on main' : `note: main is now at ${head}; the site may not have redeployed yet`);
} catch { console.log('could not ask GitHub for the newest commit'); }

const paths = Object.keys(manifest.files).filter((p) => all || !MEDIA.test(p));
const url = (p) => `${SITE}/${p.replace(/(^|\/)index\.html$/, '$1')}`;
const bad = [];
let done = 0;
async function worker() {
	while (paths.length) {
		const p = paths.shift();
		try { if (sha(await get(url(p))) !== manifest.files[p]) bad.push(`changed: ${p}`); }
		catch (e) { bad.push(`could not fetch: ${p} (${e.message})`); }
		if (++done % 100 === 0) process.stdout.write(`  checked ${done}\r`);
	}
}
await Promise.all(Array.from({ length: 12 }, worker));

const skipped = Object.keys(manifest.files).length - done;
console.log(`checked ${done} files${skipped ? ` (skipped ${skipped} music files; add --all to include them)` : ''}`);
if (bad.length) { console.log(`MISMATCH: ${bad.length} file(s) differ from what GitHub built:`); for (const b of bad) console.log('  ' + b); process.exit(1); }
console.log('OK: every file the site serves matches what GitHub built from the public source.');
console.log(`To check GitHub's signature on the fingerprints too:\n  curl -sO https://raw.githubusercontent.com/${REPO}/fingerprints/builds/${commit}.json && gh attestation verify ${commit}.json --repo ${REPO}`);
