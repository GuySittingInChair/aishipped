// Your taste, as arithmetic you can check. No state in here: the feed and the signals page both call these with
// what's stored in your browser. Tested in tests/taste.test.ts.

export type Kind = 'save' | 'more' | 'open' | 'dwell' | 'skip' | 'notforme';
export type Signal = { id?: number; at: number; kind: Kind; card: string; src: string; title: string; text: string; secs?: number; note?: string };

// How much each kind of signal counts toward your taste. Saves count most because they're the clearest thing
// you can say about a card; time on screen counts least, because what holds your eye isn't always what you want.
export const WEIGHT: Record<Kind, number> = { save: 3, more: 2, open: 1, dwell: 0.5, skip: -0.3, notforme: -3 };
export const HALF_LIFE_DAYS = 14;
export const DWELL_FULL_SECS = 60; // dwell's 0.5 is reached at a minute on screen and never goes higher
export const MAX_ITEMS = 300; // the strongest cards from your signals that make up your taste

const DAY = 864e5;
export const decay = (at: number, now: number) => 0.5 ** (Math.max(0, now - at) / (HALF_LIFE_DAYS * DAY));
export const dwellWeight = (secs: number) => WEIGHT.dwell * Math.min(1, Math.log1p(Math.max(0, secs)) / Math.log1p(DWELL_FULL_SECS));
export const baseWeight = (s: Pick<Signal, 'kind' | 'secs'>) => (s.kind === 'dwell' ? dwellWeight(s.secs ?? 0) : WEIGHT[s.kind]);
export const signalWeight = (s: Signal, now: number) => baseWeight(s) * decay(s.at, now);

export type Item = { card: string; title: string; text: string; src: string; w: number; kinds: Kind[]; fixed?: boolean };

// One entry per card: its signals added up, dwell capped at its 0.5 however often you looked at it, recent
// signals counting more than old ones. Kinds that are switched off are left out.
export function cardWeights(signals: Signal[], now: number, on: Partial<Record<Kind, boolean>> = {}): Item[] {
	const by = new Map<string, Item & { dwell: number }>();
	for (const s of signals) {
		if (on[s.kind] === false) continue;
		let it = by.get(s.card);
		if (!it) by.set(s.card, (it = { card: s.card, title: s.title, text: s.text, src: s.src, w: 0, dwell: 0, kinds: [] }));
		const w = signalWeight(s, now);
		if (s.kind === 'dwell') it.dwell += w;
		else it.w += w;
		if (!it.kinds.includes(s.kind)) it.kinds.push(s.kind);
	}
	return [...by.values()]
		.map(({ dwell, ...it }) => ({ ...it, w: it.w + Math.min(dwell, WEIGHT.dwell) }))
		.filter((it) => Math.abs(it.w) > 1e-3);
}

// what you wrote under "more of this" and "less of this" counts like a more-like-this press that never fades
export const writtenItems = (want: string[], less: string[]): Item[] => [
	...want.map((t) => ({ card: `want:${t}`, title: t, text: t, src: 'you wrote', w: WEIGHT.more, kinds: [] as Kind[], fixed: true })),
	...less.map((t) => ({ card: `less:${t}`, title: t, text: t, src: 'you wrote', w: -WEIGHT.more, kinds: [] as Kind[], fixed: true })),
];

// the strongest ones, liked and disliked, so one long session of skipping can't push out your saves
export const strongest = (items: Item[], n = MAX_ITEMS) => [...items].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, n);

export type Vec = ArrayLike<number>;
export const dot = (a: Vec, b: Vec) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };
export const norm = (a: Vec) => Math.sqrt(dot(a, a));
export const cos = (a: Vec, b: Vec) => dot(a, b) / (norm(a) * norm(b) || 1);

export type TasteVec = { pos: Float64Array | null; neg: Float64Array | null; posW: number; negW: number };
// Two averages of the cards' meanings: what you liked (weighted by how much) and what you didn't
export function tasteVector(items: { w: number; v: Vec }[]): TasteVec {
	const dim = items[0]?.v.length ?? 0;
	const pos = new Float64Array(dim), neg = new Float64Array(dim);
	let posW = 0, negW = 0;
	for (const { w, v } of items) {
		const n = norm(v) || 1, into = w > 0 ? pos : neg, k = Math.abs(w) / n;
		for (let i = 0; i < dim; i++) into[i] += k * v[i];
		if (w > 0) posW += w; else negW -= w;
	}
	return { pos: posW ? pos.map((x) => x / posW) : null, neg: negW ? neg.map((x) => x / negW) : null, posW, negW };
}

// A card's score: how alike it is to what you liked, lowered only by how much closer it is to what you turned
// down. (The model finds every pair of texts a little alike, so "a bit like something I skipped" alone isn't
// held against a card.)
export function score(v: Vec, t: TasteVec) {
	const like = t.pos ? cos(v, t.pos) : 0;
	const unlike = t.neg ? cos(v, t.neg) : 0;
	const lowered = t.neg ? Math.max(0, unlike - like) : 0;
	return { score: like - lowered, like, unlike, lowered };
}

// which of your cards pulled this one up the most: weight times likeness, liked cards only
export function drivers(v: Vec, items: { w: number; v: Vec; title: string; kinds: Kind[]; fixed?: boolean }[], k = 2) {
	return items
		.filter((x) => x.w > 0)
		.map((x) => ({ title: x.title, kinds: x.kinds, fixed: x.fixed, sim: cos(v, x.v), pull: x.w * cos(v, x.v) }))
		.sort((a, b) => b.pull - a.pull)
		.slice(0, k);
}

// Without a model: words. Each word is hashed into one of 1024 slots, so the same arithmetic works on it.
const STOP = new Set('the a an and or of in on at to for with from by is are was were be this that it its as into over under old new'.split(' '));
const stem = (w: string) => (w.length < 4 ? w : w.replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1'));
export const words = (t: string) => [...new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
export function wordVec(t: string, dim = 1024) {
	const v = new Float64Array(dim);
	for (const w of words(t)) {
		let h = 2166136261;
		for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
		v[(h >>> 0) % dim] += 1;
	}
	return v;
}

export const KIND_LABEL: Record<Kind, string> = { save: 'save', more: 'more-like-this', open: 'link open', dwell: 'time on screen', skip: 'fast skip', notforme: 'not for me' };
export const describe = (x: { title: string; kinds: Kind[]; fixed?: boolean }) => {
	const t = x.title.length > 40 ? x.title.slice(0, 40) + '…' : x.title;
	if (x.fixed) return `you wrote "${t}"`;
	const best = (['save', 'more', 'open', 'dwell'] as Kind[]).find((k) => x.kinds.includes(k));
	return `your ${best ? KIND_LABEL[best] : 'signal'} "${t}"`;
};
