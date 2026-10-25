import { requestUrl } from "obsidian";
import { IdiomsInfo } from "../types";
import { Logger } from "../logger";

export async function getRelatedIdiomsTS(word: string, logger: Logger): Promise<Partial<IdiomsInfo>> {
    const url = `https://idioms.thefreedictionary.com/${encodeURIComponent(word)}`;
    try {
        const response = await requestUrl({ url });
        if (response.status === 200) {
            const html = response.text;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const idiomsSection = doc.querySelector('#Idioms');
            if (idiomsSection) {
                const idioms = Array.from(idiomsSection.querySelectorAll('a'))
                    .map(a => a.innerText.trim())
                    .filter(text => text.toLowerCase().includes(word.toLowerCase()));
                return { idioms: idioms.slice(0, 10) };
            }
        }
    } catch (error) {
        logger.error(`TheFreeDictionary idioms scraping failed for word "${word}"`, error);
    }
    return {};
} 