import { requestUrl, RequestUrlResponse } from "obsidian";
import { ApiConfig, PolyglotHelperSettings } from "../types";
import { Logger } from '../shared/Logger';

import { errorMessage } from '../shared/errors';
export const LLM_TIMEOUT_MS = 60_000;

// One place for the OpenAI-compatible chat request used by all three helpers below.
export async function postChatCompletion(
    baseUrl: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number = LLM_TIMEOUT_MS
): Promise<RequestUrlResponse> {
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(
            () => reject(new Error(`LLM 请求超过 ${Math.round(timeoutMs / 1000)} 秒未响应`)),
            timeoutMs
        );
    });
    try {
        return await Promise.race([
            requestUrl({
                url: baseUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(body),
                throw: false
            }),
            timeout
        ]);
    } finally {
        window.clearTimeout(timer);
    }
}

/** OpenAI 兼容接口返回的 choices[0].message.content；格式不对时为空串。 */
export function chatContent(response: { json: unknown }): string {
    const body = response.json as { choices?: { message?: { content?: unknown } }[] } | null | undefined;
    const content = body?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
}

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

export async function getLlmInfoTS(word: string, settings: PolyglotHelperSettings, existingData: unknown, logger: Logger, apiConfig?: ApiConfig): Promise<LlmWordInfo | null> {
    // 使用传入的API配置，如果没有则回退到设置中的配置
    const apiKey = apiConfig?.apiKey || settings.englishLlmApiKey;
    const baseUrl = apiConfig?.baseUrl || settings.englishLlmBaseUrl;
    const modelName = apiConfig?.model || settings.englishModelName;

    if (!apiKey || !baseUrl) return null;

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

    const messages = [
        { "role": "system", "content": "You are a professional dictionary assistant that integrates information and generates JSON. Strictly follow user requirements and prioritize the provided context." },
        { "role": "user", "content": prompt_content }
    ];

    try {
        const response = await postChatCompletion(baseUrl, apiKey, {
            model: modelName,
            messages: messages,
            temperature: 0.2, // Slightly increased for better generation
            response_format: { "type": "json_object" } // Enforce JSON output
        });

        if (response.status === 200) {
            const parsed = safeJsonParse(chatContent(response), logger);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } else {
            logger.error(`LLM API request failed with status ${response.status}`, { response: response.text });
            return null;
        }
    } catch (error) {
        // Handle potential rate limit errors in the future if needed
        logger.error(`LLM call failed for word "${word}"`, error);
        return null;
    }
} 

export async function getChineseTranslationTS(text: string, settings: PolyglotHelperSettings, logger: Logger, apiConfig?: ApiConfig): Promise<string | null> {
    // 使用传入的API配置，如果没有则回退到设置中的配置
    const apiKey = apiConfig?.apiKey || settings.englishLlmApiKey;
    const baseUrl = apiConfig?.baseUrl || settings.englishLlmBaseUrl;
    const modelName = apiConfig?.model || settings.englishModelName;

    if (!apiKey || !baseUrl) {
        logger.error("无法执行英译汉，因为缺少 LLM API Key 或 Base URL。");
        return null;
    }

    const prompt_content = `Translate the following English text to Chinese. Provide only the translation, without any explanations, introductory phrases, or extra text. The output should be the Chinese text and nothing else.

English text: "${text}"`;

    const messages = [
        { "role": "system", "content": "You are a highly efficient translation engine. You only output the translated Chinese text, with no additional content." },
        { "role": "user", "content": prompt_content }
    ];

    try {
        const response = await postChatCompletion(baseUrl, apiKey, {
            model: modelName,
            messages: messages,
            temperature: 0.0, // Set to 0 for deterministic translation
        });

        if (response.status === 200) {
            return chatContent(response).trim() || null;
        } else {
            logger.error(`Chinese translation API request failed with status ${response.status}`, { response: response.text });
            return null;
        }
    } catch (error) {
        logger.error(`Chinese translation call failed for text "${text}"`, error);
        return null;
    }
}

export async function getJapaneseTranslationTS(text: string, settings: PolyglotHelperSettings, logger: Logger): Promise<string | null> {
    const { englishLlmApiKey: apiKey, englishLlmBaseUrl: baseUrl, englishModelName: modelName } = settings;
    if (!apiKey || !baseUrl) {
        logger.error("无法执行中译日，因为缺少 LLM API Key 或 Base URL。");
        return null;
    }

    const prompt_content = `Translate the following Chinese text to Japanese. Provide only the translation, without any explanations, introductory phrases, or extra text. The output should be the Japanese text and nothing else.

Chinese text: "${text}"`;

    const messages = [
        { "role": "system", "content": "You are a highly efficient translation engine. You only output the translated Japanese text, with no additional content." },
        { "role": "user", "content": prompt_content }
    ];

    try {
        const response = await postChatCompletion(baseUrl, apiKey, {
            model: modelName,
            messages: messages,
            temperature: 0.0, // Set to 0 for deterministic translation
        });

        if (response.status === 200) {
            return chatContent(response).trim() || null;
        } else {
            logger.error(`Japanese translation API request failed with status ${response.status}`, { response: response.text });
            return null;
        }
    } catch (error) {
        logger.error(`Japanese translation call failed for text "${text}"`, error);
        return null;
    }
}