import type { EnglishVocabularyItem, JapaneseVocabularyItem } from './types';

/**
 * 把词库导出成别的复习工具能直接用的格式：
 * - Spaced Repetition 插件的单行闪卡（正面::背面），带 #flashcards/polyglot 标签；
 * - Anki 可导入的制表符分隔文本。
 * 重新导出时保留 Spaced Repetition 写在卡片行尾的 <!--SR:...--> 排程，不打断已有复习进度。
 */
export interface ExportCard {
	front: string;
	back: string;
	tags: string[];
}

const SR_SCHEDULE = /<!--SR:[^>]*-->\s*$/;

function oneLine(value: string | undefined): string {
	return (value || '').replace(/\s*\n\s*/g, ' ').replace(/::/g, '：：').trim();
}

export function collectCards(
	english: Record<string, EnglishVocabularyItem>,
	japanese: Record<string, JapaneseVocabularyItem>,
): ExportCard[] {
	const cards: ExportCard[] = [];
	for (const item of Object.values(english)) {
		const front = oneLine(item.word);
		if (!front) continue;
		const lead = [item.phonetics, item.partOfSpeech].map(oneLine).filter(Boolean).join(' ');
		cards.push({
			front,
			back: [lead, oneLine(item.translation)].filter(Boolean).join(' · '),
			tags: ['english', ...(item.tags || [])],
		});
	}
	for (const item of Object.values(japanese)) {
		const front = oneLine(item.japaneseText);
		if (!front) continue;
		cards.push({
			front,
			back: [oneLine(item.reading), oneLine(item.translation)].filter(Boolean).join(' · '),
			tags: ['japanese', ...(item.tags || [])],
		});
	}
	return cards.sort((a, b) => a.front.localeCompare(b.front));
}

/** 读出旧导出文件里每张卡的排程注释，按正面文字对应。 */
export function readSchedules(previous: string): Map<string, string> {
	const schedules = new Map<string, string>();
	for (const line of previous.split('\n')) {
		const match = line.match(SR_SCHEDULE);
		const separator = line.indexOf('::');
		if (!match || separator <= 0) continue;
		schedules.set(line.slice(0, separator).trim(), match[0].trim());
	}
	return schedules;
}

export function toFlashcardNote(cards: ExportCard[], previous = ''): string {
	const schedules = readSchedules(previous);
	const lines = [
		'#flashcards/polyglot',
		'',
		'%% 由 Polyglot Helper 从词库导出。重新导出会覆盖本文件，但保留 Spaced Repetition 的复习排程。 %%',
		'',
	];
	for (const card of cards) {
		const schedule = schedules.get(card.front);
		lines.push(`${card.front}::${card.back}${schedule ? ' ' + schedule : ''}`);
	}
	return lines.join('\n') + '\n';
}

export function toAnkiText(cards: ExportCard[]): string {
	const cell = (value: string) => value.replace(/[\t\r\n]+/g, ' ');
	const tag = (value: string) => value.replace(/\s+/g, '_');
	const lines = ['#separator:tab', '#html:false', '#tags column:3'];
	for (const card of cards) {
		lines.push([cell(card.front), cell(card.back), card.tags.map(tag).join(' ')].join('\t'));
	}
	return lines.join('\n') + '\n';
}
