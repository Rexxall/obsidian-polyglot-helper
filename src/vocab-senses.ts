/**
 * One word can mean different things in different sentences ("culture" in a lab note and in an
 * essay). Each meaning is its own entry with its own review schedule: the first keeps the word's
 * key, the next ones are stored as "key#2", "key#3". Every entry also carries a stable id that
 * exports use, so re-exporting updates the same card instead of adding a new one.
 */

export interface SenseEntry {
	id?: string;
	translation: string;
	createdAt: number;
	examples?: string[];
}

const SENSE_SUFFIX = /#(\d+)$/;

/** FNV-1a, twice with different seeds: short, stable across devices, no crypto needed. */
function hash(text: string, seed: number): string {
	let h = seed >>> 0;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(36).padStart(7, '0');
}

/** The same entry gets the same id on every device, so two synced copies migrate alike. */
export function stableId(kind: 'en' | 'ja', key: string, createdAt: number): string {
	const text = `${kind}|${key}|${createdAt}`;
	return `pg-${hash(text, 0x811c9dc5)}${hash(text, 0x01000193)}`;
}

/** Adds ids to entries that have none. Returns how many were added. */
export function ensureIds(store: Record<string, SenseEntry>, kind: 'en' | 'ja'): number {
	let added = 0;
	for (const [key, item] of Object.entries(store)) {
		if (item.id) continue;
		item.id = stableId(kind, key, item.createdAt || 0);
		added++;
	}
	return added;
}

export function baseKey(key: string): string {
	return key.replace(SENSE_SUFFIX, '');
}

/** Keys of every meaning saved for this word, first meaning first. */
export function senseKeys(store: Record<string, unknown>, base: string): string[] {
	return Object.keys(store)
		.filter((key) => key === base || baseKey(key) === base)
		.sort((a, b) => Number(a.match(SENSE_SUFFIX)?.[1] ?? 1) - Number(b.match(SENSE_SUFFIX)?.[1] ?? 1));
}

export function nextSenseKey(store: Record<string, unknown>, base: string): string {
	if (!(base in store)) return base;
	let n = 2;
	while (`${base}#${n}` in store) n++;
	return `${base}#${n}`;
}

/** Where an entry lives in its store; by identity first, then by id. */
export function keyOf<T extends SenseEntry>(store: Record<string, T>, item: T): string | undefined {
	for (const [key, value] of Object.entries(store)) if (value === item) return key;
	if (!item.id) return undefined;
	for (const [key, value] of Object.entries(store)) if (value.id === item.id) return key;
	return undefined;
}

/** The sense number shown to the user: 1 for the word's own key, 2 for "#2" and so on. */
export function senseNumber(key: string): number {
	return Number(key.match(SENSE_SUFFIX)?.[1] ?? 1);
}
