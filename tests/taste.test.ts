import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/lib/taste.ts';

const day = 864e5, now = Date.UTC(2026, 10, 10);
const sig = (kind: T.Kind, card: string, ago = 0, secs?: number): T.Signal => ({ at: now - ago * day, kind, card, src: 's', title: card, text: card, secs });

test('weights: saves count most, ✕ most against, fresh signals at full weight', () => {
	assert.equal(T.signalWeight(sig('save', 'a'), now), 3);
	assert.equal(T.signalWeight(sig('notforme', 'a'), now), -3);
	assert.equal(T.signalWeight(sig('skip', 'a'), now), -0.3);
});

test('half-life: half after 14 days, a quarter after 28', () => {
	assert.ok(Math.abs(T.signalWeight(sig('save', 'a', 14), now) - 1.5) < 1e-9);
	assert.ok(Math.abs(T.signalWeight(sig('save', 'a', 28), now) - 0.75) < 1e-9);
});

test('dwell grows with time and is capped at 0.5 per card however often you look', () => {
	assert.equal(T.dwellWeight(0), 0);
	assert.ok(T.dwellWeight(5) < T.dwellWeight(30));
	assert.equal(T.dwellWeight(60), 0.5);
	assert.equal(T.dwellWeight(6000), 0.5);
	const [it] = T.cardWeights([sig('dwell', 'a', 0, 60), sig('dwell', 'a', 0, 60), sig('dwell', 'a', 0, 60)], now);
	assert.equal(it.w, 0.5);
});

test('a card adds its signals up; switched-off kinds are left out', () => {
	const s = [sig('save', 'a'), sig('open', 'a'), sig('skip', 'b'), sig('notforme', 'c')];
	const by = Object.fromEntries(T.cardWeights(s, now).map((x) => [x.card, x.w]));
	assert.deepEqual(by, { a: 4, b: -0.3, c: -3 });
	const off = T.cardWeights(s, now, { save: false, skip: false }).map((x) => x.card);
	assert.deepEqual(off.sort(), ['a', 'c']);
});

test('strongest keeps the biggest weights either way', () => {
	const items = [{ w: 0.1 }, { w: -3 }, { w: 2 }, { w: -0.2 }].map((x, i) => ({ ...x, card: String(i), title: '', text: '', src: '', kinds: [] }));
	assert.deepEqual(T.strongest(items, 2).map((x) => x.w), [-3, 2]);
});

test('score: closer to what you liked scores higher; lowered only when closer to what you turned down', () => {
	const tv = T.tasteVector([{ w: 3, v: [1, 0, 0] }, { w: -3, v: [0, 1, 0] }]);
	const liked = T.score([1, 0, 0], tv), disliked = T.score([0, 1, 0], tv), between = T.score([1, 1, 0], tv);
	assert.ok(liked.score > between.score && between.score > disliked.score);
	assert.equal(between.lowered, 0);
	assert.ok(disliked.lowered > 0);
});

test('taste vector weights by signal strength', () => {
	const tv = T.tasteVector([{ w: 3, v: [1, 0] }, { w: 1, v: [0, 1] }]);
	assert.ok(T.score([1, 0], tv).like > T.score([0, 1], tv).like);
});

test('drivers names the liked cards that pulled hardest', () => {
	const items = [{ w: 3, v: [1, 0], title: 'birds', kinds: ['save'] as T.Kind[] }, { w: 1, v: [0, 1], title: 'jazz', kinds: ['open'] as T.Kind[] }, { w: -3, v: [1, 0], title: 'nope', kinds: ['notforme'] as T.Kind[] }];
	const d = T.drivers([1, 0.1], items);
	assert.equal(d[0].title, 'birds');
	assert.ok(!d.some((x) => x.title === 'nope'));
	assert.equal(T.describe(d[0]), 'your save "birds"');
});

test('word vectors: same words match, plurals count as the same word', () => {
	assert.ok(T.cos(T.wordVec('Red-breasted geese birds'), T.wordVec('a bird')) > 0.4);
	assert.equal(T.cos(T.wordVec('jazz record'), T.wordVec('woodblock print')), 0);
});

test('written lines count ±2 and never fade', () => {
	const w = T.writtenItems(['birds'], ['war']);
	assert.deepEqual(w.map((x) => [x.w, x.fixed]), [[2, true], [-2, true]]);
});
