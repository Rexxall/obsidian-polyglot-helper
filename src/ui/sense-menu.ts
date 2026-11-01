import { Menu } from 'obsidian';
import { tr } from '../shared/i18n';
import { senseKeys } from '../vocab-senses';

interface Saved {
	translation: string;
}

function short(text: string): string {
	const one = text.replace(/\s+/g, ' ').trim();
	return one.length > 36 ? one.slice(0, 35) + '…' : one;
}

function same(a: string, b: string): boolean {
	return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

/**
 * A word that is already saved: add this sentence to one of its meanings, or keep it as a new
 * meaning with its own reviews. `candidates` are meanings from this lookup, the in-sentence one first.
 */
export function showSenseMenu(
	event: MouseEvent,
	store: Record<string, Saved>,
	base: string,
	candidates: string[],
	onPick: (target: string, translation: string) => void,
): void {
	const menu = new Menu();
	const saved = senseKeys(store, base).map((key) => ({ key, translation: store[key].translation || '' }));
	for (const sense of saved) {
		menu.addItem((item) =>
			item
				.setSection('saved')
				.setIcon('corner-down-right')
				.setTitle(tr(`加到「${short(sense.translation) || '未写释义'}」`, `Add to “${short(sense.translation) || 'no meaning yet'}”`))
				.onClick(() => onPick(sense.key, sense.translation)),
		);
	}
	const fresh = [...new Set(candidates.map((text) => text.trim()).filter(Boolean))]
		.filter((text) => !saved.some((sense) => same(sense.translation, text)))
		.slice(0, 3);
	for (const text of fresh) {
		menu.addItem((item) =>
			item
				.setSection('new')
				.setIcon('plus')
				.setTitle(tr(`新义项「${short(text)}」`, `New meaning “${short(text)}”`))
				.onClick(() => onPick('new', text)),
		);
	}
	menu.showAtMouseEvent(event);
}
