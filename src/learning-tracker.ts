import { App, Notice } from "obsidian";
import { PolyglotHelperSettings, VocabularyItem, JapaneseVocabularyItem, EnglishVocabularyItem, ReviewRecord } from "./types";

import { errorMessage } from "./shared/errors";
import { tr } from './shared/i18n';
/**
 * 学习进度追踪器
 * 实现间隔重复系统(SRS)和学习统计功能
 */
export class LearningTracker {
    private app: App;
    private settings: PolyglotHelperSettings;
    private saveSettings: () => Promise<void>;

    constructor(app: App, settings: PolyglotHelperSettings, saveSettings: () => Promise<void>) {
        this.app = app;
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    /**
     * 添加新单词到词汇库
     */
    async addVocabularyItem(word: string, translation: string, notes?: string, examples?: string[], tags?: string[]): Promise<void> {
        if (!this.settings.enableLearningTracker) return;

        // 如果单词已存在，只更新部分字段
        if (this.settings.vocabItems[word]) {
            const existingItem = this.settings.vocabItems[word];
            existingItem.translation = translation;
            if (notes) existingItem.notes = notes;
            if (examples) existingItem.examples = examples;
            if (tags) existingItem.tags = tags;
            new Notice(tr(`已更新单词 "${word}"`, `Updated "${word}"`));
        } else {
            // 创建新单词条目
            const newItem: VocabularyItem = {
                word,
                translation,
                notes,
                examples,
                tags,
                createdAt: Date.now(),
                reviewCount: 0,
                difficulty: 2, // 默认中等难度
                reviewHistory: [],
                nextReview: Date.now() // 设置为立即可复习
            };

            this.settings.vocabItems[word] = newItem;
            this.settings.learningStats.totalWords++;

            // 更新每日统计
            this.updateDailyStats(true, false, false, false);
        }
        
        await this.saveSettings();
    }

    /**
     * 删除词汇项
     */
    async removeVocabularyItem(word: string): Promise<void> {
        if (!this.settings.enableLearningTracker) return;

        if (this.settings.vocabItems[word]) {
            delete this.settings.vocabItems[word];
            this.settings.learningStats.totalWords--;
            await this.saveSettings();
            new Notice(tr(`已删除单词 "${word}"`, `Deleted "${word}"`));
        }
    }

    /**
     * 搜索词汇库
     */
    searchVocabulary(query: string): VocabularyItem[] {
        if (!query.trim()) return [];

        const searchTerm = query.toLowerCase();
        return Object.values(this.settings.vocabItems).filter(item =>
            item.word.toLowerCase().includes(searchTerm) ||
            item.translation.toLowerCase().includes(searchTerm) ||
            (item.notes && item.notes.toLowerCase().includes(searchTerm)) ||
            (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
        );
    }

    /**
     * 按标签获取词汇
     */
    getVocabularyByTag(tag: string): VocabularyItem[] {
        return Object.values(this.settings.vocabItems).filter(item =>
            item.tags && item.tags.includes(tag)
        );
    }

    /**
     * 获取所有标签
     */
    getAllTags(): string[] {
        const tags = new Set<string>();
        Object.values(this.settings.vocabItems).forEach(item => {
            if (item.tags) {
                item.tags.forEach(tag => tags.add(tag));
            }
        });
        return Array.from(tags).sort();
    }

    /**
     * 导出词汇库为JSON
     */
    exportVocabulary(): string {
        const exportData = {
            exportDate: new Date().toISOString(),
            totalWords: this.settings.learningStats.totalWords,
            vocabulary: Object.values(this.settings.vocabItems)
        };
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * 从JSON导入词汇库
     */
    async importVocabulary(jsonData: string): Promise<{ success: number; skipped: number; errors: string[] }> {
        const result: { success: number; skipped: number; errors: string[] } = { success: 0, skipped: 0, errors: [] };

        try {
            const data = JSON.parse(jsonData) as { vocabulary?: unknown } | null;
            if (!data || !Array.isArray(data.vocabulary)) {
                throw new Error('无效的词汇库格式');
            }

            for (const item of data.vocabulary as Partial<VocabularyItem>[]) {
                try {
                    if (!item.word || !item.translation) {
                        result.errors.push(`跳过无效项目: ${JSON.stringify(item)}`);
                        continue;
                    }

                    if (this.settings.vocabItems[item.word]) {
                        result.skipped++;
                        continue;
                    }

                    await this.addVocabularyItem(
                        item.word,
                        item.translation,
                        item.notes,
                        item.examples,
                        item.tags
                    );
                    result.success++;
                } catch (error) {
                    result.errors.push(`导入 "${item.word ?? ''}" 失败: ${errorMessage(error)}`);
                }
            }

            new Notice(tr(`导入完成: ${result.success} 成功, ${result.skipped} 跳过, ${result.errors.length} 错误`, `Import finished: ${result.success} added, ${result.skipped} skipped, ${result.errors.length} errors`));
        } catch (error) {
            result.errors.push(`解析JSON失败: ${errorMessage(error)}`);
        }

        return result;
    }

    /**
     * 记录单词复习结果
     * @param word 单词
     * @param performance 表现评分 (0-5)
     * @param timeSpent 花费时间(毫秒)
     */
    async recordReview(word: string, performance: number, timeSpent?: number): Promise<void> {
        if (!this.settings.enableLearningTracker || !this.settings.vocabItems[word]) return;
        
        const item = this.settings.vocabItems[word];
        
        // 记录本次复习
        const review: ReviewRecord = {
            timestamp: Date.now(),
            performance,
            timeSpent
        };
        
        item.reviewHistory.push(review);
        item.lastReviewed = review.timestamp;
        item.reviewCount++;
        
        // 根据表现调整难度
        if (performance <= 1) {
            item.difficulty = Math.min(4, item.difficulty + 1);
        } else if (performance >= 4) {
            item.difficulty = Math.max(0, item.difficulty - 1);
        }
        
        // 计算下次复习时间
        item.nextReview = this.calculateNextReview(item, performance);
        
        // 更新统计数据
        this.updateDailyStats(false, true, performance >= 3, performance < 3);
        this.settings.learningStats.totalReviews++;
        
        await this.saveSettings();
    }

    /**
     * 计算下次复习时间 - 增强版SRS算法
     * 基于SuperMemo 2算法的改进版本
     */
    private calculateNextReview(item: VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem, performance: number): number {
        // 如果表现很差，安排在近期复习
        if (performance <= 1) {
            return Date.now() + 1000 * 60 * 60; // 1小时后
        }

        // 计算易度因子 (Ease Factor)
        let easeFactor = this.getEaseFactor(item);

        // 根据表现调整易度因子
        easeFactor = this.adjustEaseFactor(easeFactor, performance);

        // 保存易度因子到单词项中
        if (!item.notes) item.notes = '';
        const easeFactorMatch = item.notes.match(/EF:([\d.]+)/);
        if (easeFactorMatch) {
            item.notes = item.notes.replace(/EF:[\d.]+/, `EF:${easeFactor.toFixed(2)}`);
        } else {
            item.notes += ` EF:${easeFactor.toFixed(2)}`;
        }

        // 计算基础间隔
        let interval = this.calculateBaseInterval(item.reviewCount, performance);

        // 应用易度因子
        if (item.reviewCount > 1) {
            interval = Math.round(interval * easeFactor);
        }

        // 根据难度进一步调整
        const difficultyFactor = [1.3, 1.15, 1.0, 0.85, 0.7][item.difficulty];
        interval = Math.round(interval * difficultyFactor);

        // 添加随机化因子，避免所有单词在同一天到期
        const randomFactor = 0.9 + Math.random() * 0.2; // 0.9-1.1
        interval = Math.round(interval * randomFactor);

        // 确保最小间隔
        interval = Math.max(interval, 1);

        // 计算下次复习的时间戳
        return Date.now() + interval * 24 * 60 * 60 * 1000;
    }

    /**
     * 获取单词的易度因子
     */
    private getEaseFactor(item: VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem): number {
        if (!item.notes) return 2.5; // 默认易度因子

        const easeFactorMatch = item.notes.match(/EF:([\d.]+)/);
        return easeFactorMatch ? parseFloat(easeFactorMatch[1]) : 2.5;
    }

    /**
     * 根据表现调整易度因子
     */
    private adjustEaseFactor(currentEF: number, performance: number): number {
        // SuperMemo 2算法的易度因子调整公式
        const newEF = currentEF + (0.1 - (5 - performance) * (0.08 + (5 - performance) * 0.02));

        // 确保易度因子在合理范围内
        return Math.max(1.3, Math.min(2.5, newEF));
    }

    /**
     * 计算基础间隔
     */
    private calculateBaseInterval(reviewCount: number, performance: number): number {
        if (reviewCount === 0) return 1; // 第一次复习：1天
        if (reviewCount === 1) return performance >= 3 ? 6 : 1; // 第二次复习：6天或1天

        // 使用配置的间隔数组作为基础
        const intervalIndex = Math.min(reviewCount - 2, this.settings.reviewIntervals.length - 1);
        return this.settings.reviewIntervals[intervalIndex];
    }

    /**
     * 更新每日统计数据
     */
    private updateDailyStats(newWord: boolean, review: boolean, correct: boolean, incorrect: boolean): void {
        const today = new Date().toISOString().split('T')[0];
        
        // 确保今天的记录存在
        if (!this.settings.learningStats.dailyStats[today]) {
            this.settings.learningStats.dailyStats[today] = {
                date: today,
                newWords: 0,
                reviewedWords: 0,
                correctCount: 0,
                incorrectCount: 0
            };
        }
        
        const todayStats = this.settings.learningStats.dailyStats[today];
        
        // 更新统计
        if (newWord) todayStats.newWords++;
        if (review) todayStats.reviewedWords++;
        if (correct) todayStats.correctCount++;
        if (incorrect) todayStats.incorrectCount++;
        
        // 更新学习连续天数
        const lastStudyDate = this.settings.learningStats.lastStudyDate;
        if (lastStudyDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (lastStudyDate === yesterdayStr) {
                // 连续学习
                this.settings.learningStats.streakDays++;
            } else if (lastStudyDate !== '') {
                // 中断了连续学习
                this.settings.learningStats.streakDays = 1;
            } else {
                // 第一次学习
                this.settings.learningStats.streakDays = 1;
            }
            
            this.settings.learningStats.lastStudyDate = today;
        }
    }

    /**
     * 获取今日学习统计
     */
    getTodayStats() {
        const today = new Date().toISOString().split('T')[0];
        return this.settings.learningStats.dailyStats[today] || {
            date: today,
            newWords: 0,
            reviewedWords: 0,
            correctCount: 0,
            incorrectCount: 0
        };
    }

    /**
     * 获取待复习的单词列表
     */
    getDueVocabulary(limit?: number): VocabularyItem[] {
        if (!this.settings.enableLearningTracker) return [];
        
        const now = Date.now();
        const dueItems = Object.values(this.settings.vocabItems)
            .filter(item => item.nextReview && item.nextReview <= now)
            .sort((a, b) => {
                // 优先复习最近添加的新词
                if (a.reviewCount === 0 && b.reviewCount > 0) return -1;
                if (b.reviewCount === 0 && a.reviewCount > 0) return 1;
                
                // 然后按到期时间排序
                return (a.nextReview || 0) - (b.nextReview || 0);
            });
        
        return limit ? dueItems.slice(0, limit) : dueItems;
    }

    /**
     * 获取学习进度摘要
     */
    getLearningProgressSummary(): string {
        if (!this.settings.enableLearningTracker) {
            return tr("学习进度追踪未启用。", "Learning progress tracking is off.");
        }
        
        const stats = this.settings.learningStats;
        const todayStats = this.getTodayStats();
        const dueCount = this.getDueVocabulary().length;
        
        let summary = `<div class="polyglot-stats-container">`;
        summary += `<div class="polyglot-stats-header">学习进度摘要</div>`;
        
        summary += `<div class="polyglot-stats-section">`;
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">总词汇量:</span><span class="polyglot-stats-value">${stats.totalWords} 词</span></div>`;
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">总复习次数:</span><span class="polyglot-stats-value">${stats.totalReviews} 次</span></div>`;
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">学习连续天数:</span><span class="polyglot-stats-value">${stats.streakDays} 天</span></div>`;
        summary += `</div>`;
        
        summary += `<div class="polyglot-stats-subheader">今日学习</div>`;
        summary += `<div class="polyglot-stats-section">`;
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">新学单词:</span><span class="polyglot-stats-value">${todayStats.newWords} / ${this.settings.dailyGoal} 词</span></div>`;
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">已复习单词:</span><span class="polyglot-stats-value">${todayStats.reviewedWords} 词</span></div>`;
        const accuracyValue = this.calculateAccuracy(todayStats.correctCount, todayStats.incorrectCount);
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">正确率:</span><span class="polyglot-stats-value polyglot-stats-accuracy">${accuracyValue}%</span></div>`;
        summary += `</div>`;
        
        summary += `<div class="polyglot-stats-subheader">待复习</div>`;
        summary += `<div class="polyglot-stats-section">`;
        summary += `<div class="polyglot-stats-row"><span class="polyglot-stats-label">待复习单词:</span><span class="polyglot-stats-value">${dueCount} 词</span></div>`;
        summary += `</div>`;

        // 添加学习趋势图表
        summary += this.generateLearningChart();

        summary += `</div>`;
        return summary;
    }
    
    /**
     * 生成学习趋势图表
     */
    private generateLearningChart(): string {
        const last7Days = this.getLast7DaysStats();
        const maxValue = Math.max(...last7Days.map(day => day.newWords + day.reviewedWords), 1);

        let chart = `<div class="polyglot-stats-subheader">最近7天学习趋势</div>`;
        chart += `<div class="polyglot-chart-container">`;

        last7Days.forEach((dayStats, index) => {
            const total = dayStats.newWords + dayStats.reviewedWords;
            const height = Math.max((total / maxValue) * 100, 2); // 最小高度2%
            const accuracy = this.calculateAccuracy(dayStats.correctCount, dayStats.incorrectCount);

            chart += `<div class="polyglot-chart-bar-container">`;
            chart += `<div class="polyglot-chart-bar" style="height: ${height}%" title="${dayStats.date}: ${total}词, 正确率${accuracy}%">`;
            if (dayStats.newWords > 0) {
                const newWordsHeight = (dayStats.newWords / total) * 100;
                chart += `<div class="polyglot-chart-bar-new" style="height: ${newWordsHeight}%"></div>`;
            }
            chart += `</div>`;
            chart += `<div class="polyglot-chart-label">${this.formatDateLabel(dayStats.date)}</div>`;
            chart += `</div>`;
        });

        chart += `</div>`;

        // 添加图例
        chart += `<div class="polyglot-chart-legend">`;
        chart += `<div class="polyglot-chart-legend-item">`;
        chart += `<div class="polyglot-chart-legend-color polyglot-chart-legend-new"></div>`;
        chart += `<span>新学单词</span>`;
        chart += `</div>`;
        chart += `<div class="polyglot-chart-legend-item">`;
        chart += `<div class="polyglot-chart-legend-color polyglot-chart-legend-review"></div>`;
        chart += `<span>复习单词</span>`;
        chart += `</div>`;
        chart += `</div>`;

        return chart;
    }

    /**
     * 获取最近7天的学习统计
     */
    private getLast7DaysStats(): Array<{date: string, newWords: number, reviewedWords: number, correctCount: number, incorrectCount: number}> {
        const stats = [];
        const today = new Date();

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const dayStats = this.settings.learningStats.dailyStats[dateStr] || {
                date: dateStr,
                newWords: 0,
                reviewedWords: 0,
                correctCount: 0,
                incorrectCount: 0
            };

            stats.push(dayStats);
        }

        return stats;
    }

    /**
     * 格式化日期标签
     */
    private formatDateLabel(dateStr: string): string {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (dateStr === today.toISOString().split('T')[0]) {
            return tr('今天', 'Today');
        } else if (dateStr === yesterday.toISOString().split('T')[0]) {
            return tr('昨天', 'Yesterday');
        } else {
            return `${date.getMonth() + 1}/${date.getDate()}`;
        }
    }

    /**
     * 计算正确率
     */
    private calculateAccuracy(correct: number, incorrect: number): number {
        if (correct + incorrect === 0) return 0;
        return Math.round((correct / (correct + incorrect)) * 100);
    }

    /**
     * 获取智能复习提醒
     */
    getSmartReviewReminder(): string {
        if (!this.settings.enableLearningTracker) return '';

        const dueItems = this.getDueVocabulary();
        const todayStats = this.getTodayStats();
        const now = new Date();
        const hour = now.getHours();

        let reminder = '';

        // 根据时间段和学习情况生成个性化提醒
        if (dueItems.length > 0) {
            if (hour < 12) {
                reminder = `☀️ 早上好！您有 ${dueItems.length} 个单词待复习，开始新的一天的学习吧！`;
            } else if (hour < 18) {
                reminder = `🌤️ 下午好！还有 ${dueItems.length} 个单词等待复习，利用午后时光巩固记忆。`;
            } else {
                reminder = `🌙 晚上好！今天还有 ${dueItems.length} 个单词需要复习，睡前复习效果更佳。`;
            }
        } else if (todayStats.newWords < this.settings.dailyGoal) {
            const remaining = this.settings.dailyGoal - todayStats.newWords;
            reminder = `🎯 今日目标还差 ${remaining} 个新单词，继续加油！`;
        } else {
            reminder = `🎉 太棒了！今天的学习目标已完成，保持这个节奏！`;
        }

        return reminder;
    }

    /**
     * 获取学习成就
     */
    getAchievements(): { name: string; description: string; achieved: boolean; progress?: number }[] {
        const achievements = [];
        const totalWords = this.settings.learningStats.totalWords;
        const streakDays = this.settings.learningStats.streakDays;
        const totalReviews = this.settings.learningStats.totalReviews;

        // 词汇量成就
        achievements.push({
            name: tr("词汇新手", "Vocabulary starter"),
            description: tr("学习10个单词", "Learn 10 words"),
            achieved: totalWords >= 10,
            progress: Math.min(totalWords / 10 * 100, 100)
        });

        achievements.push({
            name: tr("词汇达人", "Vocabulary expert"),
            description: tr("学习100个单词", "Learn 100 words"),
            achieved: totalWords >= 100,
            progress: Math.min(totalWords / 100 * 100, 100)
        });

        achievements.push({
            name: tr("词汇大师", "Vocabulary master"),
            description: tr("学习500个单词", "Learn 500 words"),
            achieved: totalWords >= 500,
            progress: Math.min(totalWords / 500 * 100, 100)
        });

        // 连续学习成就
        achievements.push({
            name: tr("坚持不懈", "Persistent"),
            description: tr("连续学习7天", "Study 7 days in a row"),
            achieved: streakDays >= 7,
            progress: Math.min(streakDays / 7 * 100, 100)
        });

        achievements.push({
            name: tr("学习达人", "Dedicated learner"),
            description: tr("连续学习30天", "Study 30 days in a row"),
            achieved: streakDays >= 30,
            progress: Math.min(streakDays / 30 * 100, 100)
        });

        // 复习成就
        achievements.push({
            name: tr("复习新手", "Review starter"),
            description: tr("完成50次复习", "Finish 50 reviews"),
            achieved: totalReviews >= 50,
            progress: Math.min(totalReviews / 50 * 100, 100)
        });

        achievements.push({
            name: tr("复习达人", "Review expert"),
            description: tr("完成500次复习", "Finish 500 reviews"),
            achieved: totalReviews >= 500,
            progress: Math.min(totalReviews / 500 * 100, 100)
        });

        return achievements;
    }

    /**
     * 获取学习建议
     */
    getLearningRecommendations(): string[] {
        const recommendations = [];
        const stats = this.settings.learningStats;
        const dueWords = this.getDueVocabulary().length;
        const totalWords = stats.totalWords;

        if (dueWords > 20) {
            recommendations.push("📚 你有很多单词需要复习，建议先完成复习再学习新单词");
        }

        if (stats.streakDays === 0) {
            recommendations.push("🎯 开始你的学习之旅！今天学习几个新单词吧");
        } else if (stats.streakDays < 7) {
            recommendations.push("💪 继续保持学习习惯，距离7天连续学习还差几天");
        }

        if (totalWords < 10) {
            recommendations.push("🌱 建议每天学习5-10个新单词，建立基础词汇量");
        } else if (totalWords < 100) {
            recommendations.push("📈 你的词汇量正在稳步增长，继续保持这个节奏");
        }

        const last7Days = this.getLast7DaysStats();
        const avgAccuracy = last7Days.reduce((sum, day) => {
            return sum + this.calculateAccuracy(day.correctCount, day.incorrectCount);
        }, 0) / last7Days.length;

        if (avgAccuracy < 70) {
            recommendations.push("🎯 建议多复习已学单词，提高记忆准确率");
        } else if (avgAccuracy > 90) {
            recommendations.push("🚀 你的记忆效果很好！可以适当增加学习量");
        }

        if (recommendations.length === 0) {
            recommendations.push("✨ 你的学习状态很好，继续保持！");
        }

        return recommendations;
    }

    /**
     * 重置学习数据
     */
    async resetLearningData(): Promise<void> {
        this.settings.vocabItems = {};
        this.settings.learningStats = {
            dailyStats: {},
            totalWords: 0,
            totalReviews: 0,
            streakDays: 0,
            lastStudyDate: '',
        };
        await this.saveSettings();
        new Notice(tr("学习数据已重置", "Learning data reset"));
    }

    /**
     * 获取词汇掌握度分布
     */
    getMasteryDistribution(): { level: string; count: number; percentage: number }[] {
        const distribution = [
            { level: "新学", count: 0, percentage: 0 },
            { level: "学习中", count: 0, percentage: 0 },
            { level: "熟悉", count: 0, percentage: 0 },
            { level: "掌握", count: 0, percentage: 0 },
            { level: "精通", count: 0, percentage: 0 }
        ];

        const totalWords = Object.keys(this.settings.vocabItems).length;
        if (totalWords === 0) return distribution;

        Object.values(this.settings.vocabItems).forEach(item => {
            const reviewCount = item.reviewCount;
            if (reviewCount === 0) {
                distribution[0].count++;
            } else if (reviewCount < 3) {
                distribution[1].count++;
            } else if (reviewCount < 7) {
                distribution[2].count++;
            } else if (reviewCount < 15) {
                distribution[3].count++;
            } else {
                distribution[4].count++;
            }
        });

        distribution.forEach(item => {
            item.percentage = Math.round((item.count / totalWords) * 100);
        });

        return distribution;
    }

    /**
     * 添加日语词汇项
     */
    async addJapaneseVocabularyItem(
        originalText: string,
        japaneseText: string,
        reading: string = '',
        translation: string,
        notes: string = '',
        examples: string[] = [],
        tags: string[] = []
    ): Promise<void> {
        if (!this.settings.enableLearningTracker) return;

        const key = `${originalText}_${japaneseText}`;

        // 如果词汇已存在，只更新部分字段
        if (this.settings.japaneseVocabItems[key]) {
            const existingItem = this.settings.japaneseVocabItems[key];
            existingItem.translation = translation;
            if (notes) existingItem.notes = notes;
            if (examples.length > 0) existingItem.examples = examples;
            if (tags.length > 0) existingItem.tags = tags;
            if (reading) existingItem.reading = reading;
            new Notice(tr(`已更新日语词汇 "${originalText}"`, `Updated Japanese entry "${originalText}"`));
        } else {
            // 创建新词汇条目
            const newItem: JapaneseVocabularyItem = {
                originalText,
                japaneseText,
                reading,
                translation,
                notes,
                examples,
                tags,
                createdAt: Date.now(),
                reviewCount: 0,
                difficulty: 2, // 默认中等难度
                reviewHistory: [],
                nextReview: Date.now() // 设置为立即可复习
            };

            this.settings.japaneseVocabItems[key] = newItem;
            this.settings.learningStats.totalWords++;

            // 更新每日统计
            this.updateDailyStats(true, false, false, false);
        }

        await this.saveSettings();
    }

    /**
     * 添加英语词汇项
     */
    async addEnglishVocabularyItem(
        word: string,
        translation: string,
        phonetics: string = '',
        partOfSpeech: string = '',
        definitions: string[] = [],
        notes: string = '',
        examples: string[] = [],
        tags: string[] = []
    ): Promise<void> {
        if (!this.settings.enableLearningTracker) return;

        // 如果词汇已存在，只更新部分字段
        if (this.settings.englishVocabItems[word]) {
            const existingItem = this.settings.englishVocabItems[word];
            existingItem.translation = translation;
            if (notes) existingItem.notes = notes;
            if (examples.length > 0) existingItem.examples = examples;
            if (tags.length > 0) existingItem.tags = tags;
            if (phonetics) existingItem.phonetics = phonetics;
            if (partOfSpeech) existingItem.partOfSpeech = partOfSpeech;
            if (definitions.length > 0) existingItem.definitions = definitions;
            new Notice(tr(`已更新英语单词 "${word}"`, `Updated English word "${word}"`));
        } else {
            // 创建新词汇条目
            const newItem: EnglishVocabularyItem = {
                word,
                translation,
                phonetics,
                partOfSpeech,
                definitions,
                notes,
                examples,
                tags,
                createdAt: Date.now(),
                reviewCount: 0,
                difficulty: 2, // 默认中等难度
                reviewHistory: [],
                nextReview: Date.now() // 设置为立即可复习
            };

            this.settings.englishVocabItems[word] = newItem;
            this.settings.learningStats.totalWords++;

            // 更新每日统计
            this.updateDailyStats(true, false, false, false);
        }

        await this.saveSettings();
    }

    /**
     * 获取日语词汇库
     */
    getJapaneseVocabulary(): JapaneseVocabularyItem[] {
        if (!this.settings.enableLearningTracker) return [];
        return Object.values(this.settings.japaneseVocabItems);
    }

    /**
     * 获取英语词汇库
     */
    getEnglishVocabulary(): EnglishVocabularyItem[] {
        if (!this.settings.enableLearningTracker) return [];
        return Object.values(this.settings.englishVocabItems);
    }

    /**
     * 获取待复习的日语词汇
     */
    getDueJapaneseVocabulary(limit?: number): JapaneseVocabularyItem[] {
        if (!this.settings.enableLearningTracker) return [];

        const now = Date.now();
        const dueItems = Object.values(this.settings.japaneseVocabItems)
            .filter(item => item.nextReview && item.nextReview <= now)
            .sort((a, b) => {
                // 优先复习最近添加的新词
                if (a.reviewCount === 0 && b.reviewCount > 0) return -1;
                if (b.reviewCount === 0 && a.reviewCount > 0) return 1;

                // 然后按到期时间排序
                return (a.nextReview || 0) - (b.nextReview || 0);
            });

        return limit ? dueItems.slice(0, limit) : dueItems;
    }

    /**
     * 获取待复习的英语词汇
     */
    getDueEnglishVocabulary(limit?: number): EnglishVocabularyItem[] {
        if (!this.settings.enableLearningTracker) return [];

        const now = Date.now();
        const dueItems = Object.values(this.settings.englishVocabItems)
            .filter(item => item.nextReview && item.nextReview <= now)
            .sort((a, b) => {
                // 优先复习最近添加的新词
                if (a.reviewCount === 0 && b.reviewCount > 0) return -1;
                if (b.reviewCount === 0 && a.reviewCount > 0) return 1;

                // 然后按到期时间排序
                return (a.nextReview || 0) - (b.nextReview || 0);
            });

        return limit ? dueItems.slice(0, limit) : dueItems;
    }

    /**
     * 条目属于哪个词库。英语和旧版条目都有 word 字段，只能按所在词库判断。
     */
    kindOf(item: VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem): 'japanese' | 'english' | 'legacy' {
        if ('japaneseText' in item) return 'japanese';
        if (this.settings.englishVocabItems[item.word] === item) return 'english';
        return 'legacy';
    }

    /**
     * 复习页用：已到期的条目，新词在前，其余按到期时间。没有 nextReview 的条目视为到期。
     * 旧版 vocabItems 在加载时已整体迁入英语／日语词库，这里不再重复计入。
     */
    getDueReviewItems(scope: 'all' | 'english' | 'japanese' = 'all', limit = 50): Array<JapaneseVocabularyItem | EnglishVocabularyItem> {
        if (!this.settings.enableLearningTracker) return [];
        const now = Date.now();
        const pool: Array<JapaneseVocabularyItem | EnglishVocabularyItem> = [];
        if (scope !== 'japanese') pool.push(...Object.values(this.settings.englishVocabItems));
        if (scope !== 'english') pool.push(...Object.values(this.settings.japaneseVocabItems));
        return pool
            .filter(item => !item.nextReview || item.nextReview <= now)
            .sort((a, b) => {
                if (a.reviewCount === 0 && b.reviewCount > 0) return -1;
                if (b.reviewCount === 0 && a.reviewCount > 0) return 1;
                return (a.nextReview || 0) - (b.nextReview || 0);
            })
            .slice(0, limit);
    }

    getDueCounts(): { english: number; japanese: number; total: number } {
        return {
            english: this.getDueReviewItems('english', Infinity).length,
            japanese: this.getDueReviewItems('japanese', Infinity).length,
            total: this.getDueReviewItems('all', Infinity).length,
        };
    }

    /**
     * 按条目所在词库记录复习结果。
     */
    async recordItemReview(item: VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem, performance: number, timeSpent?: number): Promise<void> {
        const kind = this.kindOf(item);
        if (kind === 'japanese') {
            const jp = item as JapaneseVocabularyItem;
            await this.recordJapaneseReview(jp.originalText, jp.japaneseText, performance, timeSpent);
        } else if (kind === 'english') {
            await this.recordEnglishReview((item as EnglishVocabularyItem).word, performance, timeSpent);
        } else {
            await this.recordReview((item as VocabularyItem).word, performance, timeSpent);
        }
    }

    /**
     * 预估按某个评分记录后多久再见到这个词：与 calculateNextReview 同一套规则，不含随机扰动，不改条目。
     */
    previewNextReview(item: VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem, performance: number): { hours?: number; days?: number } {
        if (performance <= 1) return { hours: 1 };
        const reviewCount = item.reviewCount + 1;
        const difficulty = performance >= 4 ? Math.max(0, item.difficulty - 1) : item.difficulty;
        const easeFactor = this.adjustEaseFactor(this.getEaseFactor(item), performance);
        let interval = this.calculateBaseInterval(reviewCount, performance);
        if (reviewCount > 1) interval = Math.round(interval * easeFactor);
        interval = Math.round(interval * [1.3, 1.15, 1.0, 0.85, 0.7][difficulty]);
        return { days: Math.max(interval, 1) };
    }

    /**
     * 记录日语词汇复习结果
     */
    async recordJapaneseReview(originalText: string, japaneseText: string, performance: number, timeSpent?: number): Promise<void> {
        if (!this.settings.enableLearningTracker) return;

        const key = `${originalText}_${japaneseText}`;
        const item = this.settings.japaneseVocabItems[key];
        if (!item) return;

        // 记录本次复习
        const review: ReviewRecord = {
            timestamp: Date.now(),
            performance,
            timeSpent
        };

        item.reviewHistory.push(review);
        item.lastReviewed = review.timestamp;
        item.reviewCount++;

        // 根据表现调整难度
        if (performance <= 1) {
            item.difficulty = Math.min(4, item.difficulty + 1);
        } else if (performance >= 4) {
            item.difficulty = Math.max(0, item.difficulty - 1);
        }

        // 计算下次复习时间
        item.nextReview = this.calculateNextReview(item, performance);

        // 更新每日统计
        this.updateDailyStats(false, true, performance >= 3, performance < 3);

        await this.saveSettings();
    }

    /**
     * 记录英语词汇复习结果
     */
    async recordEnglishReview(word: string, performance: number, timeSpent?: number): Promise<void> {
        if (!this.settings.enableLearningTracker) return;

        const item = this.settings.englishVocabItems[word];
        if (!item) return;

        // 记录本次复习
        const review: ReviewRecord = {
            timestamp: Date.now(),
            performance,
            timeSpent
        };

        item.reviewHistory.push(review);
        item.lastReviewed = review.timestamp;
        item.reviewCount++;

        // 根据表现调整难度
        if (performance <= 1) {
            item.difficulty = Math.min(4, item.difficulty + 1);
        } else if (performance >= 4) {
            item.difficulty = Math.max(0, item.difficulty - 1);
        }

        // 计算下次复习时间
        item.nextReview = this.calculateNextReview(item, performance);

        // 更新每日统计
        this.updateDailyStats(false, true, performance >= 3, performance < 3);

        await this.saveSettings();
    }

    async updateJapaneseVocabularyItem(originalText: string, japaneseText: string,
        patch: Partial<Pick<JapaneseVocabularyItem, 'isFavorite' | 'difficulty'>>): Promise<void> {
        const item = this.settings.japaneseVocabItems[`${originalText}_${japaneseText}`];
        if (!item) throw new Error('词汇已不存在，请刷新词库。');
        Object.assign(item, patch);
        await this.saveSettings();
    }

    async updateEnglishVocabularyItem(word: string,
        patch: Partial<Pick<EnglishVocabularyItem, 'isFavorite' | 'difficulty'>>): Promise<void> {
        const item = this.settings.englishVocabItems[word];
        if (!item) throw new Error('词汇已不存在，请刷新词库。');
        Object.assign(item, patch);
        await this.saveSettings();
    }

    async removeJapaneseVocabularyItem(originalText: string, japaneseText: string): Promise<void> {
        const key = `${originalText}_${japaneseText}`;
        if (!this.settings.japaneseVocabItems[key]) return;
        delete this.settings.japaneseVocabItems[key];
        this.settings.learningStats.totalWords = Math.max(0, this.settings.learningStats.totalWords - 1);
        await this.saveSettings();
    }
    async removeEnglishVocabularyItem(word: string): Promise<void> {
        if (!this.settings.englishVocabItems[word]) return;
        delete this.settings.englishVocabItems[word];
        this.settings.learningStats.totalWords = Math.max(0, this.settings.learningStats.totalWords - 1);
        await this.saveSettings();
    }
}