import { requestUrl } from 'obsidian';
import { Logger } from '../logger';

// 用浏览器自带的 DOMParser 解析页面

export interface CambridgeInfo {
    uk_phonetic: string;
    us_phonetic: string;
    definitions: string[];
    examples: string[];
    pos: string; // Part of speech
}

export async function getCambridgeInfoTS(word: string, logger: Logger): Promise<CambridgeInfo | null> {
    const url = `https://dictionary.cambridge.org/dictionary/english/${word}`;
    try {
        const response = await requestUrl({
            url,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
            }
        });

        if (response.status !== 200) {
            logger.info(`Cambridge Dictionary request failed with status ${response.status} for word: ${word}`);
            return null;
        }

        const html = response.text;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const result: CambridgeInfo = {
            uk_phonetic: '',
            us_phonetic: '',
            definitions: [],
            examples: [],
            pos: ''
        };

        // Get UK phonetic
        const uk_pron_el = doc.querySelector(".uk.dpron-i .pron");
        if (uk_pron_el) {
            result.uk_phonetic = uk_pron_el.textContent?.trim() ?? '';
        }

        // Get US phonetic
        const us_pron_el = doc.querySelector(".us.dpron-i .pron");
        if (us_pron_el) {
            result.us_phonetic = us_pron_el.textContent?.trim() ?? '';
        }

        // Get definitions and examples
        doc.querySelectorAll(".def-block").forEach((def_block) => {
            const definition_el = def_block.querySelector(".def");
            if (definition_el) {
                result.definitions.push(definition_el.textContent?.trim() ?? '');
            }

            const example_el = def_block.querySelector(".examp");
            if (example_el) {
                result.examples.push(example_el.textContent?.trim() ?? '');
            }
        });
        
        // Limit to 3 definitions and examples
        result.definitions = result.definitions.slice(0, 3);
        result.examples = result.examples.slice(0, 3);

        // Get part of speech
        const pos_el = doc.querySelector(".pos.dpos");
        if (pos_el) {
            result.pos = pos_el.textContent?.trim() ?? '';
        }

        if (!result.uk_phonetic && !result.us_phonetic && result.definitions.length === 0) {
            logger.info(`No meaningful data found on Cambridge Dictionary for word: ${word}`);
            return null;
        }

        return result;

    } catch (error) {
        logger.error(`Failed to fetch or parse Cambridge Dictionary page for word: ${word}`, error);
        return null;
    }
} 