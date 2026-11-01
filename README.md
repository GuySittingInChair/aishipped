# aishipped.lol

An explainer on the attention economy, an opt-out checklist, and a feed that isn't farming you.
Astro, deployed by Vercel from `main`.

## Check that the live site is this source

Every file on aishipped.lol should be exactly what this repository builds to. You can check that without
trusting the site or Vercel:

```sh
git clone https://github.com/GuySittingInChair/aishipped && cd aishipped
node scripts/verify-live.mjs          # pages, scripts and feed data
node scripts/verify-live.mjs --all    # also the music files (~250 MB)
```

How it works:

1. The site names the commit it was built from at `/build.txt`.
2. On every commit to `main`, GitHub Actions builds the site itself (`.github/workflows/fingerprint.yml`),
   records the SHA-256 of every file, signs that list with GitHub's identity (Sigstore build provenance),
   and publishes it on the [`fingerprints`](https://github.com/GuySittingInChair/aishipped/tree/fingerprints/builds) branch.
3. The script downloads every file from the site and compares it with GitHub's list. Any file that was
   changed, added in transit or swapped at the host shows up as a mismatch.

The build is reproducible: it uses only what is in the repo. The feed's downloaded batches (`public/data`)
are refreshed weekly by `.github/workflows/snapshot.yml` and committed, screened against
`src/data/blocklist.txt`.

What this does not cover: `/api/src`, a small relay function that runs on Vercel and fetches from public
sources when the feed's built-in copies are missing. Its code is in `api/src.js`, but what it returns
can't be checked this way.

## Commands

| Command                            | Action                                              |
| :--------------------------------- | :-------------------------------------------------- |
| `npm install`                      | Install dependencies                                |
| `npm run dev`                      | Local dev server at `localhost:4321`                |
| `npm run build`                    | Build to `./dist/` (offline, from the repo only)    |
| `npm run snapshot`                 | Re-download the feed's batches into `public/data`   |
| `npm run verify`                   | Check the live site against GitHub's fingerprints   |
