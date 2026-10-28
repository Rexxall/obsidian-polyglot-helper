/**
 * 把查词结果的 Markdown（缓存、写进笔记的都是这一份）解析成词卡结构，
 * 侧栏按词卡画，不再直接渲染 Markdown。认不出词头时返回空数组，调用方退回旧渲染。
 */
export interface CardLine {
	/** 行内文本，可含 **加粗** 与 <ruby> 注音 */
	text: string;
	/** “敬语型”这类小标签 */
	label?: string;
	/** 例句译文等次级文字 */
	sub?: string;
	audio?: string;
}

export interface CardGroup {
	/** 词性，按义项分组时用胶囊标出 */
	pos?: string;
	/** 词典义项，逐条编号 */
	numbered?: boolean;
	lines: CardLine[];
}

export interface CardSection {
	title: string;
	groups: CardGroup[];
	/** 医学、俚语、习语、词源默认收起 */
	folded: boolean;
}

export interface WordCard {
	headword: string;
	gloss: string;
	phonetic: string;
	pos: string[];
	audio?: string;
	image?: string;
	sections: CardSection[];
	sources: string[];
}

const SOURCE_LABELS: Record<string, string> = {
	'Dictionary API': 'Free Dictionary',
	剑桥词典: 'Cambridge Dictionary',
	API定义: 'Merriam-Webster Medical',
	详细词源: 'Etymonline',
};

const POS_NAMES: Record<string, string> = {
	noun: '名词',
	verb: '动词',
	adjective: '形容词',
	adverb: '副词',
	preposition: '介词',
	conjunction: '连词',
	pronoun: '代词',
	interjection: '感叹词',
	determiner: '限定词',
	exclamation: '感叹词',
	'phrasal verb': '短语动词',
};

const FOLDED = /医学|俚语|习语|词源|Medical|Slang|Idiom/i;
const AUDIO = /<audio\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/audio>/i;

export function posName(raw: string): string {
	const key = raw.trim().toLowerCase().replace(/\.$/, '');
	return POS_NAMES[key] || raw.trim();
}

function takeAudio(text: string): { text: string; audio?: string } {
	const match = text.match(AUDIO);
	if (!match) return { text: text.trim() };
	return { text: text.replace(AUDIO, '').trim(), audio: match[1] };
}

/** 去掉 Markdown 链接，只留文字。 */
function plainLinks(text: string): string {
	return text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
}

const LABELLED = /^\*\*(.+?)\*\*\s*[:：]?\s*(.*)$/;

function parseLabel(item: string): { label?: string; value: string } {
	const match = item.match(LABELLED);
	if (!match) return { value: item };
	return { label: match[1].replace(/[:：]\s*$/, '').trim(), value: match[2].trim() };
}

interface RawItem {
	text: string;
	children: string[];
}

/** 把 callout 正文的列表拆成“一级项＋二级项”。 */
function listItems(body: string[]): RawItem[] {
	const items: RawItem[] = [];
	for (const line of body) {
		const child = line.match(/^\s{2,}[-*]\s+(.*)$/);
		const top = line.match(/^[-*]\s+(.*)$/);
		if (child && items.length) items[items.length - 1].children.push(child[1]);
		else if (top) items.push({ text: top[1], children: [] });
		else if (line.trim() && items.length) items[items.length - 1].text += ' ' + line.trim();
		else if (line.trim()) items.push({ text: line.trim(), children: [] });
	}
	return items;
}

function parseEntry(entry: string): WordCard | null {
	const lines = entry.split('\n');
	const headIndex = lines.findIndex((line) => /^#{2,3}\s+\S/.test(line));
	if (headIndex < 0) return null;
	const head = lines[headIndex].replace(/^#{2,3}\s+/, '').trim();
	const split = head.indexOf(' - ');
	const card: WordCard = {
		headword: split >= 0 ? head.slice(0, split).trim() : head,
		gloss: split >= 0 ? head.slice(split + 3).trim() : '',
		phonetic: '',
		pos: [],
		sections: [],
		sources: [],
	};

	let current: { title: string; body: string[] } | null = null;
	const blocks: { title: string; body: string[] }[] = [];
	for (const line of lines.slice(headIndex + 1)) {
		const callout = line.match(/^>\s*\[!(\w+)\][-+]?\s*(.*)$/);
		if (callout) {
			current = { title: callout[2].trim(), body: [] };
			blocks.push(current);
			continue;
		}
		if (line.startsWith('>')) {
			current?.body.push(line.replace(/^>\s?/, ''));
			continue;
		}
		current = null;
		const audio = line.match(AUDIO);
		if (audio && !card.audio) card.audio = audio[1];
	}

	for (const block of blocks) {
		const section: CardSection = { title: block.title, groups: [], folded: FOLDED.test(block.title) };
		const loose: CardLine[] = [];
		for (const item of listItems(block.body)) {
			const { label, value } = parseLabel(item.text);
			if (label === '音标') {
				card.phonetic = value.replace(/\s*\|\s*/g, ' · ');
				continue;
			}
			if (label === '词性') {
				for (const p of value.split(/[,，/、]/)) if (p.trim()) card.pos.push(posName(p));
				continue;
			}
			if (label === '视觉助记') {
				card.image = value.match(/\]\(([^)]+)\)/)?.[1];
				continue;
			}
			if (label === '含义' && !card.gloss) {
				card.gloss = plainLinks(value);
				continue;
			}
			if (label && SOURCE_LABELS[label] && !value) {
				card.sources.push(SOURCE_LABELS[label]);
				const byPos = new Map<string, CardLine[]>();
				for (const child of item.children) {
					const tagged = child.match(/^_([^_]+)_\s*[:：]\s*(.*)$/);
					const pos = tagged ? posName(tagged[1]) : '';
					const { text, audio } = takeAudio(plainLinks(tagged ? tagged[2] : child));
					if (!byPos.has(pos)) byPos.set(pos, []);
					byPos.get(pos)!.push({ text: text.replace(/[:：]$/, ''), audio });
				}
				for (const [pos, groupLines] of byPos) section.groups.push({ pos: pos || undefined, numbered: true, lines: groupLines });
				continue;
			}
			if (label && SOURCE_LABELS[label]) card.sources.push(SOURCE_LABELS[label]);
			const main = takeAudio(plainLinks(value));
			const sub = item.children.length ? takeAudio(plainLinks(item.children.join(' '))) : undefined;
			loose.push({
				label: label && !SOURCE_LABELS[label] ? label : undefined,
				text: main.text,
				sub: sub?.text,
				audio: main.audio || sub?.audio,
			});
		}
		if (loose.length) section.groups.unshift({ lines: loose });
		if (section.groups.length) card.sections.push(section);
	}
	card.pos = [...new Set(card.pos)];
	card.sources = [...new Set(card.sources)];
	return card;
}

export function parseWordCards(markdown: string): WordCard[] {
	const cards: WordCard[] = [];
	const entries: string[] = [];
	for (const chunk of markdown.split(/\n-{3,}\n/)) {
		if (/^#{2,3}\s+\S/m.test(chunk) || !entries.length) entries.push(chunk);
		else entries[entries.length - 1] += '\n' + chunk;
	}
	for (const entry of entries) {
		const card = parseEntry(entry);
		if (card && (card.sections.length || card.gloss)) cards.push(card);
	}
	return cards;
}
