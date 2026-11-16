import { ApiConfig, PolyglotHelperSettings } from "../types";
import { Logger } from '../shared/Logger';

import { errorMessage } from '../shared/errors';
import { chat, isUsable } from '../ai/kit';

export const LLM_TIMEOUT_MS = 60_000;

/** LLM 补全词条时返回的字段，全部可缺。 */
export interface LlmWordInfo {
    meaning?: string;
    pos?: string;
    example?: string;
    translation?: string;
    etymology?: string;
    synonyms?: string[];
    antonyms?: string[];
    collocations?: string[];
    mnemonic?: string;
    medical_usage?: string;
    medical_field?: string;
    slang_meaning?: string;
    slang_example?: string;
    tags?: string[];
}

// Helper to strip markdown and parse JSON safely
function safeJsonParse(text: string, logger: Logger): unknown {
    if (!text) return null;
    const cleanedText = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
    try {
        return JSON.parse(cleanedText);
    } catch (e) {
        logger.error("Failed to parse LLM response as JSON.", {
            error: errorMessage(e),
            originalText: text,
            cleanedText: cleanedText
        });
        return null;
    }
}

export async function getLlmInfoTS(word: string, _settings: PolyglotHelperSettings, existingData: unknown, logger: Logger, apiConfig?: ApiConfig | null): Promise<LlmWordInfo | null> {
    if (!isUsable(apiConfig)) return null;

    const contextStr = JSON.stringify(existingData, null, 2);

    const prompt_content = `
You are a professional dictionary assistant, responsible for integrating and supplementing information.
Based on the dictionary API context provided below, please enrich and complete the following fields to generate a unified JSON entry.

**Instructions:**
1.  \`meaning\`: Provide a concise and accurate **Chinese meaning**. Prioritize translating and summarizing the English definitions from the context.
2.  \`pos\`: Determine the most dominant **part of speech** based on the context.
3.  \`example\`: Provide a clear **English example sentence**. If medical definitions are present in the context, prefer a medically relevant example.
4.  \`translation\`: Provide the **Chinese translation** for the example sentence above.
5.  \`etymology\`: If the dictionary context provides etymology, include it. Otherwise, supplement it if you can reliably infer it; otherwise, leave it empty.
6.  \`synonyms\`: List **synonyms** based on the context.
7.  \`antonyms\`: List **antonyms** based on the context.
8.  \`collocations\`: Provide 2-3 **common collocations**, which **must include Chinese translations** in the format: \`['phrase1 (翻译1)', 'phrase2 (翻译2)']\`.
9.  \`mnemonic\`: Provide a concise and effective **memory aid**.
10. \`medical_usage\`: If the context includes medical information (\`medical\`), **summarize** its main medical uses based on the medical definitions.
11. \`medical_field\`: If it's a medical term, specify the relevant **medical field**.
12. \`slang_meaning\`: If the context includes slang information (\`urban\`), **summarize** its slang meaning.
13. \`slang_example\`: If the context includes slang information, provide a **slang example sentence**.
14. \`tags\`: Generate 3-5 of the most relevant **tags** based on all available information (do not include #).

**IMPORTANT:** Prioritize and stay faithful to the provided dictionary context. If a field in the context is already comprehensive, use it directly or with minor refinement. Only generate new information when the context is insufficient or missing. Ensure the output is a single, correctly formatted JSON object.

Word: '${word}'

Dictionary API Context:
\`\`\`json
${contextStr}
\`\`\`
`;

    try {
        const reply = await chat(apiConfig, {
            system: "You are a professional dictionary assistant that integrates information and generates JSON. Strictly follow user requirements and prioritize the provided context.",
            user: prompt_content,
            temperature: 0.2,
            json: true,
            timeoutMs: LLM_TIMEOUT_MS,
        });
        const parsed = safeJsonParse(reply, logger);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        logger.error(`LLM call failed for word "${word}"`, errorMessage(error));
        return null;
    }
}

export async function getChineseTranslationTS(text: string, _settings: PolyglotHelperSettings, logger: Logger, apiConfig?: ApiConfig | null): Promise<string | null> {
    if (!isUsable(apiConfig)) {
        logger.error("无法执行英译汉：没有可用的 AI 配置。");
        return null;
    }
    try {
        const reply = await chat(apiConfig, {
            system: "You are a highly efficient translation engine. You only output the translated Chinese text, with no additional content.",
            user: `Translate the following English text to Chinese. Provide only the translation, without any explanations, introductory phrases, or extra text. The output should be the Chinese text and nothing else.

English text: "${text}"`,
            temperature: 0,
            timeoutMs: LLM_TIMEOUT_MS,
        });
        return reply.trim() || null;
    } catch (error) {
        logger.error(`Chinese translation call failed for text "${text}"`, errorMessage(error));
        return null;
    }
}
