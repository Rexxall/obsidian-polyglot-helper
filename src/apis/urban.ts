import { requestUrl } from "obsidian";
import { UrbanDictionaryInfo } from "../types";
import { Logger } from "../logger";

interface UrbanDefinition {
    definition?: string;
    example?: string;
    tags?: string[];
    thumbsUp?: number;
    thumbsDown?: number;
}

export async function getUrbanDictionaryInfoTS(word: string, logger: Logger): Promise<Partial<UrbanDictionaryInfo>> {
    const URBAN_API_URL = `https://unofficialurbandictionaryapi.com/api/search?term=${encodeURIComponent(word)}`;
    try {
        const response = await requestUrl({ url: URBAN_API_URL });
        const definitions = (response.json as { data?: UrbanDefinition[] } | null)?.data ?? [];
        if (response.status === 200 && definitions.length) {
            // Sort by votes (thumbs up - thumbs down)
            const score = (d: UrbanDefinition) => (d.thumbsUp ?? 0) - (d.thumbsDown ?? 0);
            definitions.sort((a, b) => score(b) - score(a));

            const topDef = definitions[0];
            
            const cleanText = (text: string) => text.replace(/\[|\]/g, '');

            return {
                slang_meaning: cleanText(topDef.definition || '').slice(0, 500),
                slang_example: cleanText(topDef.example || '').slice(0, 200),
                tags: (topDef.tags || []).filter((tag) => tag.length < 30).slice(0, 5)
            };
        }
    } catch (error) {
        logger.error(`Urban Dictionary API call failed for word "${word}"`, error);
    }
    return {};
} 