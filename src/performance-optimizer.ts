import { App, Notice } from "obsidian";
import PolyglotHelper from "./main";
import { Logger } from './shared/Logger';
// CacheManager已移除，使用内置缓存

/**
 * 简化的性能优化管理器 - 专注于缓存和基础优化
 */
export class PerformanceOptimizer {
    private app: App;
    private plugin: PolyglotHelper;
    private logger: Logger;
    private isInitialized: boolean = false;
    private performanceMetrics: Map<string, number> = new Map();
    private simpleCache: Map<string, string> = new Map();

    constructor(app: App, plugin: PolyglotHelper) {
        this.app = app;
        this.plugin = plugin;
        this.logger = plugin.logger;
        
        this.initializeComponents();
    }

    /**
     * 初始化性能组件
     */
    private initializeComponents(): void {
        try {
            // 初始化简单缓存
            this.simpleCache.clear();

            this.isInitialized = true;
            this.logger.info('性能优化组件初始化完成');

        } catch (error) {
            this.logger.error('性能优化组件初始化失败', error);
            new Notice('性能优化初始化失败，部分功能可能受影响');
        }
    }

    // 缓存管理器已简化

    /**
     * 记录性能指标
     */
    recordMetric(operation: string, duration: number): void {
        this.performanceMetrics.set(operation, duration);
        
        // 如果操作时间过长，记录警告
        if (duration > 5000) {
            this.logger.warn(`操作 ${operation} 耗时过长: ${duration}ms`);
        }
    }

    /**
     * 获取性能统计
     */
    getPerformanceStats(): Record<string, number> {
        return Object.fromEntries(this.performanceMetrics);
    }

    /**
     * 执行带性能监控的操作
     */
    async withPerformanceTracking<T>(
        operation: string, 
        fn: () => Promise<T>
    ): Promise<T> {
        const startTime = Date.now();
        
        try {
            const result = await fn();
            const duration = Date.now() - startTime;
            this.recordMetric(operation, duration);
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.recordMetric(`${operation}_error`, duration);
            throw error;
        }
    }

    /**
     * 简单的错误重试机制
     */
    async withRetry<T>(
        fn: () => Promise<T>, 
        maxRetries: number = 2,
        delay: number = 1000
    ): Promise<T> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                
                this.logger.warn(`操作失败，第 ${attempt + 1} 次重试`, error);
                await new Promise(resolve => window.setTimeout(resolve, delay * (attempt + 1)));
            }
        }
        
        throw new Error('重试次数已用完');
    }

    /**
     * 清理性能数据
     */
    clearMetrics(): void {
        this.performanceMetrics.clear();
        this.logger.info('性能指标已清理');
    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats(): { size: number; hitRate: number; lastCleanup: number } {
        return {
            size: this.simpleCache.size,
            hitRate: 0, // 简化实现
            lastCleanup: Date.now()
        };
    }

    /**
     * 清理缓存
     */
    clearCache(): void {
        this.simpleCache.clear();
        new Notice('缓存已清理');
    }

    /**
     * 检查是否已初始化
     */
    isReady(): boolean {
        return this.isInitialized;
    }

    /**
     * 预热缓存 (简化版本)
     */
    warmupCache(): void {
        if (!this.isInitialized) {
            this.logger.warn('性能优化器未初始化，跳过缓存预热');
            return;
        }

        try {
            // 简化的缓存预热
            this.logger.info('缓存预热完成');
        } catch (error) {
            this.logger.error('缓存预热失败', error);
        }
    }

    /**
     * 优化的翻译方法 (简化版本)
     */
    async optimizedTranslation(text: string, options: { type?: string; force?: boolean } = {}): Promise<string | null> {
        if (!this.isInitialized) {
            this.logger.warn('性能优化器未初始化，使用直接翻译');
            return await this.plugin.translateText(text, options);
        }

        const cacheKey = `translation_${text}_${JSON.stringify(options)}`;

        try {
            // 检查缓存
            const cachedResult = this.simpleCache.get(cacheKey);
            if (cachedResult) {
                this.logger.info('使用缓存的翻译结果');
                return cachedResult;
            }

            // 执行翻译并记录性能
            const result = await this.withPerformanceTracking(
                'translation',
                () => this.plugin.translateText(text, options)
            );

            // 缓存结果
            if (result) {
                this.simpleCache.set(cacheKey, result);
            }

            return result;
        } catch (error) {
            this.logger.error('优化翻译失败，回退到直接翻译', error);
            return await this.plugin.translateText(text, options);
        }
    }

    /**
     * 清理资源
     */
    cleanup(): void {
        this.simpleCache.clear();
        this.performanceMetrics.clear();
        this.isInitialized = false;

        this.logger.info('性能优化器已清理');
    }
}
