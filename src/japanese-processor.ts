import { App, Notice } from 'obsidian';
import { ApiConfig, PolyglotHelperSettings } from './types';
import { Logger } from './shared/Logger';
import { getJapaneseTranslationTS, getJapaneseSimpleTranslationTS } from './apis/japanese-translation';


import { sleep } from './utils';
import { getFromCache, saveToCache } from './cache';
import { cleanFileName } from './file-utils';
import { AudioCacheManager } from './audio-cache';

import { errorMessage } from './shared/errors';
import { tr } from './shared/i18n';
export class JapaneseProcessor {
    constructor(
        private app: App,
        private settings: PolyglotHelperSettings,
        private logger: Logger,
        private pluginDir: string,
        private audioCacheManager: AudioCacheManager
    ) {}

    private async _createAudioDirectory(query: string): Promise<string> {
        const queryFolderName = cleanFileName(query, 30);
        const audioBaseSubdirVault = this.settings.japaneseAudioPath || 'Polyglot/Audio/Japanese';
        const audioSubdir = `${audioBaseSubdirVault}/${queryFolderName}`;
        
        // Use mkdir to create directory if it doesn't exist. It's idempotent.
        await this.app.vault.adapter.mkdir(audioSubdir);
        
        return audioSubdir;
    }

    private async _processMarkdownAndAudio(markdownResult: string, audioSubdir: string, forceRefresh: boolean = false): Promise<string> {
        const lines = markdownResult.split('\n');
        const finalLines: string[] = [];
        // 使用类级别的持久缓存，而不是每次创建新的
        const audioStyle = 'style="height: 20px; vertical-align: middle; margin-left: 5px;"';

        let currentSection: 'translation' | 'parsing' | 'sentences' | 'exercise' | 'jisho' | 'related' | null = null;
        const headerTranslation = /^>\s*\[!success\]/;
        const headerParsing = /^>\s*\[!info\]/;
        const headerSentences = /^>\s*\[!example\]/;
        const headerExercise = /^>\s*\[!question\]/;
        const headerJisho = /^>\s*\[!quote\]/;
        const headerRelated = /^>\s*\[!abstract\]/;

        for (const line of lines) {
            if (headerTranslation.test(line)) { currentSection = 'translation'; }
            else if (headerParsing.test(line)) { currentSection = 'parsing'; }
            else if (headerSentences.test(line)) { currentSection = 'sentences'; }
            else if (headerExercise.test(line)) { currentSection = 'exercise'; }
            else if (headerJisho.test(line)) { currentSection = 'jisho'; }
            else if (headerRelated.test(line)) { currentSection = 'related'; }

            let processedLine = line;
            let textToSpeak: string | null = null;
            
            if (currentSection) {
                textToSpeak = this.extractJapaneseText(line, currentSection);
            }

            if (textToSpeak && !this.settings.disableJapaneseVoiceDuringAnalysis) {
                // 使用统一的音频缓存管理器
                const audioFilePath = await this.audioCacheManager.getOrCreateAudio(textToSpeak, audioSubdir, forceRefresh);
                if (audioFilePath) {
                    // 生成简洁的音频路径引用
                    const cleanAudioPath = this.generateCleanAudioPath(audioFilePath);
                    processedLine += ` <audio src="${cleanAudioPath}" controls ${audioStyle}></audio>`;

                    // 增加延迟，避免API速率限制
                    await sleep(300);
                }
            }
            finalLines.push(processedLine);
        }
        return finalLines.join('\n');
    }

    /**
     * 生成简洁的音频路径引用
     */
    private generateCleanAudioPath(audioFilePath: string): string {
        // 移除不必要的路径前缀
        if (audioFilePath.startsWith('./')) {
            audioFilePath = audioFilePath.substring(2);
        }

        // 对于Obsidian，使用简单的相对路径即可
        // 不需要对整个路径进行URL编码，只需要确保路径格式正确
        return audioFilePath;
    }

    /**
     * 清理音频缓存（委托给音频缓存管理器）
     */
    clearAudioCache(): void {
        this.audioCacheManager.clearCache();
    }

