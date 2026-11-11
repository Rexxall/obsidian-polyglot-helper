import type { EnglishVocabularyItem, JapaneseVocabularyItem } from './types';
import { isFunctionWord } from './function-words';

/**
 * Finds saved words in running text, for highlighting while reading.
 *
 * One character trie over every saved word, built once per word-list change and reused for
 * every rendered section, so a long article costs one pass over its text. HiWords matches only
 * the exact saved form; here a Japanese verb or adjective also matches its conjugated forms
 * (食べる → 食べた, 書く → 書いて, 新しい → 新しかった) and an English word its common inflections
 * (study → studies, make → making), because reading text rarely uses the dictionary form.
 */

export interface SavedWord {
	/** The word as saved, shown on the hover card. */
	word: string;
	reading: string;
	meaning: string;
	/** Note the word was saved from, without extension. */
	source: string;
	japanese: boolean;
}

export interface WordMatch {
	from: number;
	to: number;
	words: SavedWord[];
}

/** What may follow a trie hit for it to count. */
type Tail =
	| { kind: 'ja' } // exact Japanese form: no boundary in Japanese text
	| { kind: 'ja-stem'; next: RegExp } // conjugation stem: the next character must fit the ending
	| { kind: 'en'; suffixes: string[] }; // English: a word boundary, optionally after an inflection

interface Entry {
	tail: Tail;
	key: string;
}

class Node {
	children = new Map<string, Node>();
	entries: Entry[] = [];
}

const KANJI = /\p{Script=Han}/u;
const LETTER = /[\p{L}\p{N}]/u;
const HIRAGANA = /^\p{Script=Hiragana}/u;

/** Godan endings: the stem may be followed by the ending's own row, or the euphonic い／っ／ん. */
const GODAN: Record<string, string> = {
	'う': 'わいうえおっ',
	'く': 'かきくけこい',
	'ぐ': 'がぎぐげごい',
	'す': 'さしすせそ',
	'つ': 'たちつてとっ',
	'ぬ': 'なにぬねのん',
	'ぶ': 'ばびぶべぼん',
	'む': 'まみむめもん',
};
/** い-adjective endings after the stem: 新しい・新しく・新しかった・新しければ・新しさ・新しそう. */
const ADJECTIVE = 'いくかけさそ';

function oneLine(value: string | undefined): string {
	return (value || '').replace(/\s*\n\s*/g, ' ').trim();
}

function sourceNote(notes: string | undefined): string {
	const line = (notes || '').split('\n').find((text) => text.trim().startsWith('收自'));
	return line?.match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? '';
}

/** Japanese saved entries that are sentences, or nothing but kana of one or two characters, are not highlighted. */
function highlightableJapanese(word: string): boolean {
	if (!word || word.length > 20 || /[。．！？\s]/.test(word)) return false;
	return KANJI.test(word) || word.length >= 3;
}

/** Conjugation stems of a dictionary form, each with what may follow it. Stems must contain a kanji. */
function japaneseStems(word: string): Array<{ stem: string; next: RegExp }> {
	const stems: Array<{ stem: string; next: RegExp }> = [];
	const add = (stem: string, chars: string | null) => {
		if (!stem || !KANJI.test(stem)) return;
		stems.push({ stem, next: chars ? new RegExp(`^[${chars}]`, 'u') : HIRAGANA });
	};
	if (word.endsWith('する') && word.length > 2) {
		// 勉強する: 勉強し・勉強さ・勉強せ; 勉強 alone already matches as a noun below.
		add(word.slice(0, -2), 'さしすせ');
		add(word.slice(0, -2), null);
		return stems;
	}
	const last = word.slice(-1);
	const stem = word.slice(0, -1);
	if (last === 'る') add(stem, null); // ichidan and godan る: any hiragana (食べた, 帰って, 見ます)
	else if (GODAN[last]) add(stem, GODAN[last]);
	else if (last === 'い') add(stem, ADJECTIVE);
	return stems;
}

