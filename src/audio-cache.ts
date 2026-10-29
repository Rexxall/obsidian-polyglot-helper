import { App } from 'obsidian';
import { PolyglotHelperSettings } from './types';
import { Logger } from './shared/Logger';
import { getTtsAudioTS } from './apis/tts';
import { cleanFileName } from './file-utils';

import { tr } from './shared/i18n';
/**
 * 统一的音频缓存管理器
 * 避免重复生成相同文本的音频文件
 */
export class AudioCacheManager {
    // 内存缓存：文本 -> 文件路径
    private audioCache: Map<string, string> = new Map();
    
    constructor(
        private app: App,
        private settings: PolyglotHelperSettings,
        private logger: Logger
    ) {}

    /**
     * 生成一致的音频文件名（相同文本生成相同文件名）
     */
    private generateAudioFileName(text: string): string {
        const cleanText = text.replace(/<ruby>.*?<rt>.*?<\/rt><\/ruby>/g, '$1');
        const baseName = cleanFileName(cleanText, 30);
        // 使用文本内容的哈希值作为唯一标识
        const hash = Array.from(text).reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0).toString(16);
        return `${baseName}_${hash}.mp3`;
    }

    /**
     * 获取或生成音频文件
     * @param text 要生成音频的文本
     * @param audioDir 音频文件保存目录
     * @param forceRefresh 是否强制刷新，忽略缓存重新生成
     * @returns 音频文件路径，如果失败返回null
     */
    async getOrCreateAudio(text: string, audioDir: string, forceRefresh: boolean = false): Promise<string | null> {
        const cleanedText = text.replace(/<ruby>(.*?)<rt>.*?<\/rt><\/ruby>/g, '$1').replace(/\*\*/g, '').trim();
        if (!cleanedText || cleanedText.length === 0) {
            return null;
        }

        // 生成文件路径
        const fileName = this.generateAudioFileName(cleanedText);
        const newAudioFilePath = `${audioDir}/${fileName}`;

        // 如果不是强制刷新，检查缓存
        if (!forceRefresh) {
            // 1. 检查内存缓存
            let audioFilePath = this.audioCache.get(cleanedText);
            if (audioFilePath) {
                // 验证文件是否仍然存在
                const exists = await this.app.vault.adapter.exists(audioFilePath);
                if (exists) {
                    this.logger.info(`🎯 使用内存缓存音频: "${cleanedText}" -> ${audioFilePath}`);
                    return audioFilePath;
                } else {
                    // 文件不存在，从缓存中移除
                    this.audioCache.delete(cleanedText);
                    this.logger.warn(`⚠️ 缓存的音频文件不存在，已清理: ${audioFilePath}`);
                }
            }

            // 2. 检查文件系统缓存
            const fileExists = await this.app.vault.adapter.exists(newAudioFilePath);
            if (fileExists) {
                // 文件已存在，更新内存缓存
                this.audioCache.set(cleanedText, newAudioFilePath);
                this.logger.info(`📁 使用已存在的音频文件: "${cleanedText}" -> ${newAudioFilePath}`);
                return newAudioFilePath;
            }
        } else {
            this.logger.info(`🔄 强制刷新音频: "${cleanedText}"`);
            // 强制刷新时，删除旧的音频文件
            const fileExists = await this.app.vault.adapter.exists(newAudioFilePath);
            if (fileExists) {
                try {
                    await this.app.vault.adapter.remove(newAudioFilePath);
                    this.logger.info(`🗑️ 删除旧音频文件: ${newAudioFilePath}`);
                } catch (error) {
                    this.logger.warn(`删除旧音频文件失败: ${newAudioFilePath}`, error);
                }
            }
            // 从内存缓存中移除
            this.audioCache.delete(cleanedText);
        }

        // 3. 生成新的音频
        try {
            const logPrefix = forceRefresh ? tr('🔄 强制重新生成音频', '🔄 Regenerate audio') : tr('🎵 生成新音频', '🎵 Generate new audio');
            this.logger.info(`${logPrefix}: "${cleanedText}"`);
            const audioContent = await getTtsAudioTS(cleanedText, this.settings, this.logger);

            if (audioContent instanceof ArrayBuffer) {
                // 确保目录存在
                await this.ensureDirectoryExists(audioDir);

                // 保存音频文件
                this.logger.info(`💾 保存音频文件: ${newAudioFilePath}`);
                await this.app.vault.createBinary(newAudioFilePath, audioContent);

                // 更新内存缓存
                this.audioCache.set(cleanedText, newAudioFilePath);

                // 验证文件是否保存成功
                const exists = await this.app.vault.adapter.exists(newAudioFilePath);
                this.logger.info(`✅ 音频文件保存${exists ? '成功' : '失败'}: ${newAudioFilePath}`);

                return exists ? newAudioFilePath : null;
            } else {
                this.logger.warn(`❌ 音频生成失败: "${cleanedText}"`);
                return null;
            }
        } catch (error) {
            this.logger.error(`💥 音频生成异常: "${cleanedText}"`, error);
            return null;
        }
    }

    /**
     * 确保目录存在
     */
    private async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            if (!(await this.app.vault.adapter.exists(dirPath))) {
                await this.app.vault.adapter.mkdir(dirPath);
                this.logger.info(`📁 创建音频目录: ${dirPath}`);
            }
        } catch (error) {
            this.logger.error(`创建目录失败: ${dirPath}`, error);
        }
    }

    /**
     * 清理音频缓存
     */
    clearCache(): void {
        this.audioCache.clear();
        this.logger.info('🧹 音频缓存已清理');
    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats(): { size: number; entries: string[] } {
        return {
            size: this.audioCache.size,
            entries: Array.from(this.audioCache.keys())
        };
    }

    /**
     * 预热缓存（扫描现有音频文件）
     */
    async warmupCache(audioDir: string): Promise<void> {
        try {
            if (await this.app.vault.adapter.exists(audioDir)) {
                const files = await this.app.vault.adapter.list(audioDir);
                let count = 0;
                
                for (const file of files.files) {
                    if (file.endsWith('.mp3')) {
                        // 从文件名推断原始文本（简化实现）
                        const fileName = file.split('/').pop()?.replace('.mp3', '') || '';
                        const parts = fileName.split('_');
                        if (parts.length >= 2) {
                            const baseName = parts.slice(0, -1).join('_');
                            // 这里只是简单的预热，实际使用时会重新验证
                            this.audioCache.set(baseName, file);
                            count++;
                        }
                    }
                }
                
                this.logger.info(`🔥 音频缓存预热完成: ${count} 个文件`);
            }
        } catch (error) {
            this.logger.error('音频缓存预热失败', error);
        }
    }
}
