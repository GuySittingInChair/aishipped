// Your signals: what you did with each card, kept in this browser's own database (IndexedDB) and nowhere else.
// The feed writes them; /signals shows every one and lets you switch kinds off or delete them.
import type { Kind, Signal } from './taste';

const DB = 'aishipped', STORE = 'signals', ON_KEY = 'aishipped.signals.on';
export const KINDS: Kind[] = ['save', 'more', 'open', 'dwell', 'skip', 'notforme'];

let dbp: Promise<IDBDatabase | null> | null = null;
const open = () => (dbp ??= new Promise((res) => {
	try {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => {
			const s = r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
			s.createIndex('card', 'card');
		};
		r.onsuccess = () => res(r.result);
		r.onerror = () => res(null);
		r.onblocked = () => res(null);
	} catch { res(null); }
}));
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
	const db = await open();
	if (!db) return null;
	try { return await req(f(db.transaction(STORE, mode).objectStore(STORE))); } catch { return null; }
}

// which kinds are recorded and used: all of them unless you switch one off on /signals
export const loadOn = (): Record<Kind, boolean> => {
	let s: Partial<Record<Kind, boolean>> = {};
	try { s = JSON.parse(localStorage.getItem(ON_KEY) || '{}') ?? {}; } catch {}
	return Object.fromEntries(KINDS.map((k) => [k, s[k] !== false])) as Record<Kind, boolean>;
};
export const storeOn = (on: Record<Kind, boolean>) => { try { localStorage.setItem(ON_KEY, JSON.stringify(on)); } catch {} };

export const add = async (s: Signal) => (await tx('readwrite', (st) => st.add(s))) as number | null;
export const all = async () => ((await tx('readonly', (st) => st.getAll())) ?? []) as Signal[];
export const remove = (id: number) => tx('readwrite', (st) => st.delete(id));
export const clear = () => tx('readwrite', (st) => st.clear());
export async function removeWhere(keep: (s: Signal) => boolean) {
	const gone = (await all()).filter((s) => !keep(s));
	for (const s of gone) await remove(s.id!);
	return gone.length;
}
export const forgetDatabase = () => new Promise<void>((res) => {
	try { dbp = null; const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); }
});

// the feed and the signals page tell each other when something changed, so both stay current
const chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel('aishipped.signals') : null;
export const changed = () => chan?.postMessage('changed');
export const onChange = (f: () => void) => chan?.addEventListener('message', f);
