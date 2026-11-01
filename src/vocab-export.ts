import type { EnglishVocabularyItem, JapaneseVocabularyItem } from './types';
import { baseKey } from './vocab-senses';

/**
 * 把词库导出成别的复习工具能直接用的格式：
 * - Spaced Repetition 插件的单行闪卡（正面::背面），带 #flashcards/polyglot 标签；
 * - Anki 可导入的文本，第一列是卡片的稳定 ID（Anki 的 GUID 列），重新导入时更新原卡、不新增重复卡。
 * 每张卡带原句和来源笔记的回链。重新导出时按稳定 ID 保留 Spaced Repetition 写在行尾的
 * <!--SR:...--> 排程，不打断已有复习进度。
 */
export interface ExportCard {
	id: string;
	front: string;
	/** 背面的读音、释义、原句，不含来源笔记 */
	back: string;
	/** 收词时所在笔记的名字（不含扩展名） */
	source: string;
	tags: string[];
}

const SR_SCHEDULE = /<!--SR:[^>]*-->\s*$/;
const CARD_ID = /<!--pg:([\w-]+)-->/;

function oneLine(value: string | undefined): string {
	return (value || '').replace(/\s*\n\s*/g, ' ').replace(/::/g, '：：').trim();
}

/** "收自 [[笔记]] · 2026-11-01" 里的笔记名。 */
function sourceNote(notes: string | undefined): string {
	const line = (notes || '').split('\n').find((text) => text.trim().startsWith('收自'));
	return line?.match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? '';
}

function sentence(item: { examples?: string[] }): string {
	const text = oneLine(item.examples?.[0]);
	return text ? `“${text}”` : '';
}

/** Words saved with more than one meaning; their cards show the sentence on the front. */
function multiSense(keys: string[]): Set<string> {
	const count = new Map<string, number>();
	for (const key of keys) count.set(baseKey(key), (count.get(baseKey(key)) ?? 0) + 1);
	return new Set([...count].filter(([, n]) => n > 1).map(([base]) => base));
}

export function collectCards(
	english: Record<string, EnglishVocabularyItem>,
	japanese: Record<string, JapaneseVocabularyItem>,
): ExportCard[] {
	const cards: ExportCard[] = [];
	const englishMulti = multiSense(Object.keys(english));
	const japaneseMulti = multiSense(Object.keys(japanese));

	for (const [key, item] of Object.entries(english)) {
		const word = oneLine(item.word);
		if (!word) continue;
		const cue = englishMulti.has(baseKey(key)) ? sentence(item) : '';
		const lead = [item.phonetics, item.partOfSpeech].map(oneLine).filter(Boolean).join(' ');
		cards.push({
			id: item.id || `en-${key}`,
			front: cue ? `${word} · ${cue}` : word,
			back: [lead, oneLine(item.translation), cue ? '' : sentence(item)].filter(Boolean).join(' · '),
			source: sourceNote(item.notes),
			tags: ['english', ...(item.tags || [])],
		});
	}
	for (const [key, item] of Object.entries(japanese)) {
		const word = oneLine(item.japaneseText);
		if (!word) continue;
		const cue = japaneseMulti.has(baseKey(key)) ? sentence(item) : '';
		cards.push({
			id: item.id || `ja-${key}`,
			front: cue ? `${word} · ${cue}` : word,
			back: [oneLine(item.reading), oneLine(item.translation), cue ? '' : sentence(item)].filter(Boolean).join(' · '),
			source: sourceNote(item.notes),
			tags: ['japanese', ...(item.tags || [])],
		});
	}
	return cards.sort((a, b) => a.front.localeCompare(b.front) || a.id.localeCompare(b.id));
}

/** 读出旧导出文件里每张卡的排程注释：有稳定 ID 的按 ID，旧文件按正面文字。 */
export function readSchedules(previous: string): Map<string, string> {
	const schedules = new Map<string, string>();
	for (const line of previous.split('\n')) {
		const match = line.match(SR_SCHEDULE);
		const separator = line.indexOf('::');
		if (!match || separator <= 0) continue;
		const id = line.match(CARD_ID)?.[1];
		schedules.set(id ? `id:${id}` : `front:${line.slice(0, separator).trim()}`, match[0].trim());
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
		const schedule = schedules.get(`id:${card.id}`) ?? schedules.get(`front:${card.front}`);
		const back = [card.back, card.source ? `[[${card.source}]]` : ''].filter(Boolean).join(' · ');
		lines.push(`${card.front}::${back} <!--pg:${card.id}-->${schedule ? ' ' + schedule : ''}`);
	}
	return lines.join('\n') + '\n';
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Anki 2.1.54 起支持的文件头：GUID 列让重新导入更新同一张卡（Anki 手册 Importing → Text files）。
 * 来源笔记写成 obsidian:// 链接，在 Anki 里点开就回到 Obsidian 的那篇笔记。
 */
export function toAnkiText(cards: ExportCard[], vaultName = ''): string {
	const cell = (value: string) => value.replace(/[\t\r\n]+/g, ' ');
	const tag = (value: string) => value.replace(/\s+/g, '_');
	const link = (note: string) =>
		vaultName
			? `<a href="obsidian://open?vault=${encodeURIComponent(vaultName)}&amp;file=${encodeURIComponent(note)}">${escapeHtml(note)}</a>`
			: escapeHtml(note);
	const lines = ['#separator:tab', '#html:true', '#guid column:1', '#tags column:4'];
	for (const card of cards) {
		const back = [escapeHtml(card.back), card.source ? link(card.source) : ''].filter(Boolean).join(' · ');
		lines.push([cell(card.id), cell(escapeHtml(card.front)), cell(back), card.tags.map(tag).join(' ')].join('\t'));
	}
	return lines.join('\n') + '\n';
}
