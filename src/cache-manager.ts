import { App, Notice } from 'obsidian';
import { Logger } from './shared/Logger';

export interface CacheItem {
    path: string;
    name: string;
    type: 'translation' | 'audio';
    category: string;
    size: number;
    lastModified: number;
    content?: any;
}

export interface CacheFilter {
    type?: 'translation' | 'audio' | 'all';
    category?: string;
    olderThan?: number; // 天数
    largerThan?: number; // 字节数
    pattern?: string; // 文件名模式
}

/**
 * 高级缓存管理器
 * 提供筛选、预览、批量清理等功能
 */
export class CacheManager {
    constructor(
        private app: App,
        private logger: Logger,
        private pluginDir: string
    ) {}

    /**
     * 扫描所有缓存文件
     */
    async scanAllCache(): Promise<CacheItem[]> {
        const items: CacheItem[] = [];

        // 扫描翻译缓存
        await this.scanTranslationCache(items);
        
        // 扫描音频缓存
        await this.scanAudioCache(items);

        return items.sort((a, b) => b.lastModified - a.lastModified);
    }

    /**
     * 扫描翻译缓存
     */
    private async scanTranslationCache(items: CacheItem[]): Promise<void> {
        const cacheDirs = [`${this.pluginDir}/.cache`];

        for (const cacheDir of cacheDirs) {
            try {
                const exists = await this.app.vault.adapter.exists(cacheDir);
                if (!exists) continue;

                const list = await this.app.vault.adapter.list(cacheDir);
                
                // 扫描子目录
                for (const subdir of list.folders) {
                    await this.scanCacheDirectory(subdir, 'translation', items);
                }

                // 扫描直接文件
                for (const file of list.files) {
                    if (file.endsWith('.json')) {
                        await this.addCacheItem(file, 'translation', 'direct', items);
                    }
                }
            } catch (error) {
                this.logger.warn(`扫描缓存目录失败: ${cacheDir}`, error);
            }
        }
    }

    /**
     * 扫描音频缓存
     */
    private async scanAudioCache(items: CacheItem[]): Promise<void> {
        // 使用Set来避免重复扫描同一个文件
        const scannedFiles = new Set<string>();

        // Audio saved to notes is a user asset. Only private voice-cache is disposable.
        const directory = `${this.pluginDir}/voice-cache`;
        if (await this.app.vault.adapter.exists(directory)) {
            await this.scanAudioDirectory(directory, items, scannedFiles);
        }
    }

    /**
     * 扫描缓存目录
     */
    private async scanCacheDirectory(dirPath: string, type: 'translation' | 'audio', items: CacheItem[]): Promise<void> {
        try {
            const list = await this.app.vault.adapter.list(dirPath);
            
            for (const file of list.files) {
                if (file.endsWith('.json')) {
                    const category = dirPath.split('/').pop() || 'unknown';
                    await this.addCacheItem(file, type, category, items);
                }
            }

            // 递归扫描子目录
            for (const subdir of list.folders) {
                await this.scanCacheDirectory(subdir, type, items);
            }
        } catch (error) {
            this.logger.warn(`扫描目录失败: ${dirPath}`, error);
        }
    }

    /**
     * 扫描音频目录
     */
    private async scanAudioDirectory(dirPath: string, items: CacheItem[], scannedFiles?: Set<string>): Promise<void> {
        try {
            const list = await this.app.vault.adapter.list(dirPath);

            for (const file of list.files) {
                if (file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.m4a')) {
                    // 检查是否已经扫描过这个文件
                    if (scannedFiles && scannedFiles.has(file)) {
                        continue;
                    }

                    const category = dirPath.split('/').pop() || 'audio';
                    await this.addCacheItem(file, 'audio', category, items);

                    // 标记文件已扫描
                    if (scannedFiles) {
                        scannedFiles.add(file);
                    }
                }
            }

            // 递归扫描子目录
            for (const subdir of list.folders) {
                await this.scanAudioDirectory(subdir, items, scannedFiles);
            }
        } catch (error) {
            this.logger.warn(`扫描音频目录失败: ${dirPath}`, error);
        }
    }

    /**
     * 添加缓存项
     */
    private async addCacheItem(filePath: string, type: 'translation' | 'audio', category: string, items: CacheItem[]): Promise<void> {
        try {
            const stat = await this.app.vault.adapter.stat(filePath);
            if (!stat) return;

            const fileName = filePath.split('/').pop() || '';
            
            const item: CacheItem = {
                path: filePath,
                name: fileName,
                type,
                category,
                size: stat.size,
                lastModified: stat.mtime
            };

            // 对于翻译缓存，尝试读取内容获取更多信息
            if (type === 'translation' && filePath.endsWith('.json')) {
                try {
                    const content = await this.app.vault.adapter.read(filePath);
                    item.content = JSON.parse(content);
                } catch (error) {
                    // 忽略读取错误
                }
            }

            items.push(item);
        } catch (error) {
            this.logger.warn(`添加缓存项失败: ${filePath}`, error);
        }
    }

    /**
     * 根据筛选条件过滤缓存项
     */
    filterCache(items: CacheItem[], filter: CacheFilter): CacheItem[] {
        return items.filter(item => {
            // 类型筛选
            if (filter.type && filter.type !== 'all' && item.type !== filter.type) {
                return false;
            }

            // 分类筛选
            if (filter.category && item.category !== filter.category) {
                return false;
            }

            // 时间筛选（早于指定天数）
            if (filter.olderThan) {
                const cutoffTime = Date.now() - (filter.olderThan * 24 * 60 * 60 * 1000);
                if (item.lastModified > cutoffTime) {
                    return false;
                }
            }

            // 大小筛选（大于指定字节数）
            if (filter.largerThan && item.size <= filter.largerThan) {
                return false;
            }

            // 模式筛选
            if (filter.pattern) {
                const regex = new RegExp(filter.pattern, 'i');
                if (!regex.test(item.name)) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * 批量删除缓存项
     */
    async deleteItems(items: CacheItem[]): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        for (const item of items) {
            try {
                const privateRoots = [`${this.pluginDir}/.cache/`, `${this.pluginDir}/voice-cache/`];
                if (!this.pluginDir || item.path.split('/').includes('..') ||
                    !privateRoots.some(root => item.path.startsWith(root))) {
                    throw new Error('此文件不是插件私有缓存，已保留。');
                }
                await this.app.vault.adapter.remove(item.path);
                this.logger.info(`删除缓存文件: ${item.path}`);
                success++;
            } catch (error) {
                this.logger.error(`删除缓存文件失败: ${item.path}`, error);
                failed++;
            }
        }

        return { success, failed };
    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats(items: CacheItem[]): {
        total: number;
        byType: Record<string, number>;
        byCategory: Record<string, number>;
        totalSize: number;
    } {
        const stats = {
            total: items.length,
            byType: {} as Record<string, number>,
            byCategory: {} as Record<string, number>,
            totalSize: 0
        };

        for (const item of items) {
            stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
            stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
            stats.totalSize += item.size;
        }

        return stats;
    }

    /**
     * 格式化文件大小
     */
    formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 格式化时间
     */
    formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return '今天';
        } else if (diffDays === 1) {
            return '昨天';
        } else if (diffDays < 7) {
            return `${diffDays}天前`;
        } else if (diffDays < 30) {
            return `${Math.floor(diffDays / 7)}周前`;
        } else {
            return `${Math.floor(diffDays / 30)}个月前`;
        }
    }
}
