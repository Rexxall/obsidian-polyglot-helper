/**
 * Adding a word that is already in the word list: merge instead of overwrite. A meaning the user
 * has (possibly) edited stays; blanks are filled; example sentences and "收自 …" source lines
 * accumulate without duplicates, so the original context of every lookup is kept.
 */
export interface MergeableEntry {
	translation: string;
	notes?: string;
	examples?: string[];
	tags?: string[];
}

const MAX_EXAMPLES = 5;
const MAX_SOURCES = 3;

function sameText(a: string, b: string): boolean {
	return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

function uniquePush(list: string[], value: string, limit: number): string[] {
	const text = value.trim();
	if (!text || list.some((item) => sameText(item, text))) return list;
	return [text, ...list].slice(0, limit);
}

/** Lines in notes that record where a word was collected; the source part, not the date, decides sameness. */
function sourceKey(line: string): string {
	return line.replace(/·\s*\d{4}-\d{2}-\d{2}\s*$/, '').trim();
}

export function mergeVocabEntry<T extends MergeableEntry>(existing: T, incoming: MergeableEntry): T {
	const merged: T = { ...existing };
	if (!existing.translation?.trim() && incoming.translation?.trim()) merged.translation = incoming.translation;

	let examples = [...(existing.examples ?? [])];
	for (const example of [...(incoming.examples ?? [])].reverse()) examples = uniquePush(examples, example, MAX_EXAMPLES);
	merged.examples = examples;

	merged.tags = [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])];

	const oldLines = (existing.notes ?? '').split('\n').filter((line) => line.trim());
	const sources = oldLines.filter((line) => line.trim().startsWith('收自'));
	const others = oldLines.filter((line) => !line.trim().startsWith('收自'));
	for (const line of (incoming.notes ?? '').split('\n')) {
		const text = line.trim();
		if (!text) continue;
		if (text.startsWith('收自')) {
			if (!sources.some((source) => sourceKey(source) === sourceKey(text)) && sources.length < MAX_SOURCES) sources.push(text);
		} else if (!others.some((other) => sameText(other, text))) {
			others.push(text);
		}
	}
	merged.notes = [...sources, ...others].join('\n');
	return merged;
}
