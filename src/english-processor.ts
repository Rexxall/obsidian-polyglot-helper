import { Notice, App } from 'obsidian';
import { ApiConfig, PolyglotHelperSettings } from './types';
import { Logger } from './shared/Logger';
import { getDictionaryInfoTS } from './apis/dictionary';
import { getUrbanDictionaryInfoTS } from './apis/urban';
import { getMwThesaurusInfoTS, getMwMedicalInfoTS } from './apis/merriam-webster';
import { getRelatedIdiomsTS } from './apis/idioms';
import { getEtymologyInfoTS } from './apis/etymology';
import { getTatoebaExamplesTS } from './apis/tatoeba';
import { getLlmInfoTS, getChineseTranslationTS, LlmWordInfo } from './apis/llm';
import { extractRootWord, ENGLISH_STOP_WORDS, getAudioUrl, getImageUrl } from './utils';
import { getCambridgeInfoTS } from './apis/cambridge';
import { getFromCache, saveToCache } from './cache';

import { errorMessage } from './shared/errors';
async function _processSingleWordOrPhrase(
    word: string,
    forceRefresh: boolean,
    settings: PolyglotHelperSettings,
    logger: Logger,
    app: App,
    pluginDir: string | undefined,
    apiConfig?: ApiConfig
): Promise<string | null> {
    try {
        if (!pluginDir) {
            throw new Error("无法确定插件目录以管理缓存。");
        }

        const activeSections = Object.entries(settings.englishSections)
            .filter(([, isActive]) => isActive)
            .map(([key]) => key)
            .join(',');
        const cacheKey = `${word}-${activeSections}`;

        if (!forceRefresh) {
            const cachedResult = await getFromCache<string>(app, pluginDir, 'english', cacheKey);
            if (cachedResult) {
                logger.info(`Using cached result for "${word}".`);
                return cachedResult;
            }
        }

        // 获取核心中文翻译用于标题
        const shortMeaning = await getChineseTranslationTS(word, settings, logger, apiConfig);

        const sections = settings.englishSections;
        const rootWord = extractRootWord(word);

        // 每个来源单独兜底：失败只记日志，结果当作没有
        const safely = async <T>(name: string, enabled: boolean | undefined, run: () => Promise<T>): Promise<T | null> => {
            if (!enabled) return null;
            try {
                return await run();
            } catch (error) {
                logger.error(`API call failed for ${name}`, error);
                return null;
            }
        };
        const [dictionary, urban, thesaurus, medical, etymology, idioms, tatoeba, cambridge] = await Promise.all([
            safely('dictionary', sections.definitions, () => getDictionaryInfoTS(rootWord, logger)),
            safely('urban', sections.slang, () => getUrbanDictionaryInfoTS(word, logger)),
            safely('thesaurus', sections.definitions, () => getMwThesaurusInfoTS(rootWord, settings.mwThesaurusKey, logger)),
            safely('medical', sections.medical, () => getMwMedicalInfoTS(rootWord, settings.mwMedicalKey, logger)),
            safely('etymology', sections.etymology, () => getEtymologyInfoTS(rootWord, logger)),
            safely('idioms', sections.idioms, () => getRelatedIdiomsTS(word, logger)),
            safely('tatoeba', sections.tatoeba, () => getTatoebaExamplesTS(word, logger)),
            safely('cambridge', sections.definitions, () => getCambridgeInfoTS(rootWord, logger)),
        ]);
        const data = { dictionary, urban, thesaurus, medical, etymology, idioms, tatoeba, cambridge };

        const llmData: LlmWordInfo = await getLlmInfoTS(word, settings, data, logger, apiConfig) || {};

        const wordInfo = {
            word,
            phonetics: cambridge?.us_phonetic || dictionary?.phonetics || '',
            uk_phonetic: cambridge?.uk_phonetic || '',
            us_phonetic: cambridge?.us_phonetic || '',
            english_definition: dictionary?.meanings || [],
            cambridge_definitions: cambridge?.definitions || [],
            pos: llmData.pos || cambridge?.pos || thesaurus?.partOfSpeech || '',
            synonyms: llmData.synonyms || Array.from(new Set([...(dictionary?.synonyms || []), ...(thesaurus?.synonyms || [])])),
            antonyms: llmData.antonyms || Array.from(new Set([...(dictionary?.antonyms || []), ...(thesaurus?.antonyms || [])])),
            meaning: llmData.meaning || '',
            example: llmData.example || '',
            translation: llmData.translation || '',
            etymology: llmData.etymology || '',
            collocations: llmData.collocations || [],
            mnemonic: llmData.mnemonic || '',
            medical_usage: llmData.medical_usage || '',
            medical_field: llmData.medical_field || '',
            slang_meaning: llmData.slang_meaning || '',
            slang_example: llmData.slang_example || '',
            tags: llmData.tags || [],
            detailed_etymology: etymology?.etymology || '',
            tatoeba_examples: tatoeba?.examples || [],
            medical_definitions_api: medical?.medical_definitions || [],
            slang_meaning_api: urban?.slang_meaning || '',
            slang_example_api: urban?.slang_example || '',
            audio_url: getAudioUrl(word),
            image_url: getImageUrl(word),
        };

        const header = `## ${word} ${shortMeaning ? `- ${shortMeaning}` : ''}`;
        const output: string[] = [header];
        
        if (wordInfo.audio_url) {
            output.push(`<audio controls src="${wordInfo.audio_url}" style="height: 30px;"></audio>`);
        }
        
        const infoCallout = [];
        if (wordInfo.image_url) infoCallout.push(`- **视觉助记**: [查看图片](${wordInfo.image_url})`);
        const phoneticsParts = [];
        if (wordInfo.uk_phonetic) phoneticsParts.push(`UK: ${wordInfo.uk_phonetic}`);
        if (wordInfo.us_phonetic) phoneticsParts.push(`US: ${wordInfo.us_phonetic}`);
        if (phoneticsParts.length > 0) {
            infoCallout.push(`- **音标**: ${phoneticsParts.join(' | ')}`);
        } else if (wordInfo.phonetics) {
            infoCallout.push(`- **音标**: ${wordInfo.phonetics}`);
        }
        if (wordInfo.pos) infoCallout.push(`- **词性**: ${wordInfo.pos}`);
        if (wordInfo.meaning) infoCallout.push(`- **含义**: ${wordInfo.meaning}`);
        if (infoCallout.length > 0) {
            output.push(`> [!info] 核心释义\n${infoCallout.map(line => `> ${line}`).join('\n')}`);
        }

        const definitionCallout = [];
        if (wordInfo.english_definition?.length > 0) {
            definitionCallout.push(`- **Dictionary API**:\n${wordInfo.english_definition.map((d) => `  - ${d}`).join('\n')}`);
        }
        if (wordInfo.cambridge_definitions?.length > 0) {
            definitionCallout.push(`- **剑桥词典**:\n${wordInfo.cambridge_definitions.map((d) => `  - ${d}`).join('\n')}`);
        }
        if (definitionCallout.length > 0) {
            output.push(`> [!abstract] 详细释义\n${definitionCallout.map(line => `> ${line.replace(/\n/g, '\n> ')}`).join('\n> \n')}`);
        }

        const exampleCallout = [];
        if (wordInfo.example) {
            exampleCallout.push(`- ${wordInfo.example}`);
            if (wordInfo.translation) {
                exampleCallout.push(`  - ${wordInfo.translation}`);
            }
        }
        if (wordInfo.tatoeba_examples?.length > 0) {
            wordInfo.tatoeba_examples.forEach((ex) => {
                let tatoebaLine = `- ${ex.eng}`;
                if (ex.cmn) {
                    tatoebaLine += `\n  - ${ex.cmn}`;
                }
                exampleCallout.push(tatoebaLine);
            });
        }
        if (exampleCallout.length > 0) {
            output.push(`> [!example] 例句用法\n${exampleCallout.map(line => `> ${line.replace(/\n/g, '\n> ')}`).join('\n> \n')}`);
        }

        const usageCallout = [];
        if (wordInfo.collocations?.length > 0) usageCallout.push(`- **常见搭配**: ${wordInfo.collocations.join('; ')}`);
        if (wordInfo.synonyms?.length > 0) usageCallout.push(`- **同义词**: ${wordInfo.synonyms.join(', ')}`);
        if (wordInfo.antonyms?.length > 0) usageCallout.push(`- **反义词**: ${wordInfo.antonyms.join(', ')}`);
        if (wordInfo.mnemonic) usageCallout.push(`- **记忆技巧**: ${wordInfo.mnemonic}`);
        if (usageCallout.length > 0) {
            output.push(`> [!tip] 用法助记\n${usageCallout.map(line => `> ${line}`).join('\n')}`);
        }
        
        const etymologyCallout = [];
        if (wordInfo.etymology) etymologyCallout.push(`- ${wordInfo.etymology}`);
        if (wordInfo.detailed_etymology) etymologyCallout.push(`- **详细词源**: ${wordInfo.detailed_etymology}`);
        if (etymologyCallout.length > 0) {
            output.push(`> [!cite] 词源\n${etymologyCallout.map(line => `> ${line}`).join('\n')}`);
        }

        const medicalCallout = [];
        if (wordInfo.medical_usage) medicalCallout.push(`- **医学用法**: ${wordInfo.medical_usage}`);
        if (wordInfo.medical_field) medicalCallout.push(`- **相关领域**: ${wordInfo.medical_field}`);
        if (wordInfo.medical_definitions_api?.length > 0) medicalCallout.push(`- **API定义**: ${wordInfo.medical_definitions_api.join('; ')}`);
        if (medicalCallout.length > 0) {
            output.push(`> [!bug] 医学专用\n${medicalCallout.map(line => `> ${line}`).join('\n')}`);
        }

        const slangCallout = [];
        if (wordInfo.slang_meaning) slangCallout.push(`- **俚语含义**: ${wordInfo.slang_meaning}`);
        if (wordInfo.slang_example) slangCallout.push(`- **俚语例句**: ${wordInfo.slang_example}`);
        if (slangCallout.length > 0) {
            output.push(`> [!note] 俚语\n${slangCallout.map(line => `> ${line}`).join('\n')}`);
        }
        
        const formattedResult = output.join('\n\n');

        await saveToCache(app, pluginDir, 'english', cacheKey, formattedResult);
        logger.info(`Result for "${word}" cached successfully.`);
        
        return formattedResult;

    } catch (e) {
        logger.error(`Error processing single word "${word}"`, e);
        return null;
    }
}

