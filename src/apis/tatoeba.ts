import { requestUrl } from "obsidian";
import { Logger } from "../logger";

declare const DOMParser: any;

export interface Example {
    eng: string;
    cmn: string;
}

async function getSimpleExamples(word: string, logger: Logger): Promise<Example[]> {
    const examples: Example[] = [];

    // Fallback 1: YourDictionary
    try {
        const url = `https://sentence.yourdictionary.com/${word}`;
        const response = await requestUrl({ 
            url, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (response.status === 200) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.text, 'text/html');
            doc.querySelectorAll(".sentence-item").forEach((el: any) => {
                const sentence = el.textContent?.trim();
                if (sentence) {
                    examples.push({ eng: sentence, cmn: "" });
                }
            });
            if (examples.length > 0) {
                logger.info(`Fetched ${examples.length} examples from YourDictionary for "${word}".`);
                return examples.slice(0, 3);
            }
        }
    } catch (error) {
        logger.info(`Failed to fetch from YourDictionary for "${word}", trying next fallback.`);
    }

    // Fallback 2: WordHippo
    try {
        const url = `https://www.wordhippo.com/what-is/sentences-with-the-word/${word}.html`;
        const response = await requestUrl({ 
            url,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (response.status === 200) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.text, 'text/html');
            doc.querySelectorAll("table.wordtab tr td div").forEach((el: any) => {
                const sentence = el.textContent?.trim();
                if (sentence && sentence.length > 10 && !sentence.includes('•') && !sentence.includes('©')) {
                    examples.push({ eng: sentence, cmn: "" });
                }
            });
            if (examples.length > 0) {
                logger.info(`Fetched ${examples.length} examples from WordHippo for "${word}".`);
                return examples.slice(0, 3);
            }
        }
    } catch (error) {
        logger.info(`Failed to fetch from WordHippo for "${word}".`);
    }

    return [];
}

export async function getTatoebaExamplesTS(word: string, logger: Logger): Promise<{ examples: Example[] }> {
    const url = `https://tatoeba.org/en/api_v0/search?query=${encodeURIComponent(word)}&from=eng&to=cmn`;
    const examples: Example[] = [];

    try {
        const response = await requestUrl({ url });
        if (response.status === 200) {
            const data = response.json;
            const results = data.results || [];

            for (const result of results) {
                if (examples.length >= 3) break;
                
                const eng = result.text;
                let cmn = '';

                if (result.translations && Array.isArray(result.translations)) {
                    for (const translationGroup of result.translations) {
                        if (Array.isArray(translationGroup)) {
                            const cmnTranslation = translationGroup.find((t: any) => t.lang === 'cmn');
                            if (cmnTranslation && cmnTranslation.text) {
                                cmn = cmnTranslation.text;
                                break; // Found translation, exit inner loop
                            }
                        }
                    }
                }
                
                if (eng) {
                    examples.push({ eng, cmn });
                }
            }
        }
        
        if (examples.length > 0) {
            logger.info(`Fetched ${examples.length} examples from Tatoeba for "${word}".`);
            return { examples: examples.slice(0, 3) };
        }

    } catch (error) {
        logger.error(`Tatoeba API call failed for word "${word}", trying fallbacks.`, error);
    }
    
    // If Tatoeba fails or returns no results, try fallbacks
    logger.info(`Tatoeba API did not return results for "${word}", trying scraping fallbacks.`);
    const fallbackExamples = await getSimpleExamples(word, logger);
    return { examples: fallbackExamples };
} 