    /**
     * 获取音频缓存统计信息（委托给音频缓存管理器）
     */
    getAudioCacheStats(): { size: number; entries: string[] } {
        return this.audioCacheManager.getCacheStats();
    }

    async runJapaneseProcess(query: string, force: boolean, apiConfig?: ApiConfig, saveSettings?: () => Promise<void>, currentFilePath?: string): Promise<{ original: string; colloquial: string; markdown: string } | null> {
        const sentence = query;
        if (!sentence) {
            new Notice(tr("查询内容为空。", "Nothing to look up."));
            return null;
        }

        // 检查是否是多行输入（按行分割处理）
        const lines = sentence.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        if (lines.length > 1) {
            // 多行输入，按每行单独处理
            return await this.runMultiLineJapaneseProcess(lines, force, apiConfig, saveSettings, currentFilePath);
        }

        // 单行处理（原有逻辑）
        const notice = new Notice(tr("正在处理日语翻译和分析...", "Translating and analysing the Japanese..."), 0);
        try {
            const activeJapaneseSections = Object.entries(this.settings.japaneseSections)
                .filter(([, isActive]) => isActive)
                .map(([key]) => key)
                .join(',');
            const cacheKey = `${sentence}-${activeJapaneseSections}`;

            // 检查缓存（除非强制刷新）
            if (!force) {
                const cachedResult = await getFromCache<{ original: string; colloquial: string; markdown: string }>(
                    this.app, this.pluginDir, 'japanese', cacheKey
                );
                if (cachedResult) {
                    notice.hide();
                    this.logger.info(`使用缓存结果: "${sentence}"`);
                    new Notice(tr("从缓存加载日语分析。", "Japanese analysis loaded from cache."));
                    return cachedResult;
                }
            }

            this.logger.info(`[Caching] Processing and will save with key: ${cacheKey}`);

            const markdownResult = await getJapaneseTranslationTS(sentence, this.settings, this.logger, apiConfig);
            if (!markdownResult) throw new Error("从 LLM 获取翻译失败。");

            const audioSubdir = await this._createAudioDirectory(sentence);
            const finalResult = await this._processMarkdownAndAudio(markdownResult, audioSubdir, force);

            const colloquialMatch = finalResult.match(/- \*\*口语型:\*\* (.*)/);
            const colloquialForm = colloquialMatch ? colloquialMatch[1].trim() : '';

            const result = { original: sentence, colloquial: colloquialForm, markdown: finalResult };

            // 保存到缓存
            await saveToCache(this.app, this.pluginDir, 'japanese', cacheKey, result);
            this.logger.info(`日语分析结果已缓存: "${sentence}"`);

            notice.hide();
            return result;

        } catch (error) {
            notice.hide();
            this.logger.error("处理日语时出错", error);
            new Notice(tr(`处理失败: ${errorMessage(error)}`, `Failed: ${errorMessage(error)}`));
            return null;
        }
    }

    /**
     * 处理多行日语输入，按每行单独处理并显示进度
     */
    private async runMultiLineJapaneseProcess(lines: string[], force: boolean, apiConfig?: ApiConfig, saveSettings?: () => Promise<void>, currentFilePath?: string): Promise<{ original: string; colloquial: string; markdown: string } | null> {
        const total = lines.length;
        
        // 创建进度通知
        const progressNotice = new Notice(tr(`正在处理 ${total} 个日语单词/短语... (0/${total})`, `Processing ${total} Japanese words or phrases... (0/${total})`), 0);
        
        try {
            for (let i = 0; i < total; i++) {
                const line = lines[i];
                
                // 更新进度
                progressNotice.setMessage(`正在处理: ${line} (${i + 1}/${total})`);
                
                // 处理单个单词/短语
                const singleResult = await this.runSingleLineJapaneseProcess(line, force, apiConfig);
                
                if (singleResult) {
                    // 立即输出到设置好的位置，并添加到查询历史
                    await this.outputSingleResultWithHistory(singleResult, line, saveSettings, currentFilePath);
                } else {
                    // 即使处理失败，也添加到查询历史
                    if (saveSettings) {
                        const { addQueryToHistory } = await import('./utils');
                        await addQueryToHistory(
                            this.settings,
                            saveSettings,
                            { 
                                query: line, 
                                type: 'japanese', 
                                sections: { ...this.settings.japaneseSections }, 
                                timestamp: Date.now() 
                            }
                        );
                    }
                }
                
                // 添加延迟，避免API速率限制
                if (i < total - 1) {
                    await sleep(500);
                }
            }
            
            progressNotice.hide();
            new Notice(tr(`✅ 已完成 ${total} 个日语单词/短语的处理`, `✅ Processed ${total} Japanese words or phrases`));
            
            // 不返回合并结果，因为每个结果都已经单独输出了
            return {
                original: lines.join('\n'),
                colloquial: '',
                markdown: `已处理 ${total} 个日语单词/短语，每个结果都已单独输出。`
            };
            
        } catch (error) {
            progressNotice.hide();
            this.logger.error("处理多行日语时出错", error);
            new Notice(tr(`处理失败: ${errorMessage(error)}`, `Failed: ${errorMessage(error)}`));
            return null;
        }
    }