/** English inflections that may follow a saved word, and the stems they attach to. */
function englishForms(word: string): Array<{ stem: string; suffixes: string[] }> {
	const forms = [{ stem: word, suffixes: ['', 's', 'es', 'ed', 'd', 'ing', "'s"] }];
	if (/[^aeiou]y$/.test(word)) forms.push({ stem: word.slice(0, -1), suffixes: ['ies', 'ied'] });
	if (/[^aeiou]e$/.test(word)) forms.push({ stem: word.slice(0, -1), suffixes: ['ing', 'ed'] });
	return forms;
}

export class WordMatcher {
	private root = new Node();
	private words = new Map<string, SavedWord[]>();
	readonly size: number;

	constructor(english: Record<string, EnglishVocabularyItem>, japanese: Record<string, JapaneseVocabularyItem>) {
		for (const item of Object.values(japanese)) {
			if (item.difficulty === 0) continue; // mastered
			const word = oneLine(item.japaneseText);
			if (!highlightableJapanese(word)) continue;
			const saved = { word, reading: oneLine(item.reading), meaning: oneLine(item.translation), source: sourceNote(item.notes), japanese: true };
			this.remember(word, saved);
			this.insert(word, { kind: 'ja' }, word);
			for (const { stem, next } of japaneseStems(word)) this.insert(stem, { kind: 'ja-stem', next }, word);
		}
		for (const item of Object.values(english)) {
			if (item.difficulty === 0) continue;
			const word = oneLine(item.word).toLowerCase();
			if (word.length < 2 || word.length > 40 || isFunctionWord(word)) continue;
			const saved = {
				word: oneLine(item.word),
				reading: oneLine(item.phonetics),
				meaning: [oneLine(item.partOfSpeech), oneLine(item.translation)].filter(Boolean).join(' '),
				source: sourceNote(item.notes),
				japanese: false,
			};
			this.remember(word, saved);
			for (const { stem, suffixes } of englishForms(word)) this.insert(stem, { kind: 'en', suffixes }, word);
		}
		this.size = this.words.size;
	}

	private remember(key: string, saved: SavedWord) {
		const list = this.words.get(key) ?? [];
		if (!list.some((w) => w.meaning === saved.meaning)) list.push(saved);
		this.words.set(key, list);
	}

	private insert(text: string, tail: Tail, key: string) {
		let node = this.root;
		for (const ch of text.toLowerCase()) {
			let child = node.children.get(ch);
			if (!child) node.children.set(ch, (child = new Node()));
			node = child;
		}
		node.entries.push({ tail, key });
	}

	/** End of the match if this entry accepts what follows `end`, else -1. */
	private accept(entry: Entry, text: string, lower: string, start: number, end: number): number {
		const { tail } = entry;
		if (tail.kind === 'ja') return end;
		// The stem and the kana that conjugates it: 食べ|た, 書い|て, 新しか|った
		if (tail.kind === 'ja-stem') return tail.next.test(text.slice(end, end + 1)) ? end + 1 : -1;
		if (start > 0 && LETTER.test(text[start - 1])) return -1;
		for (const suffix of tail.suffixes) {
			const stop = end + suffix.length;
			if (suffix && lower.slice(end, stop) !== suffix) continue;
			if (stop < text.length && LETTER.test(text[stop])) continue;
			return stop;
		}
		return -1;
	}

	/** Non-overlapping matches, left to right, longest first. */
	match(text: string): WordMatch[] {
		if (this.size === 0 || !text) return [];
		const lower = text.toLowerCase();
		const found: WordMatch[] = [];
		let i = 0;
		while (i < lower.length) {
			let node: Node | undefined = this.root;
			let best: { to: number; key: string } | null = null;
			for (let j = i; j < lower.length; j++) {
				node = node.children.get(lower[j]);
				if (!node) break;
				for (const entry of node.entries) {
					const to = this.accept(entry, text, lower, i, j + 1);
					if (to > 0 && (!best || to > best.to)) best = { to, key: entry.key };
				}
			}
			if (best) {
				found.push({ from: i, to: best.to, words: this.words.get(best.key) ?? [] });
				i = best.to;
			} else {
				i++;
			}
		}
		return found;
	}
}
