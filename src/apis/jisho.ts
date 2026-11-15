import { requestUrl } from 'obsidian';
import { Logger } from '../logger';

export interface JishoResult {
    word: string;
    reading: string;
    tags: string[];
    meanings: { pos: string; definition: string; }[];
}

export async function getJishoInfoTS(word: string, logger: Logger): Promise<JishoResult | null> {
    try {
        const url = `https://jisho.org/search/${encodeURIComponent(word)}`;
        const response = await requestUrl({ url });
        
        if (response.status !== 200) {
            logger.info(`Jisho.org request for "${word}" failed with status ${response.status}`);
            return null;
        }

        const html = response.text;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const resultBlock = doc.querySelector("div.concept_light.clearfix");
        if (!resultBlock) {
            logger.info(`No Jisho.org result found for "${word}"`);
            return null;
        }

        const wordText = resultBlock.querySelector(".text")?.textContent?.trim() || '';
        const readingText = fullReading(resultBlock);
        const tags = Array.from(resultBlock.querySelectorAll(".concept_light-tag")).map(tag => tag.textContent?.trim() || '').filter(Boolean);

        const meanings: { pos: string; definition: string; }[] = [];
        resultBlock.querySelectorAll(".meaning-wrapper").forEach(meaningDiv => {
            const pos = meaningDiv.querySelector(".meaning-tags")?.textContent?.trim() || "";
            const definition = meaningDiv.querySelector(".meaning-meaning")?.textContent?.trim() || "";
            if (definition) {
                meanings.push({ pos, definition });
            }
        });

        if (!wordText && !readingText && meanings.length === 0) {
            logger.info(`Jisho.org result for "${word}" was empty.`);
            return null;
        }

        return { word: wordText || word, reading: readingText, tags, meanings: meanings.slice(0, 4) };

    } catch (error) {
        logger.error(`Jisho.org scraping for '${word}' failed`, error);
        return null;
    }
} 
/**
 * Jisho puts furigana over kanji only, one span per character of the word, so 匂い reads にお.
 * Fill in the kana the word writes out itself to get におい, 取り扱い とりあつかい, お茶 おちゃ.
 * An empty span over a kanji belongs to the compound reading before it (今日 きょう).
 */
export function fullReading(block: ParentNode): string {
    const spans = Array.from(block.querySelectorAll('.furigana > span')).map(s => s.textContent?.trim() || '');
    const chars = Array.from(block.querySelector('.text')?.textContent?.trim() || '');
    if (spans.length !== chars.length) return spans.join('');
    return chars.map((ch, i) => spans[i] || (/[\u3040-\u30ff]/.test(ch) ? ch : '')).join('');
}
