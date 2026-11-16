import { Notice } from 'obsidian';
import { ApiConfig, PolyglotHelperSettings } from '../types';
import { Logger } from '../logger';

import { errorMessage } from '../shared/errors';
import { tr } from '../shared/i18n';
import { chat, describeAiError, isUsable } from '../ai/kit';

/** A full analysis is long; the strongest models take most of a minute. */
const ANALYSIS_TIMEOUT_MS = 150_000;
const NO_CONFIG = () => tr('还没有可用的 AI 配置。到设置 → 翻译与模型里加一套，选好密钥。', 'No AI configuration is ready. Add one in settings → Translation and models and pick a key.');
export async function getJapaneseTranslationTS(
    text: string,
    settings: PolyglotHelperSettings,
    logger: Logger,
    apiConfig?: ApiConfig | null
): Promise<string> {
    logger.info("获取日语翻译 (TS)...");

    if (!isUsable(apiConfig)) return NO_CONFIG();

    const sections = settings.japaneseSections;

    const vocabAnalysisSection = `> [!info] 词汇分析
> - **词性:** [请用中文说明词性]
> - **基本形:** [请填写基本形]
> - **读音:** [请填写完整读音（假名和拉丁字母读音）]
> - **解说:** [请用中文详细解说词源、用法等]`;

    const relatedVocabSection = `> [!abstract] 相关词汇辨析
> - **[相关词1] (<ruby>日文<rt>读音</rt></ruby>)**: [中文解释与原词的细微差别]
> - **[相关词2] (<ruby>日文<rt>读音</rt></ruby>)**: [中文解释与原词的细微差别]
> (请提供3-4个相关词汇辨析，确保所有内容都在callout块内)`;

    const sentencesSection = `> [!example] 日语例句 (3个不同场景)
> 1.  **场景: 请用中文描述场景1**
>     - 日文: [请填写例句1，所有汉字必须带ruby标签]
>     - *中文: [请填写例句1的中文翻译]*
> 2.  **场景: 请用中文描述场景2**
>     - 日文: [请填写例句2，所有汉字必须带ruby标签]
>     - *中文: [请填写例句2的中文翻译]*
> 3.  **场景: 请用中文描述场景3**
>     - 日文: [请填写例句3，所有汉字必须带ruby标签]
>     - *中文: [请填写例句3的中文翻译]*`;
    
    const exerciseSection = `> [!question] 翻译练习
> - 中文句子: [提供一个相关的中文句子或问题]
> - 参考答案: [日语答案，所有汉字带<ruby>注音</ruby>]`;

    const jishoSection = `> [!quote] Jisho 词典
> - [**单词1**](https://jisho.org/search/单词1) (<ruby>读音<rt>よみ</rt></ruby>): [中文简明释义]
> - [**单词2**](https://jisho.org/search/单词2) (<ruby>读音<rt>よみ</rt></ruby>): [中文简明释义]
> (请为文本中所有重要或困难的日语单词提供 Jisho.org 查词链接、ruby标签包裹的读音和中文定义)`;

    const requestedSections = [];
    if (sections.vocabAnalysis) requestedSections.push(vocabAnalysisSection);
    if (sections.relatedVocab) requestedSections.push(relatedVocabSection);
    if (sections.sentences) requestedSections.push(sentencesSection);
    if (sections.exercise) requestedSections.push(exerciseSection);
    if (sections.jisho) requestedSections.push(jishoSection);

    const prompt = `
        请将以下中文句子翻译成自然的日语，并提供详细的解析和相关内容。
        **要求：**
        1.  对于翻译结果和所有后续日语文本（包括解析中的词汇、其他句型、练习答案），**必须**为所有汉字 (Kanji) 提供平假名注音，并**严格使用** HTML \`<ruby>标签格式\`。例如，"日本語" 必须写成 "<ruby>日本語<rt>にほんご</rt></ruby>"。
        2.  纯假名（平假名/片假名）部分直接显示，无需注音。
        3.  如果请求了 "Jisho 词典" 板块，请为文本中的重点日语词汇生成查询链接。
        4.  **不要**在回复中包含任何与要求格式无关的介绍性文字、结束语、说明或任何音频/多媒体元素。
        5.  **严格按照**以下 Markdown 格式进行回复，确保标题和编号完全一致。**每个版块必须严格包含在各自的 Callout 块中，绝不能将一个版块的内容插入到另一个版块中。**

        > [!success] 翻译结果
        > - **敬语型:** [原文的日语翻译（敬语型），所有汉字带<ruby>注音</ruby>，并在翻译结果中将与原文 "${text}" 对应的部分用 **加粗**]
        > - **口语型:** [原文的日语翻译（口语型），所有汉字带<ruby>注音</ruby>，并在翻译结果中将与原文 "${text}" 对应的部分用 **加粗**]

        ${requestedSections.join('\n\n')}
        
        ---
        分析対象: "${text}"
    `;

    try {
        const content = await chat(apiConfig, {
            system: "You are a Japanese language teacher who provides analysis in Markdown format.",
            user: prompt,
            temperature: 0.3,
            maxTokens: 8192,
            timeoutMs: ANALYSIS_TIMEOUT_MS,
        });
        if (content.trim()) return content;
        logger.error('获取日语分析时模型返回了空内容');
        return tr("模型没有返回内容。换一个模型再试。", "The model returned nothing. Try another model.");
    } catch (error) {
        logger.error("调用LLM进行日语分析时出错", errorMessage(error));
        return describeAiError(error);
    }
}

export async function getJapaneseSimpleTranslationTS(
    query: string,
    settings: PolyglotHelperSettings,
    logger: Logger,
    apiConfig?: ApiConfig | null
): Promise<{ translation: string; reading: string; } | null> {
    const prompt = `あなたはプロの日本語翻訳家です。以下の日本語の単語やフレーズを、最も一般的で口語的な中国語に翻訳してください。結果は純粋なJSONオブジェクト（\`\`\`json\`のようなマークダウンなし）で、{"translation": "翻译结果", "reading": "日文假名"}の形式で返してください。例：入力が「こんにちは」の場合、{"translation": "你好", "reading": "こんにちは"}を返します。

入力: "${query}"`;

    if (!isUsable(apiConfig)) {
        new Notice(NO_CONFIG());
        return null;
    }

    try {
        const content = await chat(apiConfig, {
            system: "You are a translation assistant that only returns pure JSON objects.",
            user: prompt,
            temperature: 0.1,
            json: true,
        });
        try {
            const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const result = JSON.parse(match ? match[1] : content) as { translation?: unknown; reading?: unknown };
            if (typeof result.translation !== 'string') throw new Error('no translation field');
            logger.info(`成功解析快捷日语翻译: ${query} -> ${result.translation}`);
            return { translation: result.translation, reading: typeof result.reading === 'string' ? result.reading : '' };
        } catch (e) {
            logger.error("解析快捷日语翻译的JSON响应失败.", { error: errorMessage(e), content });
            return null;
        }
    } catch (error) {
        logger.error("调用LLM进行快捷翻译时出错", errorMessage(error));
        new Notice(describeAiError(error));
        return null;
    }
} 