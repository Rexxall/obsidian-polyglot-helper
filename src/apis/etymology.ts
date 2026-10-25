import { requestUrl } from "obsidian";
import { EtymologyInfo } from "../types";
import { Logger } from "../logger";

export async function getEtymologyInfoTS(word: string, logger: Logger): Promise<Partial<EtymologyInfo>> {
    try {
        // First, try to access the direct word page, which is more reliable
        const directUrl = `https://www.etymonline.com/word/${encodeURIComponent(word)}`;
        let response = await requestUrl({ url: directUrl, throw: false });

        // If direct access fails (e.g., returns a 404), fall back to search
        if (response.status !== 200) {
            const searchUrl = `https://www.etymonline.com/search?q=${encodeURIComponent(word)}`;
            response = await requestUrl({ url: searchUrl });
        }
        
        if (response.status === 200) {
            const html = response.text;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            
            // This selector is based on Etymonline's structure for the definition block
            const definitionElement = doc.querySelector("section[class*='word__defination--']");
            
            if (definitionElement) {
                // Use innerText to get a clean representation of the content
                const etymologyText = (definitionElement as HTMLElement).innerText.trim();
                return { etymology: etymologyText.slice(0, 1000) }; // Limit length
            }
        }
    } catch (error) {
        logger.error(`Etymology scraping failed for word "${word}"`, error);
    }
    return {};
} 