    /**
     * 处理单个日语单词/短语
     */
    private async runSingleLineJapaneseProcess(line: string, force: boolean, apiConfig?: ApiConfig): Promise<{ original: string; colloquial: string; markdown: string } | null> {
        try {
            const activeJapaneseSections = Object.entries(this.settings.japaneseSections)
                .filter(([, isActive]) => isActive)
                .map(([key]) => key)
                .join(',');
            const cacheKey = `${line}-${activeJapaneseSections}`;

            // 检查缓存（除非强制刷新）
            if (!force) {
                const cachedResult = await getFromCache<{ original: string; colloquial: string; markdown: string }>(
                    this.app, this.pluginDir, 'japanese', cacheKey
                );
                if (cachedResult) {
                    this.logger.info(`使用缓存结果: "${line}"`);
                    return cachedResult;
                }
            }

            this.logger.info(`[Caching] Processing single line and will save with key: ${cacheKey}`);

            const markdownResult = await getJapaneseTranslationTS(line, this.settings, this.logger, apiConfig);
            if (!markdownResult) throw new Error("从 LLM 获取翻译失败。");

            const audioSubdir = await this._createAudioDirectory(line);
            const finalResult = await this._processMarkdownAndAudio(markdownResult, audioSubdir, force);

            const colloquialMatch = finalResult.match(/- \*\*口语型:\*\* (.*)/);
            const colloquialForm = colloquialMatch ? colloquialMatch[1].trim() : '';

            const result = { original: line, colloquial: colloquialForm, markdown: finalResult };

            // 保存到缓存
            await saveToCache(this.app, this.pluginDir, 'japanese', cacheKey, result);
            this.logger.info(`日语分析结果已缓存: "${line}"`);

            return result;

        } catch (error) {
            this.logger.error(`处理单个日语单词时出错: "${line}"`, error);
            return null;
        }
    }

    /**
     * 立即输出单个处理结果到设置好的位置，并添加到查询历史
     */
    private async outputSingleResultWithHistory(result: { original: string; colloquial: string; markdown: string }, originalLine: string, saveSettings?: () => Promise<void>, currentFilePath?: string): Promise<void> {
        try {
            // 生成标题
            const kihonkeiMatch = result.markdown.match(/> - \*\*基本形:\*\* (.*)/);
            let titlePart = kihonkeiMatch ? kihonkeiMatch[1].trim() : null;
            if (!titlePart) {
                const colloquialBoldMatch = result.colloquial.match(/\*\*(.*?)\*\*/);
                titlePart = colloquialBoldMatch ? colloquialBoldMatch[1] : result.colloquial;
            }

            const header = `## ${originalLine} - ${titlePart}`;
            const finalResult = `${header}\n\n${result.markdown}`;

            // 使用优先级输出处理
            const { handlePriorityOutput, addQueryToHistory } = await import('./utils');
            const outputInfo = await handlePriorityOutput(
                this.app,
                {
                    outputDestination: this.settings.outputDestination,
                    newFileLocation: this.settings.newFileLocation,
                    fixedOutputFile: this.settings.fixedOutputFile
                },
                this.settings.japaneseOutputSettings,
                this.logger,
                originalLine,
                finalResult,
                currentFilePath || '', // 传递当前文件路径
                undefined // 没有选择范围
            );

            // 单独添加每个单词/短语到查询历史
            if (outputInfo && saveSettings) {
                await addQueryToHistory(
                    this.settings,
                    saveSettings,
                    { 
                        query: originalLine, 
                        type: 'japanese', 
                        sections: { ...this.settings.japaneseSections }, 
                        timestamp: Date.now() 
                    },
                    outputInfo
                );
            }

        } catch (error) {
            this.logger.error(`输出单个结果时出错: "${originalLine}"`, error);
        }
    }

