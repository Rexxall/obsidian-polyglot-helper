import { requestUrl } from "obsidian";
import { UrbanDictionaryInfo } from "../types";
import { Logger } from "../logger";

export async function getUrbanDictionaryInfoTS(word: string, logger: Logger): Promise<Partial<UrbanDictionaryInfo>> {
    const URBAN_API_URL = `https://unofficialurbandictionaryapi.com/api/search?term=${encodeURIComponent(word)}`;
    try {
        const response = await requestUrl({ url: URBAN_API_URL });
        if (response.status === 200 && response.json.data?.length) {
            const definitions = response.json.data;

            // Sort by votes (thumbs up - thumbs down)
            definitions.sort((a: any, b: any) => 
                (b.thumbsUp - b.thumbsDown) - (a.thumbsUp - a.thumbsDown)
            );

            const topDef = definitions[0];
            
            const cleanText = (text: string) => text.replace(/\[|\]/g, '');

            return {
                slang_meaning: cleanText(topDef.definition || '').slice(0, 500),
                slang_example: cleanText(topDef.example || '').slice(0, 200),
                tags: (topDef.tags || []).filter((tag: string) => tag.length < 30).slice(0, 5)
            };
        }
    } catch (error) {
        logger.error(`Urban Dictionary API call failed for word "${word}"`, error);
    }
    return {};
} 