export async function runEnglishProcess(
    query: string,
    forceRefresh: boolean,
    settings: PolyglotHelperSettings,
    logger: Logger,
    app: App,
    pluginDir: string | undefined,
    saveSettings: () => Promise<void>,
    apiConfig?: ApiConfig
): Promise<string | null> {
    const notice = new Notice("正在处理...", 0);
    try {
        const potentialWords = query
            .split(/[\n\s,;]+/)
            .map(w => w.trim())
            .filter(w => w && !ENGLISH_STOP_WORDS.has(w.toLowerCase()));
        
        const uniqueWords = [...new Set(potentialWords)];

        let finalResult: string | null;

        if (uniqueWords.length > 1) {
            const total = uniqueWords.length;
            const results: string[] = [];
            for (let i = 0; i < total; i++) {
                const word = uniqueWords[i];
                notice.setMessage(`正在处理: ${word} (${i + 1}/${total})`);
                const result = await _processSingleWordOrPhrase(word, forceRefresh, settings, logger, app, pluginDir, apiConfig);
                if (result) {
                    results.push(result);
                }
            }
            finalResult = results.join('\n\n---\n\n');
        } else {
            finalResult = await _processSingleWordOrPhrase(query, forceRefresh, settings, logger, app, pluginDir, apiConfig);
        }

        if (finalResult) {
            // History is now added in main.ts
        }

        notice.hide();
        return finalResult;

    } catch (e) {
        notice.hide();
        new Notice(`处理失败: ${errorMessage(e)}`);
        logger.error("Error during English processing (TS)", e);
        return null;
    }
}
