import { ItemView, WorkspaceLeaf, Notice, ButtonComponent } from "obsidian";
import PolyglotHelper from "./main";
import { VocabularyItem } from "./types";
import { LearningTracker } from "./learning-tracker";

export const POLYGLOT_REVIEW_VIEW_TYPE = "polyglot-review-view";

export class PolyglotReviewView extends ItemView {
    plugin: PolyglotHelper;
    private learningTracker: LearningTracker;
    private currentItems: any[] = []; // 可以是 VocabularyItem, JapaneseVocabularyItem, 或 EnglishVocabularyItem
    private currentIndex: number = 0;
    private isShowingAnswer: boolean = false;
    private reviewStartTime: number = 0;
    private cardEl: HTMLElement;
    private reviewMode: 'mixed' | 'japanese' | 'english' = 'mixed';

    constructor(leaf: WorkspaceLeaf, plugin: PolyglotHelper, learningTracker: LearningTracker) {
        super(leaf);
        this.plugin = plugin;
        this.learningTracker = learningTracker;
    }

    getViewType() { return POLYGLOT_REVIEW_VIEW_TYPE; }
    getDisplayText() { return "复习单词"; }
    getIcon() { return "brain"; }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass('polyglot-review-container');

        // 加载待复习单词
        await this.loadReviewItems();
    }

    async loadReviewItems() {
        this.contentEl.empty();

        if (!this.plugin.settings.enableLearningTracker) {
            const enableDiv = this.contentEl.createDiv({ cls: 'polyglot-review-empty' });
            enableDiv.createEl('h2', { text: '学习进度追踪未启用' });
            enableDiv.createEl('p', { text: '请在设置中启用学习进度追踪功能。' });

            const enableBtn = new ButtonComponent(enableDiv)
                .setButtonText('启用并开始学习')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.enableLearningTracker = true;
                    await this.plugin.saveSettings();
                    this.loadReviewItems();
                });

            return;
        }

        // 创建模式选择界面
        this.renderModeSelection();
    }

    private renderModeSelection() {
        this.contentEl.empty();

        const headerDiv = this.contentEl.createDiv({ cls: 'polyglot-review-header' });
        headerDiv.createEl('h2', { text: '选择复习模式' });

        const modeContainer = this.contentEl.createDiv({ cls: 'polyglot-review-mode-container' });

        // 日语复习模式
        const japaneseCard = modeContainer.createDiv({ cls: 'polyglot-review-mode-card japanese' });
        japaneseCard.createEl('h3', { text: '🇯🇵 日语复习' });
        japaneseCard.createEl('p', { text: '复习日语词汇，显示日文，隐藏中文意思' });

        const japaneseCount = this.learningTracker.getJapaneseVocabulary().length;
        japaneseCard.createEl('span', { text: `${japaneseCount} 个词汇`, cls: 'polyglot-vocab-count' });

        japaneseCard.addEventListener('click', () => {
            this.reviewMode = 'japanese';
            this.startReview();
        });

        // 英语复习模式
        const englishCard = modeContainer.createDiv({ cls: 'polyglot-review-mode-card english' });
        englishCard.createEl('h3', { text: '🇺🇸 英语复习' });
        englishCard.createEl('p', { text: '复习英语单词，显示英文，隐藏中文意思' });

        const englishCount = this.learningTracker.getEnglishVocabulary().length;
        englishCard.createEl('span', { text: `${englishCount} 个单词`, cls: 'polyglot-vocab-count' });

        englishCard.addEventListener('click', () => {
            this.reviewMode = 'english';
            this.startReview();
        });

        // 混合复习模式
        const mixedCard = modeContainer.createDiv({ cls: 'polyglot-review-mode-card mixed' });
        mixedCard.createEl('h3', { text: '🌍 混合复习' });
        mixedCard.createEl('p', { text: '混合复习所有词汇' });

        const totalCount = japaneseCount + englishCount;
        mixedCard.createEl('span', { text: `${totalCount} 个词汇`, cls: 'polyglot-vocab-count' });

        mixedCard.addEventListener('click', () => {
            this.reviewMode = 'mixed';
            this.startReview();
        });
    }

    private async startReview() {
        // 显示智能提醒
        const reminder = this.learningTracker.getSmartReviewReminder();
        if (reminder) {
            const reminderDiv = this.contentEl.createDiv({ cls: 'polyglot-review-reminder' });
            reminderDiv.createEl('p', { text: reminder });
        }

        // 根据模式获取待复习的单词
        switch (this.reviewMode) {
            case 'japanese':
                this.currentItems = this.learningTracker.getJapaneseVocabulary()
                    .filter(item => !item.nextReview || item.nextReview <= Date.now())
                    .slice(0, 50);
                break;
            case 'english':
                this.currentItems = this.learningTracker.getEnglishVocabulary()
                    .filter(item => !item.nextReview || item.nextReview <= Date.now())
                    .slice(0, 50);
                break;
            case 'mixed':
                this.currentItems = this.learningTracker.getDueVocabulary(50);
                break;
        }

        if (this.currentItems.length === 0) {
            const emptyDiv = this.contentEl.createDiv({ cls: 'polyglot-review-empty' });
            emptyDiv.createEl('h2', { text: '太棒了！' });
            emptyDiv.createEl('p', { text: '当前没有待复习的单词。' });

            const summaryDiv = this.contentEl.createDiv({ cls: 'polyglot-review-summary' });
            summaryDiv.innerHTML = this.learningTracker.getLearningProgressSummary();

            const backBtn = new ButtonComponent(emptyDiv)
                .setButtonText('返回模式选择')
                .onClick(() => this.renderModeSelection());

            return;
        }

        // 创建复习界面
        this.currentIndex = 0;
        this.isShowingAnswer = false;
        this.reviewStartTime = Date.now();
        this.renderReviewCard();
    }

    renderReviewCard() {
        this.contentEl.empty();

        if (this.currentIndex >= this.currentItems.length) {
            // 复习完成
            const completeDiv = this.contentEl.createDiv({ cls: 'polyglot-review-complete' });
            completeDiv.createEl('h2', { text: '复习完成！' });
            completeDiv.createEl('p', { text: `已完成 ${this.currentItems.length} 个词汇的复习。` });

            const summaryDiv = this.contentEl.createDiv({ cls: 'polyglot-review-summary' });
            summaryDiv.innerHTML = this.learningTracker.getLearningProgressSummary();

            const restartBtn = new ButtonComponent(completeDiv)
                .setButtonText('再次复习')
                .setCta()
                .onClick(() => this.startReview());

            const backBtn = new ButtonComponent(completeDiv)
                .setButtonText('返回模式选择')
                .onClick(() => this.renderModeSelection());

            return;
        }

        // 创建模式指示器和进度
        const headerDiv = this.contentEl.createDiv({ cls: 'polyglot-review-header' });
        const modeText = this.reviewMode === 'japanese' ? '🇯🇵 日语复习' :
                        this.reviewMode === 'english' ? '🇺🇸 英语复习' : '🌍 混合复习';
        headerDiv.createEl('h3', { text: modeText });

        // 添加今日学习统计
        this.renderTodayStats(headerDiv);

        const progressDiv = this.contentEl.createDiv({ cls: 'polyglot-progress-container' });
        const progressBar = progressDiv.createDiv({ cls: 'polyglot-progress-bar' });
        const progressPercent = (this.currentIndex / this.currentItems.length) * 100;
        progressBar.style.width = `${progressPercent}%`;

        const progressText = this.contentEl.createDiv({ cls: 'polyglot-progress-text' });
        progressText.setText(`${this.currentIndex + 1} / ${this.currentItems.length}`);

        // 创建卡片容器
        this.cardEl = this.contentEl.createDiv({ cls: 'polyglot-review-card' });
        const currentItem = this.currentItems[this.currentIndex];

        // 根据词汇类型显示不同内容
        this.renderVocabCard(currentItem);
    }

    private renderVocabCard(item: any) {
        // 判断词汇类型
        const isJapanese = 'japaneseText' in item;
        const isEnglish = 'word' in item && 'phonetics' in item;

        if (isJapanese) {
            this.renderJapaneseCard(item);
        } else if (isEnglish) {
            this.renderEnglishCard(item);
        } else {
            this.renderLegacyCard(item);
        }
    }

    private renderJapaneseCard(item: any) {
        // 显示日语文本
        const wordDiv = this.cardEl.createDiv({ cls: 'polyglot-review-word japanese' });
        wordDiv.createEl('h2', { text: item.japaneseText });

        // 显示读音（如果有）
        if (item.reading) {
            const readingDiv = this.cardEl.createDiv({ cls: 'polyglot-review-reading' });
            readingDiv.createEl('span', { text: item.reading });
        }

        // 添加音频播放按钮
        const audioDiv = this.cardEl.createDiv({ cls: 'polyglot-review-audio' });
        const audioBtn = new ButtonComponent(audioDiv)
            .setButtonText('🔊 播放发音')
            .onClick(async () => {
                try {
                    await this.plugin.playJapaneseVoice(item.japaneseText, false);
                } catch (error) {
                    new Notice('音频播放失败');
                }
            });

        if (this.isShowingAnswer) {
            this.renderAnswerSection(item, 'japanese');
        } else {
            this.renderHintSection();
        }
    }

    private renderEnglishCard(item: any) {
        // 显示英语单词
        const wordDiv = this.cardEl.createDiv({ cls: 'polyglot-review-word english' });
        wordDiv.createEl('h2', { text: item.word });

        // 显示音标（如果有）
        if (item.phonetics) {
            const phoneticsDiv = this.cardEl.createDiv({ cls: 'polyglot-review-phonetics' });
            phoneticsDiv.createEl('span', { text: `[${item.phonetics}]` });
        }

        // 添加音频播放按钮
        const audioDiv = this.cardEl.createDiv({ cls: 'polyglot-review-audio' });
        const audioBtn = new ButtonComponent(audioDiv)
            .setButtonText('🔊 播放发音')
            .onClick(async () => {
                try {
                    await this.plugin.playEnglishVoice(item.word, false);
                } catch (error) {
                    new Notice('音频播放失败');
                }
            });

        if (this.isShowingAnswer) {
            this.renderAnswerSection(item, 'english');
        } else {
            this.renderHintSection();
        }
    }

    private renderLegacyCard(item: any) {
        // 兼容旧版词汇格式
        const wordDiv = this.cardEl.createDiv({ cls: 'polyglot-review-word legacy' });
        wordDiv.createEl('h2', { text: item.word });

        if (this.isShowingAnswer) {
            this.renderAnswerSection(item, 'legacy');
        } else {
            this.renderHintSection();
        }
    }

    private renderAnswerSection(item: any, type: 'japanese' | 'english' | 'legacy') {
        // 显示翻译/意思
        const translationDiv = this.cardEl.createDiv({ cls: 'polyglot-review-translation' });

        if (type === 'japanese') {
            translationDiv.createEl('h4', { text: '原文' });
            translationDiv.createEl('p', { text: item.originalText });
            translationDiv.createEl('h4', { text: '中文翻译' });
            translationDiv.createEl('p', { text: item.translation });
        } else {
            translationDiv.createEl('h4', { text: '中文意思' });
            translationDiv.createEl('p', { text: item.translation });
        }

        // 显示例句（如果有）
        if (item.examples && item.examples.length > 0) {
            const examplesDiv = this.cardEl.createDiv({ cls: 'polyglot-review-examples' });
            examplesDiv.createEl('h4', { text: '例句' });

            const examplesList = examplesDiv.createEl('ul');
            item.examples.slice(0, 3).forEach((example: string) => {
                examplesList.createEl('li', { text: example });
            });
        }

        // 显示标签（如果有）
        if (item.tags && item.tags.length > 0) {
            const tagsDiv = this.cardEl.createDiv({ cls: 'polyglot-review-tags' });
            item.tags.forEach((tag: string) => {
                tagsDiv.createEl('span', { text: tag, cls: 'polyglot-review-tag' });
            });
        }

        // 添加实用功能按钮
        this.renderUtilityButtons(item);

        this.renderRatingButtons(item);
    }

    private renderHintSection() {
        const hintDiv = this.cardEl.createDiv({ cls: 'polyglot-review-hint' });

        const showAnswerBtn = new ButtonComponent(hintDiv)
            .setButtonText('显示答案')
            .setCta()
            .onClick(() => {
                this.isShowingAnswer = true;
                this.renderReviewCard();
            });

        const skipBtn = new ButtonComponent(hintDiv)
            .setButtonText('跳过')
            .onClick(() => {
                this.currentIndex++;
                this.isShowingAnswer = false;
                this.reviewStartTime = Date.now();
                this.renderReviewCard();
            });
    }

    private renderRatingButtons(item: any) {
        const ratingDiv = this.cardEl.createDiv({ cls: 'polyglot-review-rating' });
        ratingDiv.createEl('h4', { text: '掌握程度如何？' });

        const ratingBtnsDiv = ratingDiv.createDiv({ cls: 'polyglot-rating-buttons' });

        const ratings = [
            { value: 0, text: '完全不认识', cls: 'polyglot-rating-0' },
            { value: 1, text: '认识但想不起', cls: 'polyglot-rating-1' },
            { value: 2, text: '想了一会儿才想起', cls: 'polyglot-rating-2' },
            { value: 3, text: '想起来但不确定', cls: 'polyglot-rating-3' },
            { value: 4, text: '记得很清楚', cls: 'polyglot-rating-4' },
            { value: 5, text: '非常熟悉', cls: 'polyglot-rating-5' }
        ];

        ratings.forEach(rating => {
            const ratingBtn = new ButtonComponent(ratingBtnsDiv)
                .setButtonText(rating.text)
                .setClass(rating.cls)
                .onClick(async () => {
                    // 记录复习结果
                    const timeSpent = Date.now() - this.reviewStartTime;
                    const wordKey = this.getWordKey(item);
                    await this.learningTracker.recordReview(wordKey, rating.value, timeSpent);

                    // 提供视觉反馈
                    const feedbackEl = this.cardEl.createDiv({ cls: 'polyglot-review-feedback' });
                    feedbackEl.setText(`已记录: ${rating.text}`);
                    feedbackEl.addClass('polyglot-feedback-show');

                    // 短暂延迟后进入下一个单词
                    setTimeout(() => {
                        this.currentIndex++;
                        this.isShowingAnswer = false;
                        this.reviewStartTime = Date.now();
                        this.renderReviewCard();
                    }, 500);
                });
        });
    }

    private renderUtilityButtons(item: any) {
        const utilityDiv = this.cardEl.createDiv({ cls: 'polyglot-review-utility' });

        // 收藏按钮
        const favoriteBtn = new ButtonComponent(utilityDiv)
            .setButtonText(item.isFavorite ? '💖 已收藏' : '🤍 收藏')
            .setClass(item.isFavorite ? 'polyglot-btn-favorite-active' : 'polyglot-btn-favorite')
            .onClick(async () => {
                await this.toggleFavorite(item);
                // 重新渲染当前卡片
                this.renderReviewCard();
            });

        // 难度调整按钮
        const difficultyDiv = utilityDiv.createDiv({ cls: 'polyglot-difficulty-controls' });
        difficultyDiv.createEl('span', { text: '难度:', cls: 'polyglot-difficulty-label' });

        const difficultyDisplay = difficultyDiv.createEl('span', {
            text: this.getDifficultyText(item.difficulty || 0),
            cls: 'polyglot-difficulty-display'
        });

        const decreaseBtn = new ButtonComponent(difficultyDiv)
            .setButtonText('➖')
            .setClass('polyglot-btn-difficulty')
            .onClick(async () => {
                if (item.difficulty > 0) {
                    await this.adjustDifficulty(item, item.difficulty - 1);
                    difficultyDisplay.setText(this.getDifficultyText(item.difficulty));
                }
            });

        const increaseBtn = new ButtonComponent(difficultyDiv)
            .setButtonText('➕')
            .setClass('polyglot-btn-difficulty')
            .onClick(async () => {
                if (item.difficulty < 4) {
                    await this.adjustDifficulty(item, item.difficulty + 1);
                    difficultyDisplay.setText(this.getDifficultyText(item.difficulty));
                }
            });

        // 学习统计
        const statsDiv = utilityDiv.createDiv({ cls: 'polyglot-review-stats' });
        statsDiv.innerHTML = `
            <span class="stat-item">📊 复习 ${item.reviewCount || 0} 次</span>
            <span class="stat-item">📅 添加于 ${new Date(item.createdAt).toLocaleDateString()}</span>
        `;
    }

    private getDifficultyText(difficulty: number): string {
        const levels = ['已掌握', '简单', '一般', '困难', '很难'];
        return levels[difficulty] || '未知';
    }

    private async toggleFavorite(item: any) {
        const newFavoriteStatus = !item.isFavorite;
        item.isFavorite = newFavoriteStatus;

        // 根据词汇类型更新数据
        if ('japaneseText' in item) {
            await this.learningTracker.updateJapaneseVocabularyItem(item.originalText, item.japaneseText, {
                isFavorite: newFavoriteStatus
            });
        } else if ('word' in item) {
            await this.learningTracker.updateEnglishVocabularyItem(item.word, {
                isFavorite: newFavoriteStatus
            });
        }

        new Notice(newFavoriteStatus ? '已添加到收藏' : '已取消收藏');
    }

    private async adjustDifficulty(item: any, newDifficulty: number) {
        item.difficulty = newDifficulty;

        // 根据词汇类型更新数据
        if ('japaneseText' in item) {
            await this.learningTracker.updateJapaneseVocabularyItem(item.originalText, item.japaneseText, {
                difficulty: newDifficulty
            });
        } else if ('word' in item) {
            await this.learningTracker.updateEnglishVocabularyItem(item.word, {
                difficulty: newDifficulty
            });
        }

        new Notice(`难度已调整为: ${this.getDifficultyText(newDifficulty)}`);
    }

    private renderTodayStats(container: HTMLElement) {
        const today = new Date().toISOString().split('T')[0];
        const todayStats = this.plugin.settings.learningStats.dailyStats[today];

        if (todayStats) {
            const statsDiv = container.createDiv({ cls: 'polyglot-today-stats' });
            statsDiv.innerHTML = `
                <div class="today-stat">
                    <span class="stat-icon">📚</span>
                    <span class="stat-text">今日新词: ${todayStats.newWords}</span>
                </div>
                <div class="today-stat">
                    <span class="stat-icon">📖</span>
                    <span class="stat-text">已复习: ${todayStats.reviewedWords}</span>
                </div>
                <div class="today-stat">
                    <span class="stat-icon">✅</span>
                    <span class="stat-text">正确率: ${todayStats.reviewedWords > 0 ? Math.round((todayStats.correctCount / todayStats.reviewedWords) * 100) : 0}%</span>
                </div>
            `;
        }
    }

    private getWordKey(item: any): string {
        if ('japaneseText' in item) {
            return `${item.originalText}_${item.japaneseText}`;
        } else if ('word' in item) {
            return item.word;
        } else {
            return item.word || 'unknown';
        }
    }
} 