import { MarkdownView, normalizePath } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type PolyglotHelper from './main';
import { WordMatcher } from './word-matcher';
import type { SavedWord } from './word-matcher';
import { tr } from './shared/i18n';

/** Rendered text that is not prose: code, links, math, embeds, and our own marks. */
const SKIP = 'pre, code, a, button, input, textarea, .math, .internal-embed, .frontmatter, .metadata-container, .pg-word, .polyglot-root';
const HOVER_DELAY_MS = 120;

/**
 * Reading view: words from the word list are underlined; hovering one shows its reading and
 * meaning from the list, with no lookup and no network. Learned from HiWords (one trie, a tree
 * walk over rendered text nodes, a hover card), with the matcher built once per word-list
 * change instead of once per rendered section, and Japanese conjugations matched.
 */
export class WordHighlight {
	private matcher: WordMatcher | null = null;
	private signature = '';
	private card: HTMLElement | null = null;
	private hoverTimer = 0;

	constructor(private plugin: PolyglotHelper) {}

	register() {
		const { plugin } = this;
		plugin.registerMarkdownPostProcessor((el, ctx) => this.process(el, ctx));
		// @ts-ignore: the plugin's own workspace event
		plugin.registerEvent(plugin.app.workspace.on('polyglot-settings-change', () => this.refreshIfChanged()));
		plugin.registerDomEvent(document, 'mouseover', (event) => this.onHover(event));
		plugin.registerDomEvent(document, 'mouseout', (event) => {
			if ((event.target as HTMLElement | null)?.closest?.('.pg-word')) this.hideCard();
		});
		// Touch has no hover: a tap on a marked word shows its card.
		plugin.registerDomEvent(document, 'pointerup', (event) => {
			if (event.pointerType === 'mouse') return;
			const target = (event.target as HTMLElement | null)?.closest?.('.pg-word');
			if (target instanceof HTMLElement) this.showCard(target);
		});
		plugin.registerDomEvent(document, 'scroll', () => this.hideCard(), { capture: true });
		plugin.register(() => this.hideCard());
	}

	private enabled(): boolean {
		return this.plugin.settings.highlightSavedWords !== false;
	}

	/** A cheap fingerprint of what the highlight depends on, to skip refreshes that change nothing. */
	private currentSignature(): string {
		const { settings } = this.plugin;
		if (!this.enabled()) return 'off';
		const parts: string[] = [];
		for (const [key, item] of Object.entries(settings.englishVocabItems || {})) parts.push(`${key}:${item.difficulty === 0 ? 0 : 1}:${item.translation}`);
		for (const [key, item] of Object.entries(settings.japaneseVocabItems || {})) parts.push(`${key}:${item.difficulty === 0 ? 0 : 1}:${item.translation}:${item.reading ?? ''}`);
		return parts.join('|');
	}

	private getMatcher(): WordMatcher | null {
		if (!this.matcher) {
			this.signature = this.currentSignature();
			this.matcher = new WordMatcher(this.plugin.settings.englishVocabItems || {}, this.plugin.settings.japaneseVocabItems || {});
		}
		return this.matcher.size > 0 ? this.matcher : null;
	}

	/** Skip the word-list export itself, where every line is a saved word. */
	private skipsFile(path: string): boolean {
		if (!path) return true; // the plugin's own panels render with no source path
		const folder = normalizePath(this.plugin.settings.vocabExportFolder?.trim() || 'Polyglot');
		return path.startsWith(folder + '/');
	}

	private process(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		if (!this.enabled() || this.skipsFile(ctx.sourcePath)) return;
		const matcher = this.getMatcher();
		if (matcher) highlight(el, matcher);
	}

	/** Re-render open reading views when the words or their meanings changed, so new words light up. */
	private refreshIfChanged() {
		if (!this.matcher && this.signature === '') return;
		const next = this.currentSignature();
		if (next === this.signature) return;
		this.matcher = null;
		this.signature = next;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview') view.previewMode.rerender(true);
		});
	}

	private onHover(event: MouseEvent) {
		const target = (event.target as HTMLElement | null)?.closest?.('.pg-word');
		if (!(target instanceof HTMLElement)) return;
		window.clearTimeout(this.hoverTimer);
		this.hoverTimer = window.setTimeout(() => this.showCard(target), HOVER_DELAY_MS);
	}

	private showCard(target: HTMLElement) {
		if (!target.isConnected) return;
		const words = wordsOf.get(target);
		if (!words?.length) return;
		this.hideCard();
		const doc = target.ownerDocument;
		const card = doc.body.createDiv({ cls: 'polyglot-root polyglot-popover ap ap-glass pg-word-card' });
		card.setAttr('role', 'tooltip');
		// Meanings of one word sit under one heading, each with the note it was saved from.
		let previous = '';
		for (const word of words) {
			const heading = `${word.word}\u0000${word.reading}`;
			if (heading !== previous) {
				const head = card.createDiv({ cls: 'polyglot-pop-head' });
				head.createSpan({ cls: 'polyglot-pop-word', text: word.word });
				if (word.reading && word.reading !== word.word) head.createSpan({ cls: 'polyglot-pop-reading', text: word.reading });
				previous = heading;
			}
			if (word.meaning) card.createDiv({ cls: 'polyglot-pop-meaning', text: word.meaning });
			if (word.source) card.createDiv({ cls: 'polyglot-pop-src', text: tr(`收自 ${word.source}`, `Saved from ${word.source}`) });
		}
		this.card = card;
		place(card, target.getBoundingClientRect());
	}

	private hideCard() {
		window.clearTimeout(this.hoverTimer);
		this.card?.remove();
		this.card = null;
	}
}

/** The saved words behind each mark, kept off the DOM so they never show up in copied text. */
const wordsOf = new WeakMap<HTMLElement, SavedWord[]>();

export function highlight(root: HTMLElement, matcher: WordMatcher) {
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const parent = node.parentElement;
			if (!parent || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
			return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);

	for (const node of nodes) {
		const text = node.nodeValue || '';
		const matches = matcher.match(text);
		if (matches.length === 0) continue;
		const fragment = createFragment();
		let last = 0;
		for (const match of matches) {
			if (match.from > last) fragment.appendChild(doc.createTextNode(text.slice(last, match.from)));
			wordsOf.set(fragment.createSpan({ cls: 'pg-word', text: text.slice(match.from, match.to) }), match.words);
			last = match.to;
		}
		if (last < text.length) fragment.appendChild(doc.createTextNode(text.slice(last)));
		node.replaceWith(fragment);
	}
}

function place(card: HTMLElement, anchor: DOMRect) {
	const win = card.ownerDocument.defaultView ?? window;
	const margin = 8;
	card.style.maxWidth = `${Math.min(300, win.innerWidth - margin * 2)}px`;
	const width = card.offsetWidth;
	const left = Math.min(Math.max(margin, anchor.left - 16), win.innerWidth - width - margin);
	card.style.left = `${left}px`;
	const height = card.offsetHeight;
	const below = anchor.bottom + 8;
	if (below + height > win.innerHeight - margin && anchor.top - height - 8 > margin) {
		card.style.top = `${anchor.top - height - 8}px`;
	} else {
		card.style.top = `${below}px`;
	}
}
