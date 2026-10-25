import { requestUrl } from "obsidian";
import { DictionaryInfo } from "../types";
import { Logger } from "../logger";

export async function getDictionaryInfoTS(word: string, logger: Logger): Promise<Partial<DictionaryInfo>> {
    const DICTIONARY_API_URL = `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`;
    try {
        const response = await requestUrl({ url: DICTIONARY_API_URL });
        if (response.status === 200) {
            const data = response.json[0];
            
            let phonetics = "";
            if (data.phonetics?.length) {
                for (const phonetic of data.phonetics) {
                    if (phonetic.text) {
                        phonetics = phonetic.text;
                        break;
                    }
                }
            }
            
            const meanings: string[] = [];
            const examples: string[] = [];
            const synonyms: Set<string> = new Set();
            const antonyms: Set<string> = new Set();
            
            for (const meaning of data.meanings || []) {
                const pos = meaning.partOfSpeech || "";
                for (const definition of meaning.definitions || []) {
                    if (definition.definition) {
                        meanings.push(`_${pos}_: ${definition.definition}`);
                    }
                    if (definition.example) {
                        examples.push(definition.example);
                    }
                }
                (meaning.synonyms || []).forEach((s: string) => synonyms.add(s));
                (meaning.antonyms || []).forEach((a: string) => antonyms.add(a));
            }
            
            return {
                phonetics,
                meanings: meanings.slice(0, 5),
                examples: examples.slice(0, 3),
                synonyms: Array.from(synonyms).slice(0, 10),
                antonyms: Array.from(antonyms).slice(0, 10)
            };
        }
    } catch (error) {
        logger.error(`DictionaryAPI.dev call failed for word "${word}"`, error);
    }
    return {};
} 