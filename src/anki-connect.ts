import type { ExportCard } from './vocab-export';

/**
 * Sends the word list straight into Anki through the AnkiConnect add-on: one command, no file to
 * import. Chosen over writing Yanki-style Markdown notes, which would put one note per card in
 * the vault and still need the Yanki plugin and AnkiConnect to reach Anki.
 *
 * Cards are matched by the stable card id kept in a PolyglotId field, so sending again updates
 * the same notes (and keeps their review history) wherever they were moved, and adds only new ones.
 */

export const NOTE_TYPE = 'Polyglot Helper';
const FIELDS = ['Front', 'Back', 'Source', 'PolyglotId'] as const;
type Fields = Record<(typeof FIELDS)[number], string>;

export type Invoke = (action: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface SyncResult {
	added: number;
	updated: number;
	unchanged: number;
}

const CSS = `.card { font-family: -apple-system, "Hiragino Sans", "Noto Sans CJK JP", "PingFang SC", sans-serif; font-size: 22px; text-align: center; color: #1d1d1f; background: #fff; }
.front { font-size: 34px; }
.back { margin-top: 12px; line-height: 1.6; }
.source { margin-top: 16px; font-size: 14px; color: #86868b; }
.nightMode.card, .night_mode .card { color: #f5f5f7; background: #1c1c1e; }`;

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function cardFields(card: ExportCard, vaultName: string): Fields {
	const source = card.source
		? vaultName
			? `<a href="obsidian://open?vault=${encodeURIComponent(vaultName)}&amp;file=${encodeURIComponent(card.source)}">${escapeHtml(card.source)}</a>`
			: escapeHtml(card.source)
		: '';
	return { Front: escapeHtml(card.front), Back: escapeHtml(card.back), Source: source, PolyglotId: card.id };
}

async function ensureNoteType(invoke: Invoke) {
	const names = (await invoke('modelNames')) as string[];
	if (names.includes(NOTE_TYPE)) return;
	await invoke('createModel', {
		modelName: NOTE_TYPE,
		inOrderFields: [...FIELDS],
		css: CSS,
		cardTemplates: [
			{
				Name: 'Word',
				Front: '<div class="front">{{Front}}</div>',
				Back: '<div class="front">{{Front}}</div><hr id="answer"><div class="back">{{Back}}</div>{{#Source}}<div class="source">{{Source}}</div>{{/Source}}',
			},
		],
	});
}

interface NoteInfo {
	noteId: number;
	fields: Record<string, { value: string }>;
}

export async function syncToAnki(invoke: Invoke, cards: ExportCard[], deck: string, vaultName: string): Promise<SyncResult> {
	await invoke('version');
	await ensureNoteType(invoke);
	await invoke('createDeck', { deck });

	const noteIds = (await invoke('findNotes', { query: `"note:${NOTE_TYPE}"` })) as number[];
	const infos = noteIds.length ? ((await invoke('notesInfo', { notes: noteIds })) as NoteInfo[]) : [];
	const existing = new Map<string, NoteInfo>();
	for (const info of infos) {
		const id = info.fields?.PolyglotId?.value;
		if (id) existing.set(id, info);
	}

	const toAdd: Array<Record<string, unknown>> = [];
	const toUpdate: Array<Record<string, unknown>> = [];
	let unchanged = 0;
	for (const card of cards) {
		const fields = cardFields(card, vaultName);
		const note = existing.get(card.id);
		if (!note) {
			toAdd.push({
				deckName: deck,
				modelName: NOTE_TYPE,
				fields,
				tags: ['polyglot', ...card.tags.map((tag) => tag.replace(/\s+/g, '_'))],
				options: { allowDuplicate: true },
			});
		} else if (FIELDS.some((name) => (note.fields[name]?.value ?? '') !== fields[name])) {
			toUpdate.push({ action: 'updateNoteFields', params: { note: { id: note.noteId, fields } } });
		} else {
			unchanged++;
		}
	}

	if (toAdd.length) {
		const ids = (await invoke('addNotes', { notes: toAdd })) as Array<number | null>;
		const failed = ids.filter((id) => id === null).length;
		if (failed) throw new Error(`Anki refused ${failed} of ${toAdd.length} new cards`);
	}
	if (toUpdate.length) {
		const results = (await invoke('multi', { actions: toUpdate })) as Array<{ error?: string | null } | null>;
		const error = results.find((r) => r && typeof r === 'object' && r.error)?.error;
		if (error) throw new Error(error);
	}
	return { added: toAdd.length, updated: toUpdate.length, unchanged };
}

/** AnkiConnect's request shape: {action, version, params} in, {result, error} out. */
export function ankiConnectInvoke(post: (body: string) => Promise<unknown>): Invoke {
	return async (action, params = {}) => {
		const reply = (await post(JSON.stringify({ action, version: 6, params }))) as { result?: unknown; error?: string | null } | null;
		if (!reply || typeof reply !== 'object' || !('result' in reply)) throw new Error('Not an AnkiConnect reply');
		if (reply.error) throw new Error(reply.error);
		return reply.result;
	};
}