    private extractJapaneseText(line: string, section: 'translation' | 'parsing' | 'sentences' | 'exercise' | 'jisho' | 'related'): string | null {
        let pattern: RegExp | null = null;
        
        switch(section) {
            case 'translation':
                pattern = /^\s*>\s*[-・]\s*\*\*(?:敬语型|口语型):\*\*\s*(.*)/;
                break;
            case 'parsing':
                pattern = /^\s*>\s*[-・]\s*\*\*\[.*?\]\s*\*\((<ruby>.*?<\/ruby>)\):/;
                break;
            case 'sentences':
                pattern = /^\s*>\s*[-・]\s*日文:\s*(.*)/;
                break;
            case 'exercise':
                pattern = /^\s*>\s*[-・]\s*参考答案:\s*(.*)/;
                break;
            case 'jisho':
                pattern = /^\s*>\s*[-・]\s*\[\*\*.*?\*\*\]\(.*?\)\s*\((<ruby>.*?<\/ruby>)\):/;
                break;
            case 'related':
                pattern = /^\s*>\s*[-・]\s*\*\*(.*?)\*\*:/;
                break;
        }

        if (!pattern) return null;
    
        const match = line.match(pattern);
        if (match && match[1]) {
            const text = match[1];
            // Basic check for Japanese characters
            if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(text)) {
                 return text.trim();
            }
        }
        return null;
    }

    async runQuickJapaneseTranslation(query: string, force: boolean, apiConfig?: ApiConfig): Promise<{ translation: string; reading: string; audioFilePath: string | null } | null> {
        const notice = new Notice(tr("正在获取日语快捷翻译...", "Getting a quick Japanese translation..."), 0);
        try {
            if (!force) {
                const cachedResult = await getFromCache<{ translation: string; reading: string; audioFilePath: string | null }>(this.app, this.pluginDir, 'japanese', `quick_${query}`);
                if (cachedResult) {
                    notice.hide();
                    new Notice(tr("从缓存加载快捷翻译。", "Quick translation loaded from cache."));
                    this.logger.info(`快捷翻译命中缓存: ${query}`);
                    return cachedResult;
                }
            }

            const result = await getJapaneseSimpleTranslationTS(query, this.settings, this.logger, apiConfig);
            if (!result || !result.translation) {
                // throw new Error("从 LLM 获取翻译失败。");
                notice.hide();
                new Notice(tr("从 LLM 获取翻译失败。", "Could not get a translation from the model."));
                return null;
            }

            // 使用统一的音频缓存管理器
            const audioSubdir = await this._createAudioDirectory("QuickTranslations");
            const audioFilePath = await this.audioCacheManager.getOrCreateAudio(result.translation, audioSubdir, force);
            
            // 生成简洁的音频路径
            const cleanAudioPath = audioFilePath ? this.generateCleanAudioPath(audioFilePath) : null;
            const finalResult = { ...result, audioFilePath: cleanAudioPath };
            // Caching is now handled in main.ts
            // await saveToCache(this.app, this.pluginDir, 'japanese', `quick_${query}`, finalResult);
            
            notice.hide();
            return finalResult;

        } catch (error) {
            notice.hide();
            this.logger.error("处理日语快捷翻译时出错", error);
            new Notice(tr(`处理失败: ${errorMessage(error)}`, `Failed: ${errorMessage(error)}`));
            return null;
        }
    }
}