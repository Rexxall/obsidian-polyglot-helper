import { requestUrl, Notice } from 'obsidian';
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
        const readingText = resultBlock.querySelector(".furigana")?.textContent?.trim() || '';
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