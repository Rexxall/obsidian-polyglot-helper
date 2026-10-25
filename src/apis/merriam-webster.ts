import { requestUrl } from "obsidian";
import { MerriamWebsterInfo } from "../types";
import { Logger } from "../logger";

function cleanMwText(text: string): string {
    if (typeof text !== 'string') return "";

    // Paired tags like {it}word{/it} -> *word*
    text = text.replace(/\{it\}(.*?)\{\/it\}/g, '*$1*');
    text = text.replace(/\{b\}(.*?)\{\/b\}/g, '**$1**');
    text = text.replace(/\{sc\}(.*?)\{\/sc\}/g, '$1'); // small caps
    text = text.replace(/\{sup\}(.*?)\{\/sup\}/g, '^$1'); // superscript

    // Link tags like {a_link|text|id} or {sx|text||id} -> text
    text = text.replace(/\{[a-z_]+\|([^|}]+)[^}]*\}/g, '$1');

    // Standalone tags like {bc} -> ''
    text = text.replace(/\{\/?\w+\}/g, '');

    return text.trim();
}

export async function getMwThesaurusInfoTS(word: string, apiKey: string, logger: Logger): Promise<Partial<MerriamWebsterInfo>> {
    if (!apiKey) return {};

    const url = `https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(word)}?key=${apiKey}`;
    try {
        const response = await requestUrl({ url });
        if (response.status === 200 && response.json.length > 0) {
            const data = response.json[0];
            if (typeof data !== 'object' || !data.meta || !data.meta.id.toLowerCase().startsWith(word.toLowerCase())) {
                return {};
            }

            const partOfSpeech = data.fl || '';
            const synonyms = (data.meta.syns?.[0] || []).slice(0, 15);
            const antonyms = (data.meta.ants?.[0] || []).slice(0, 15);
            
            let definitions: string[] = [];
            if (data.def && data.def[0]?.sseq) {
                for (const sense_block of data.def[0].sseq) {
                    for (const sense of sense_block) {
                        const dt_block = sense[1]?.dt;
                        if (dt_block) {
                            if (Array.isArray(dt_block[0]) && dt_block[0][0] === 'text') {
                                definitions.push(cleanMwText(dt_block[0][1]));
                            }
                        }
                    }
                }
            }
            
            return { synonyms, antonyms, definitions: definitions.slice(0, 3), partOfSpeech };
        }
    } catch (error) {
        logger.error(`Merriam-Webster Thesaurus API call failed for word "${word}"`, error);
    }
    return {};
}

export async function getMwMedicalInfoTS(word: string, apiKey: string, logger: Logger): Promise<Partial<MerriamWebsterInfo>> {
    if (!apiKey) return {};

    const url = `https://www.dictionaryapi.com/api/v3/references/medical/json/${encodeURIComponent(word)}?key=${apiKey}`;
    try {
        const response = await requestUrl({ url });
        if (response.status === 200 && response.json.length > 0) {
            const data = response.json[0];
            if (typeof data !== 'object' || !data.shortdef) {
                return {};
            }
            const medical_definitions = (data.shortdef || []).slice(0, 5);
            return { medical_definitions };
        }
    } catch (error) {
        logger.error(`Merriam-Webster Medical API call failed for word "${word}"`, error);
    }
    return {};
} 