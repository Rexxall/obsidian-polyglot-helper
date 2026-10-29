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

/** sseq 里每个 sense 是 ["sense", { dt: [["text", "..."], ...] }] */
type MwSense = [string, { dt?: [string, unknown][] } | undefined];

interface MwEntry {
    meta?: { id?: string; syns?: string[][]; ants?: string[][] };
    fl?: string;
    def?: { sseq?: MwSense[][] }[];
    shortdef?: string[];
}

/** 查不到词时 API 返回一串建议拼写（字符串），只保留词条对象。 */
function firstEntry(json: unknown): MwEntry | undefined {
    const first: unknown = Array.isArray(json) ? json[0] : undefined;
    return first && typeof first === 'object' ? first : undefined;
}

export async function getMwThesaurusInfoTS(word: string, apiKey: string, logger: Logger): Promise<Partial<MerriamWebsterInfo>> {
    if (!apiKey) return {};

    const url = `https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(word)}?key=${apiKey}`;
    try {
        const response = await requestUrl({ url });
        const data = response.status === 200 ? firstEntry(response.json) : undefined;
        if (data) {
            if (!data.meta?.id?.toLowerCase().startsWith(word.toLowerCase())) {
                return {};
            }

            const partOfSpeech = data.fl || '';
            const synonyms = (data.meta.syns?.[0] || []).slice(0, 15);
            const antonyms = (data.meta.ants?.[0] || []).slice(0, 15);
            
            let definitions: string[] = [];
            for (const sense_block of data.def?.[0]?.sseq ?? []) {
                for (const sense of sense_block) {
                    const first = sense[1]?.dt?.[0];
                    if (Array.isArray(first) && first[0] === 'text' && typeof first[1] === 'string') {
                        definitions.push(cleanMwText(first[1]));
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
        const data = response.status === 200 ? firstEntry(response.json) : undefined;
        if (data) {
            if (!data.shortdef) {
                return {};
            }
            const medical_definitions = data.shortdef.slice(0, 5);
            return { medical_definitions };
        }
    } catch (error) {
        logger.error(`Merriam-Webster Medical API call failed for word "${word}"`, error);
    }
    return {};
} 