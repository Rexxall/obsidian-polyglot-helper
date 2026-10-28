import { ItemView, WorkspaceLeaf, Notice, Modal, Setting, ButtonComponent, TextComponent, DropdownComponent } from "obsidian";
import PolyglotHelper from "./main";
import { VocabularyItem } from "./types";
import { CacheCleanupModal } from "./cache-cleanup-modal";

// 复习视图类型常量
export const POLYGLOT_REVIEW_VIEW_TYPE = "polyglot-review-view";

export const MANAGEMENT_PANEL_VIEW_TYPE = "polyglot-management-panel";

export interface ManagementPanelView {
    renderJapaneseVocabulary(container: HTMLElement): void;
    renderEnglishVocabulary(container: HTMLElement): void;
    renderFavoriteVocabulary(container: HTMLElement): void;
}

export class ManagementPanelView extends ItemView {
    plugin: PolyglotHelper;
    private currentTab: 'vocabulary' | 'learning' | 'cache' = 'vocabulary';

    constructor(leaf: WorkspaceLeaf, plugin: PolyglotHelper) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return MANAGEMENT_PANEL_VIEW_TYPE;
    }

    getDisplayText() {
        return "Polyglot 管理面板";
    }

    getIcon() {
        return "settings";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('polyglot-management-panel', 'ap', 'ap-view');

        this.renderPanel();
    }

    async onClose() {
        // 清理资源
    }

    private renderPanel() {
        const container = this.containerEl.children[1];
        container.empty();

        // 创建标签页导航
        const tabNav = container.createDiv({ cls: 'polyglot-tab-nav' });
        
        const vocabularyTab = tabNav.createEl('button', { 
            text: '📚 词汇库', 
            cls: this.currentTab === 'vocabulary' ? 'active' : '' 
        });
        vocabularyTab.addEventListener('click', () => this.switchTab('vocabulary'));

        const learningTab = tabNav.createEl('button', { 
            text: '📊 学习统计', 
            cls: this.currentTab === 'learning' ? 'active' : '' 
        });
        learningTab.addEventListener('click', () => this.switchTab('learning'));

        const cacheTab = tabNav.createEl('button', { 
            text: '🗄️ 缓存管理', 
            cls: this.currentTab === 'cache' ? 'active' : '' 
        });
        cacheTab.addEventListener('click', () => this.switchTab('cache'));

        // 创建内容区域
        const content = container.createDiv({ cls: 'polyglot-tab-content' });

        switch (this.currentTab) {
            case 'vocabulary':
                this.renderVocabularyTab(content);
                break;
            case 'learning':
                this.renderLearningTab(content);
                break;
            case 'cache':
                this.renderCacheTab(content);
                break;
        }
    }

    private switchTab(tab: 'vocabulary' | 'learning' | 'cache') {
        this.currentTab = tab;
        this.renderPanel();
    }

    private renderVocabularyTab(container: HTMLElement) {
        container.createEl('h3', { text: '📚 词汇库管理' });

        // 词库选择标签
        const vocabTabNav = container.createDiv({ cls: 'polyglot-vocab-tab-nav' });

        const allTabBtn = vocabTabNav.createEl('button', {
            text: '📚 全部词汇',
            cls: 'polyglot-vocab-tab-button active'
        });
        const japaneseTabBtn = vocabTabNav.createEl('button', {
            text: '🇯🇵 日语词库',
            cls: 'polyglot-vocab-tab-button'
        });
        const englishTabBtn = vocabTabNav.createEl('button', {
            text: '🇺🇸 英语词库',
            cls: 'polyglot-vocab-tab-button'
        });
        const favoritesTabBtn = vocabTabNav.createEl('button', {
            text: '💖 收藏词汇',
            cls: 'polyglot-vocab-tab-button'
        });

        const vocabContent = container.createDiv({ cls: 'polyglot-vocab-tab-content' });

        // 标签切换逻辑
        const showAllVocab = () => {
            this.setActiveVocabTab(allTabBtn, [japaneseTabBtn, englishTabBtn, favoritesTabBtn]);
            this.renderAllVocabulary(vocabContent);
        };

        const showJapaneseVocab = () => {
            this.setActiveVocabTab(japaneseTabBtn, [allTabBtn, englishTabBtn, favoritesTabBtn]);
            this.renderJapaneseVocabulary(vocabContent);
        };

        const showEnglishVocab = () => {
            this.setActiveVocabTab(englishTabBtn, [allTabBtn, japaneseTabBtn, favoritesTabBtn]);
            this.renderEnglishVocabulary(vocabContent);
        };

        const showFavorites = () => {
            this.setActiveVocabTab(favoritesTabBtn, [allTabBtn, japaneseTabBtn, englishTabBtn]);
            this.renderFavoriteVocabulary(vocabContent);
        };

        allTabBtn.addEventListener('click', showAllVocab);
        japaneseTabBtn.addEventListener('click', showJapaneseVocab);
        englishTabBtn.addEventListener('click', showEnglishVocab);
        favoritesTabBtn.addEventListener('click', showFavorites);

        // 默认显示全部词汇
        showAllVocab();
    }

    private setActiveVocabTab(activeBtn: HTMLElement, otherBtns: HTMLElement[]) {
        activeBtn.addClass('active');
        otherBtns.forEach(btn => btn.removeClass('active'));
    }

    private renderAllVocabulary(container: HTMLElement) {
        container.empty();

        // 详细统计信息
        const stats = container.createDiv({ cls: 'polyglot-vocab-stats' });
        const totalWords = Object.keys(this.plugin.settings.vocabItems).length;
        // 确保分离词库字段存在
        if (!this.plugin.settings.japaneseVocabItems) {
            this.plugin.settings.japaneseVocabItems = {};
        }
        if (!this.plugin.settings.englishVocabItems) {
            this.plugin.settings.englishVocabItems = {};
        }

        const japaneseWords = Object.keys(this.plugin.settings.japaneseVocabItems).length;
        const englishWords = Object.keys(this.plugin.settings.englishVocabItems).length;
        const dueWords = this.plugin.learningTracker.getDueCounts().total;
        const newWords = Object.values(this.plugin.settings.vocabItems).filter(item => item.reviewCount === 0).length;
        const masteredWords = Object.values(this.plugin.settings.vocabItems).filter(item => item.difficulty === 0).length;

        const statsGrid = stats.createDiv({ cls: 'polyglot-stats-grid' });

        {
            const host = statsGrid.createDiv({ cls: 'polyglot-stat-card' });
            host.createEl('div', { cls: 'stat-icon', text: '📚' });
            host.createEl('div', { cls: 'stat-number', text: `${totalWords + japaneseWords + englishWords}` });
            host.createEl('div', { cls: 'stat-label', text: '总词汇量' });
        }

        {
            const host = statsGrid.createDiv({ cls: 'polyglot-stat-card' });
            host.createEl('div', { cls: 'stat-icon', text: '🇯🇵' });
            host.createEl('div', { cls: 'stat-number', text: `${japaneseWords}` });
            host.createEl('div', { cls: 'stat-label', text: '日语词汇' });
        }

        {
            const host = statsGrid.createDiv({ cls: 'polyglot-stat-card' });
            host.createEl('div', { cls: 'stat-icon', text: '🇺🇸' });
            host.createEl('div', { cls: 'stat-number', text: `${englishWords}` });
            host.createEl('div', { cls: 'stat-label', text: '英语词汇' });
        }

        {
            const host = statsGrid.createDiv({ cls: 'polyglot-stat-card' });
            host.createEl('div', { cls: 'stat-icon', text: '⏰' });
            host.createEl('div', { cls: 'stat-number', text: `${dueWords}` });
            host.createEl('div', { cls: 'stat-label', text: '待复习' });
        }

        {
            const host = statsGrid.createDiv({ cls: 'polyglot-stat-card' });
            host.createEl('div', { cls: 'stat-icon', text: '🆕' });
            host.createEl('div', { cls: 'stat-number', text: `${newWords}` });
            host.createEl('div', { cls: 'stat-label', text: '新单词' });
        }

        {
            const host = statsGrid.createDiv({ cls: 'polyglot-stat-card' });
            host.createEl('div', { cls: 'stat-icon', text: '⭐' });
            host.createEl('div', { cls: 'stat-number', text: `${masteredWords}` });
            host.createEl('div', { cls: 'stat-label', text: '已掌握' });
        }

        // 操作按钮
        const actions = container.createDiv({ cls: 'polyglot-vocab-actions' });

        const addBtn = actions.createEl('button', { text: '➕ 添加单词', cls: 'polyglot-btn-primary' });
        addBtn.addEventListener('click', () => this.addVocabularyItem());

        const reviewBtn = actions.createEl('button', { text: '📖 开始复习', cls: 'polyglot-btn-success' });
        reviewBtn.addEventListener('click', () => this.startReview());

        const exportBtn = actions.createEl('button', { text: '📤 导出词汇库', cls: 'polyglot-btn-secondary' });
        exportBtn.addEventListener('click', () => this.exportVocabulary());

        const importBtn = actions.createEl('button', { text: '📥 导入词汇库', cls: 'polyglot-btn-secondary' });
        importBtn.addEventListener('click', () => this.importVocabulary());

        const clearBtn = actions.createEl('button', { text: '🗑️ 清空词汇库', cls: 'polyglot-btn-danger' });
        clearBtn.addEventListener('click', () => this.clearVocabulary());

        // 搜索和筛选区域
        const filterSection = container.createDiv({ cls: 'polyglot-filter-section' });

        // 搜索框
        const searchContainer = filterSection.createDiv({ cls: 'polyglot-search-container' });
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: '搜索词汇...',
            cls: 'polyglot-search-input'
        });

        // 筛选选项
        const filterContainer = filterSection.createDiv({ cls: 'polyglot-filter-container' });

        // 状态筛选
        const statusFilter = filterContainer.createEl('select', { cls: 'polyglot-status-filter' });
        statusFilter.createEl('option', { text: '所有状态', value: '' });
        statusFilter.createEl('option', { text: '新单词', value: 'new' });
        statusFilter.createEl('option', { text: '学习中', value: 'learning' });
        statusFilter.createEl('option', { text: '已掌握', value: 'mastered' });
        statusFilter.createEl('option', { text: '待复习', value: 'due' });

        // 难度筛选
        const difficultyFilter = filterContainer.createEl('select', { cls: 'polyglot-difficulty-filter' });
        difficultyFilter.createEl('option', { text: '所有难度', value: '' });
        difficultyFilter.createEl('option', { text: '简单 (0)', value: '0' });
        difficultyFilter.createEl('option', { text: '容易 (1)', value: '1' });
        difficultyFilter.createEl('option', { text: '中等 (2)', value: '2' });
        difficultyFilter.createEl('option', { text: '困难 (3)', value: '3' });
        difficultyFilter.createEl('option', { text: '很难 (4)', value: '4' });

        // 标签筛选
        const tagFilter = filterContainer.createEl('select', { cls: 'polyglot-tag-filter' });
        tagFilter.createEl('option', { text: '所有标签', value: '' });

        const tags = this.plugin.learningTracker.getAllTags();
        tags.forEach(tag => {
            tagFilter.createEl('option', { text: tag, value: tag });
        });

        // 排序选项
        const sortContainer = filterSection.createDiv({ cls: 'polyglot-sort-container' });
        const sortSelect = sortContainer.createEl('select', { cls: 'polyglot-sort-select' });
        sortSelect.createEl('option', { text: '按添加时间', value: 'created' });
        sortSelect.createEl('option', { text: '按字母顺序', value: 'alphabetical' });
        sortSelect.createEl('option', { text: '按复习次数', value: 'reviews' });
        sortSelect.createEl('option', { text: '按难度', value: 'difficulty' });
        sortSelect.createEl('option', { text: '按下次复习时间', value: 'nextReview' });

        const sortOrder = sortContainer.createEl('select', { cls: 'polyglot-sort-order' });
        sortOrder.createEl('option', { text: '升序', value: 'asc' });
        sortOrder.createEl('option', { text: '降序', value: 'desc' });

        // 词汇列表
        const vocabList = container.createDiv({ cls: 'polyglot-vocab-list' });

        const updateVocabList = () => {
            const searchTerm = searchInput.value;
            const selectedTag = tagFilter.value;
            const selectedStatus = statusFilter.value;
            const selectedDifficulty = difficultyFilter.value;
            const sortBy = sortSelect.value;
            const sortDirection = sortOrder.value;

            let words = Object.values(this.plugin.settings.vocabItems);

            // 搜索筛选
            if (searchTerm) {
                words = this.plugin.learningTracker.searchVocabulary(searchTerm);
            }

            // 标签筛选
            if (selectedTag) {
                words = words.filter(item => item.tags && item.tags.includes(selectedTag));
            }

            // 状态筛选
            if (selectedStatus) {
                const now = Date.now();
                words = words.filter(item => {
                    switch (selectedStatus) {
                        case 'new':
                            return item.reviewCount === 0;
                        case 'learning':
                            return item.reviewCount > 0 && item.difficulty > 0;
                        case 'mastered':
                            return item.difficulty === 0;
                        case 'due':
                            return item.nextReview && item.nextReview <= now;
                        default:
                            return true;
                    }
                });
            }

            // 难度筛选
            if (selectedDifficulty) {
                words = words.filter(item => item.difficulty === parseInt(selectedDifficulty));
            }

            // 排序
            words.sort((a, b) => {
                let comparison = 0;
                switch (sortBy) {
                    case 'alphabetical':
                        comparison = a.word.localeCompare(b.word);
                        break;
                    case 'reviews':
                        comparison = a.reviewCount - b.reviewCount;
                        break;
                    case 'difficulty':
                        comparison = a.difficulty - b.difficulty;
                        break;
                    case 'nextReview':
                        comparison = (a.nextReview || 0) - (b.nextReview || 0);
                        break;
                    case 'created':
                    default:
                        comparison = a.createdAt - b.createdAt;
                        break;
                }
                return sortDirection === 'desc' ? -comparison : comparison;
            });

            this.renderVocabularyList(vocabList, words);
        };

        // 绑定事件监听器
        searchInput.addEventListener('input', updateVocabList);
        tagFilter.addEventListener('change', updateVocabList);
        statusFilter.addEventListener('change', updateVocabList);
        difficultyFilter.addEventListener('change', updateVocabList);
        sortSelect.addEventListener('change', updateVocabList);
        sortOrder.addEventListener('change', updateVocabList);

        // 初始渲染
        updateVocabList();
    }

    private renderVocabularyList(container: HTMLElement, words: VocabularyItem[]) {
        container.empty();

        if (words.length === 0) {
            const emptyState = container.createDiv({ cls: 'polyglot-empty-state' });
            emptyState.createEl('div', { cls: 'empty-icon', text: '📚' });
            emptyState.createEl('div', { cls: 'empty-title', text: '没有找到词汇' });
            emptyState.createEl('div', { cls: 'empty-subtitle', text: '尝试调整筛选条件或添加新单词' });
            return;
        }

        // 显示结果统计
        const resultInfo = container.createDiv({ cls: 'polyglot-result-info' });
        resultInfo.textContent = `显示 ${words.length} 个词汇`;

        // 分页显示（每页20个）
        const pageSize = 20;
        const totalPages = Math.ceil(words.length / pageSize);
        let currentPage = 0;

        const renderPage = (page: number) => {
            const listContainer = container.querySelector('.polyglot-vocab-items') as HTMLElement;
            if (listContainer) listContainer.remove();

            const itemsContainer = container.createDiv({ cls: 'polyglot-vocab-items' });
            const startIndex = page * pageSize;
            const endIndex = Math.min(startIndex + pageSize, words.length);
            const pageWords = words.slice(startIndex, endIndex);

            pageWords.forEach(item => this.renderVocabularyItem(itemsContainer, item));

            // 分页控件
            if (totalPages > 1) {
                const paginationContainer = container.querySelector('.polyglot-pagination') as HTMLElement;
                if (paginationContainer) paginationContainer.remove();

                const pagination = container.createDiv({ cls: 'polyglot-pagination' });

                // 上一页按钮
                const prevBtn = pagination.createEl('button', {
                    text: '‹ 上一页',
                    cls: 'polyglot-page-btn'
                });
                prevBtn.disabled = page === 0;
                prevBtn.addEventListener('click', () => {
                    currentPage = Math.max(0, currentPage - 1);
                    renderPage(currentPage);
                });

                // 页码信息
                pagination.createEl('span', {
                    text: `第 ${page + 1} 页，共 ${totalPages} 页`,
                    cls: 'polyglot-page-info'
                });

                // 下一页按钮
                const nextBtn = pagination.createEl('button', {
                    text: '下一页 ›',
                    cls: 'polyglot-page-btn'
                });
                nextBtn.disabled = page === totalPages - 1;
                nextBtn.addEventListener('click', () => {
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    renderPage(currentPage);
                });
            }
        };

        renderPage(currentPage);
    }

    private renderVocabularyItem(container: HTMLElement, item: VocabularyItem) {
        const wordItem = container.createDiv({ cls: 'polyglot-vocab-item' });

        // 状态指示器
        const statusIndicator = wordItem.createDiv({ cls: 'polyglot-vocab-status' });
        const now = Date.now();
        let statusClass = '';
        let statusText = '';

        if (item.reviewCount === 0) {
            statusClass = 'status-new';
            statusText = '新';
        } else if (item.difficulty === 0) {
            statusClass = 'status-mastered';
            statusText = '掌握';
        } else if (item.nextReview && item.nextReview <= now) {
            statusClass = 'status-due';
            statusText = '待复习';
        } else {
            statusClass = 'status-learning';
            statusText = '学习中';
        }

        statusIndicator.className = `polyglot-vocab-status ${statusClass}`;
        statusIndicator.textContent = statusText;

        // 词汇信息
        const wordContent = wordItem.createDiv({ cls: 'polyglot-vocab-content' });

        const wordHeader = wordContent.createDiv({ cls: 'polyglot-vocab-header' });
        wordHeader.createEl('span', { text: item.word, cls: 'polyglot-vocab-word' });
        wordHeader.createEl('span', { text: item.translation, cls: 'polyglot-vocab-translation' });

        // 元数据
        const wordMeta = wordContent.createDiv({ cls: 'polyglot-vocab-meta' });
        wordMeta.createEl('span', { cls: 'meta-item', text: `📊 复习 ${item.reviewCount} 次` });
        wordMeta.createEl('span', { cls: 'meta-item', text: `🎯 难度 ${item.difficulty}/4` });
        wordMeta.createEl('span', { cls: 'meta-item', text: `📅 添加于 ${new Date(item.createdAt).toLocaleDateString()}` });

        if (item.nextReview) {
            const nextReviewDate = new Date(item.nextReview);
            const isOverdue = nextReviewDate.getTime() <= now;
            wordMeta.createEl('span', { cls: `meta-item ${isOverdue ? 'overdue' : ''}`, text: `⏰ ${isOverdue ? '已到期' : '下次复习'}: ${nextReviewDate.toLocaleDateString()}` });
        }

        // 标签
        if (item.tags && item.tags.length > 0) {
            const tagsDiv = wordContent.createDiv({ cls: 'polyglot-vocab-tags' });
            item.tags.forEach(tag => {
                tagsDiv.createEl('span', { text: tag, cls: 'polyglot-tag' });
            });
        }

        // 备注
        if (item.notes) {
            const notesDiv = wordContent.createDiv({ cls: 'polyglot-vocab-notes' });
            notesDiv.textContent = item.notes;
        }

        // 操作按钮
        const actions = wordItem.createDiv({ cls: 'polyglot-vocab-item-actions' });

        const reviewBtn = actions.createEl('button', {
            text: '📖',
            title: '立即复习',
            cls: 'polyglot-btn-small polyglot-btn-primary'
        });
        reviewBtn.addEventListener('click', () => this.reviewSingleWord(item));

        const editBtn = actions.createEl('button', {
            text: '✏️',
            title: '编辑',
            cls: 'polyglot-btn-small polyglot-btn-secondary'
        });
        editBtn.addEventListener('click', () => this.editVocabularyItem(item));

        const deleteBtn = actions.createEl('button', {
            text: '🗑️',
            title: '删除',
            cls: 'polyglot-btn-small polyglot-btn-danger'
        });
        deleteBtn.addEventListener('click', () => this.deleteVocabularyItem(item.word));
    }

    private async exportVocabulary() {
        try {
            const exportData = this.plugin.learningTracker.exportVocabulary();
            const fileName = `polyglot-vocabulary-${new Date().toISOString().split('T')[0]}.json`;
            
            await this.plugin.app.vault.create(fileName, exportData);
            new Notice(`✅ 词汇库已导出到 ${fileName}`);
        } catch (error) {
            new Notice(`❌ 导出失败: ${error.message}`);
        }
    }

    private importVocabulary() {
        new ImportVocabularyModal(this.plugin.app, this.plugin, () => {
            this.renderPanel(); // 刷新面板
        }).open();
    }

    private addVocabularyItem() {
        new AddVocabularyModal(this.plugin.app, this.plugin, () => {
            this.renderPanel(); // 刷新面板
        }).open();
    }

    private startReview() {
        // 打开复习视图
        this.plugin.app.workspace.getLeaf(false).setViewState({
            type: POLYGLOT_REVIEW_VIEW_TYPE,
            active: true,
        });
    }

    private reviewSingleWord(item: VocabularyItem) {
        // 创建单词复习模态框
        new SingleWordReviewModal(this.plugin.app, this.plugin, item, () => {
            this.renderPanel(); // 刷新面板
        }).open();
    }

    private async clearVocabulary() {
        const confirmed = confirm('确定要清空所有词汇库数据吗？此操作不可恢复！');
        if (confirmed) {
            await this.plugin.learningTracker.resetLearningData();
            this.renderPanel();
        }
    }

    private editVocabularyItem(item: VocabularyItem) {
        new EditVocabularyModal(this.plugin.app, this.plugin, item, () => {
            this.renderPanel(); // 刷新面板
        }).open();
    }

    private async deleteVocabularyItem(word: string) {
        const confirmed = confirm(`确定要删除单词 "${word}" 吗？`);
        if (confirmed) {
            await this.plugin.learningTracker.removeVocabularyItem(word);
            this.renderPanel();
        }
    }

    private renderLearningTab(container: HTMLElement) {
        container.createEl('h3', { text: '📊 学习统计' });

        // 基础统计
        const basicStats = container.createDiv({ cls: 'polyglot-learning-stats' });
        const stats = this.plugin.settings.learningStats;

        basicStats.createEl('div', {
            text: `📚 总词汇量: ${stats.totalWords}`,
            cls: 'polyglot-stat-card'
        });
        basicStats.createEl('div', {
            text: `🔥 连续学习: ${stats.streakDays} 天`,
            cls: 'polyglot-stat-card'
        });
        basicStats.createEl('div', {
            text: `📝 总复习次数: ${stats.totalReviews}`,
            cls: 'polyglot-stat-card'
        });

        // 成就系统
        const achievementsSection = container.createDiv({ cls: 'polyglot-achievements' });
        achievementsSection.createEl('h4', { text: '🏆 学习成就' });

        const achievements = this.plugin.learningTracker.getAchievements();
        const achievementsList = achievementsSection.createDiv({ cls: 'polyglot-achievements-list' });

        achievements.forEach(achievement => {
            const achievementItem = achievementsList.createDiv({ cls: 'polyglot-achievement-item' });
            const status = achievement.achieved ? '✅' : '⏳';
            const progress = achievement.progress ? Math.round(achievement.progress) : 0;

            achievementItem.createEl('span', { text: status, cls: 'polyglot-achievement-status' });
            achievementItem.createEl('span', { text: achievement.name, cls: 'polyglot-achievement-name' });
            achievementItem.createEl('span', { text: achievement.description, cls: 'polyglot-achievement-desc' });

            if (!achievement.achieved && achievement.progress) {
                const progressBar = achievementItem.createDiv({ cls: 'polyglot-progress-bar' });
                const progressFill = progressBar.createDiv({
                    cls: 'polyglot-progress-fill',
                    attr: { style: `width: ${progress}%` }
                });
                achievementItem.createEl('span', { text: `${progress}%`, cls: 'polyglot-progress-text' });
            }
        });

        // 掌握度分布
        const masterySection = container.createDiv({ cls: 'polyglot-mastery' });
        masterySection.createEl('h4', { text: '📈 词汇掌握度分布' });

        const mastery = this.plugin.learningTracker.getMasteryDistribution();
        const masteryChart = masterySection.createDiv({ cls: 'polyglot-mastery-chart' });

        mastery.forEach(level => {
            const levelItem = masteryChart.createDiv({ cls: 'polyglot-mastery-item' });
            levelItem.createEl('span', { text: level.level, cls: 'polyglot-mastery-label' });
            levelItem.createEl('span', { text: `${level.count} (${level.percentage}%)`, cls: 'polyglot-mastery-value' });

            const bar = levelItem.createDiv({ cls: 'polyglot-mastery-bar' });
            bar.createDiv({
                cls: 'polyglot-mastery-fill',
                attr: { style: `width: ${level.percentage}%` }
            });
        });

        // 学习建议
        const recommendationsSection = container.createDiv({ cls: 'polyglot-recommendations' });
        recommendationsSection.createEl('h4', { text: '💡 学习建议' });

        const recommendations = this.plugin.learningTracker.getLearningRecommendations();
        const recommendationsList = recommendationsSection.createDiv({ cls: 'polyglot-recommendations-list' });

        recommendations.forEach(rec => {
            recommendationsList.createEl('div', { text: rec, cls: 'polyglot-recommendation-item' });
        });

        // 操作按钮
        const actions = container.createDiv({ cls: 'polyglot-learning-actions' });

        const reviewBtn = actions.createEl('button', { text: '📚 开始复习' });
        reviewBtn.addEventListener('click', () => {
            this.plugin.activateReviewView();
        });

        const resetBtn = actions.createEl('button', { text: '🔄 重置学习数据', cls: 'danger' });
        resetBtn.addEventListener('click', async () => {
            const confirmed = confirm('确定要重置所有学习数据吗？此操作不可恢复！');
            if (confirmed) {
                await this.plugin.learningTracker.resetLearningData();
                this.renderPanel();
            }
        });
    }

    private renderCacheTab(container: HTMLElement) {
        container.createEl('h3', { text: '🗄️ 缓存管理' });

        // 缓存统计
        const statsSection = container.createDiv({ cls: 'polyglot-cache-stats' });

        // 获取缓存统计（异步）
        this.updateCacheStats(statsSection);

        // 缓存操作
        const actions = container.createDiv({ cls: 'polyglot-cache-actions' });

        // 清理翻译缓存按钮
        const clearTranslationBtn = actions.createEl('button', { text: '📝 清理翻译缓存' });
        clearTranslationBtn.addEventListener('click', async () => {
            try {
                await this.plugin.clearTranslationCache();
                this.updateCacheStats(statsSection);
            } catch (error) {
                new Notice(`清理翻译缓存失败: ${error.message}`);
            }
        });

        // 清理音频缓存按钮
        const clearAudioBtn = actions.createEl('button', { text: '🎵 清理音频缓存' });
        clearAudioBtn.addEventListener('click', async () => {
            try {
                await this.plugin.clearAudioCache();
                this.updateCacheStats(statsSection);
            } catch (error) {
                new Notice(`清理音频缓存失败: ${error.message}`);
            }
        });

        // 智能清理按钮
        const smartCleanBtn = actions.createEl('button', { text: '🧠 智能清理' });
        smartCleanBtn.addEventListener('click', () => {
            const modal = new CacheCleanupModal(this.app, this.plugin.logger, this.plugin.manifest.dir || '');
            modal.open();
        });

        // 清理所有缓存按钮
        const clearAllBtn = actions.createEl('button', { text: '🗑️ 清理所有缓存' });
        clearAllBtn.addEventListener('click', async () => {
            try {
                await this.plugin.clearAllCache();
                this.updateCacheStats(statsSection);
            } catch (error) {
                new Notice(`清理失败: ${error.message}`);
            }
        });

        const clearExpiredBtn = actions.createEl('button', { text: '🗑️ 清理过期缓存' });
        clearExpiredBtn.addEventListener('click', async () => {
            try {
                await this.plugin.clearExpiredCache(24);
                this.updateCacheStats(statsSection);
            } catch (error) {
                new Notice(`清理失败: ${error.message}`);
            }
        });

        const refreshBtn = actions.createEl('button', { text: '🔄 刷新统计' });
        refreshBtn.addEventListener('click', () => {
            this.updateCacheStats(statsSection);
        });

        // 缓存设置
        const settingsSection = container.createDiv({ cls: 'polyglot-cache-settings' });
        settingsSection.createEl('h4', { text: '⚙️ 缓存设置' });

        const autoCleanSetting = settingsSection.createDiv({ cls: 'polyglot-setting-item' });
        autoCleanSetting.createEl('label', { text: '自动清理过期缓存 (小时):' });
        const autoCleanInput = autoCleanSetting.createEl('input', {
            type: 'number',
            value: '24',
            attr: { min: '1', max: '168' }
        });

        const applyBtn = autoCleanSetting.createEl('button', { text: '应用' });
        applyBtn.addEventListener('click', async () => {
            const hours = parseInt(autoCleanInput.value);
            if (hours > 0) {
                await this.plugin.clearExpiredCache(hours);
                this.updateCacheStats(statsSection);
            }
        });
    }

    private async updateCacheStats(container: HTMLElement) {
        container.empty();
        container.createEl('h4', { text: '📊 缓存统计' });

        try {
            // 使用缓存管理器获取详细统计
            const cacheManager = this.plugin.cacheManager;
            const allItems = await cacheManager.scanAllCache();
            const stats = cacheManager.getCacheStats(allItems);

            // 总体统计
            const overviewSection = container.createDiv({ cls: 'polyglot-cache-overview' });
            overviewSection.createEl('h5', { text: '📋 总体概览' });

            const overviewGrid = overviewSection.createDiv({ cls: 'polyglot-stats-grid' });

            {
                const host = overviewGrid.createDiv({ cls: 'polyglot-stat-card' });
                host.createEl('div', { cls: 'stat-number', text: `${stats.total}` });
                host.createEl('div', { cls: 'stat-label', text: '总文件数' });
            }

            {
                const host = overviewGrid.createDiv({ cls: 'polyglot-stat-card' });
                host.createEl('div', { cls: 'stat-number', text: `${this.formatFileSize(stats.totalSize)}` });
                host.createEl('div', { cls: 'stat-label', text: '总大小' });
            }

            // 类型分布统计
            const typeSection = container.createDiv({ cls: 'polyglot-cache-section' });
            typeSection.createEl('h5', { text: '📂 类型分布' });

            const typeGrid = typeSection.createDiv({ cls: 'polyglot-stats-grid' });

            Object.entries(stats.byType).forEach(([type, count]) => {
                const typeItems = allItems.filter(item => item.type === type);
                const typeSize = typeItems.reduce((sum, item) => sum + item.size, 0);
                const icon = type === 'translation' ? '📝' : '🎵';
                const label = type === 'translation' ? '翻译缓存' : '音频缓存';

                {
                    const host = typeGrid.createDiv({ cls: 'polyglot-stat-card' });
                    host.createEl('div', { cls: 'stat-icon', text: `${icon}` });
                    host.createEl('div', { cls: 'stat-number', text: `${count}` });
                    host.createEl('div', { cls: 'stat-label', text: `${label}` });
                    host.createEl('div', { cls: 'stat-size', text: `${this.formatFileSize(typeSize)}` });
                }
            });

            // 分类统计
            const categorySection = container.createDiv({ cls: 'polyglot-cache-section' });
            categorySection.createEl('h5', { text: '🏷️ 分类统计' });

            const categoryList = categorySection.createDiv({ cls: 'polyglot-category-list' });

            Object.entries(stats.byCategory).forEach(([category, count]) => {
                const categoryItems = allItems.filter(item => item.category === category);
                const categorySize = categoryItems.reduce((sum, item) => sum + item.size, 0);

                const categoryItem = categoryList.createDiv({ cls: 'polyglot-category-item' });
                categoryItem.createEl('span', { cls: 'category-name', text: `${category}` });
                categoryItem.createEl('span', { cls: 'category-count', text: `${count} 个文件` });
                categoryItem.createEl('span', { cls: 'category-size', text: `${this.formatFileSize(categorySize)}` });
            });

            // 时间分布统计
            const timeSection = container.createDiv({ cls: 'polyglot-cache-section' });
            timeSection.createEl('h5', { text: '⏰ 时间分布' });

            const timeStats = this.calculateTimeDistribution(allItems);
            const timeList = timeSection.createDiv({ cls: 'polyglot-time-list' });

            Object.entries(timeStats).forEach(([period, count]) => {
                const timeItem = timeList.createDiv({ cls: 'polyglot-time-item' });
                timeItem.createEl('span', { cls: 'time-period', text: `${period}` });
                timeItem.createEl('span', { cls: 'time-count', text: `${count} 个文件` });
            });

            // 内存缓存统计
            const memoryStats = this.plugin.performanceOptimizer.getCacheStats();
            const memorySection = container.createDiv({ cls: 'polyglot-cache-section' });
            memorySection.createEl('h5', { text: '💾 内存缓存' });

            const memoryGrid = memorySection.createDiv({ cls: 'polyglot-stats-grid' });
            {
                const host = memoryGrid.createDiv({ cls: 'polyglot-stat-card' });
                host.createEl('div', { cls: 'stat-number', text: `${memoryStats.size}` });
                host.createEl('div', { cls: 'stat-label', text: '缓存项数' });
            }

            // 音频缓存统计
            const audioStats = this.plugin.audioCacheManager.getCacheStats();
            const audioSection = container.createDiv({ cls: 'polyglot-cache-section' });
            audioSection.createEl('h5', { text: '🎵 音频内存缓存' });

            const audioGrid = audioSection.createDiv({ cls: 'polyglot-stats-grid' });
            {
                const host = audioGrid.createDiv({ cls: 'polyglot-stat-card' });
                host.createEl('div', { cls: 'stat-number', text: `${audioStats.size}` });
                host.createEl('div', { cls: 'stat-label', text: '音频缓存项' });
            }

        } catch (error) {
            container.createEl('div', { text: '获取缓存统计失败', cls: 'polyglot-error' });
            this.plugin.logger.error('获取缓存统计失败', error);
        }
    }

    private calculateTimeDistribution(items: any[]): Record<string, number> {
        const now = Date.now();
        const timeRanges = {
            '今天': 0,
            '昨天': 0,
            '本周': 0,
            '本月': 0,
            '更早': 0
        };

        items.forEach(item => {
            const timeDiff = now - item.lastModified;
            const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

            if (daysDiff === 0) {
                timeRanges['今天']++;
            } else if (daysDiff === 1) {
                timeRanges['昨天']++;
            } else if (daysDiff <= 7) {
                timeRanges['本周']++;
            } else if (daysDiff <= 30) {
                timeRanges['本月']++;
            } else {
                timeRanges['更早']++;
            }
        });

        return timeRanges;
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// 简单的模态框类
class AddVocabularyModal extends Modal {
    plugin: PolyglotHelper;
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '添加新单词' });

        let wordInput: TextComponent;
        let translationInput: TextComponent;
        let notesInput: TextComponent;
        let tagsInput: TextComponent;

        new Setting(contentEl)
            .setName('单词')
            .setDesc('要添加的单词或短语')
            .addText(text => {
                wordInput = text;
                text.setPlaceholder('输入单词...');
            });

        new Setting(contentEl)
            .setName('翻译')
            .setDesc('单词的中文翻译')
            .addText(text => {
                translationInput = text;
                text.setPlaceholder('输入翻译...');
            });

        new Setting(contentEl)
            .setName('备注')
            .setDesc('可选的备注信息')
            .addText(text => {
                notesInput = text;
                text.setPlaceholder('输入备注...');
            });

        new Setting(contentEl)
            .setName('标签')
            .setDesc('用逗号分隔的标签')
            .addText(text => {
                tagsInput = text;
                text.setPlaceholder('标签1, 标签2...');
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('添加')
                .setCta()
                .onClick(async () => {
                    const word = wordInput.getValue().trim();
                    const translation = translationInput.getValue().trim();
                    const notes = notesInput.getValue().trim();
                    const tagsStr = tagsInput.getValue().trim();
                    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

                    if (!word || !translation) {
                        new Notice('请填写单词和翻译');
                        return;
                    }

                    await this.plugin.learningTracker.addVocabularyItem(word, translation, notes, [], tags);
                    this.close();
                    this.onSubmit();
                }))
            .addButton(btn => btn
                .setButtonText('取消')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class SingleWordReviewModal extends Modal {
    plugin: PolyglotHelper;
    item: VocabularyItem;
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, item: VocabularyItem, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.item = item;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '单词复习' });

        // 显示单词
        const wordDiv = contentEl.createDiv({ cls: 'polyglot-review-word' });
        wordDiv.createEl('h3', { text: this.item.word });

        // 显示翻译按钮
        const showTranslationBtn = contentEl.createEl('button', {
            text: '显示翻译',
            cls: 'polyglot-btn-primary'
        });

        const translationDiv = contentEl.createDiv({ cls: 'polyglot-review-translation' });
        translationDiv.hide();
        translationDiv.createEl('p', { text: this.item.translation });

        if (this.item.notes) {
            translationDiv.createEl('p', { text: `备注: ${this.item.notes}`, cls: 'polyglot-review-notes' });
        }

        showTranslationBtn.addEventListener('click', () => {
            translationDiv.show();
            showTranslationBtn.hide();
            this.showRatingButtons(contentEl);
        });
    }

    private showRatingButtons(container: HTMLElement) {
        const ratingDiv = container.createDiv({ cls: 'polyglot-review-rating' });
        ratingDiv.createEl('h4', { text: '你对这个单词的掌握程度如何？' });

        const ratings = [
            { text: '完全不认识', value: 0, cls: 'polyglot-btn-danger' },
            { text: '有印象', value: 1, cls: 'polyglot-btn-warning' },
            { text: '基本认识', value: 2, cls: 'polyglot-btn-secondary' },
            { text: '比较熟悉', value: 3, cls: 'polyglot-btn-primary' },
            { text: '非常熟悉', value: 4, cls: 'polyglot-btn-success' },
            { text: '完全掌握', value: 5, cls: 'polyglot-btn-success' }
        ];

        const buttonsDiv = ratingDiv.createDiv({ cls: 'polyglot-rating-buttons' });
        ratings.forEach(rating => {
            const btn = buttonsDiv.createEl('button', {
                text: rating.text,
                cls: rating.cls
            });
            btn.addEventListener('click', async () => {
                await this.plugin.learningTracker.recordReview(this.item.word, rating.value);
                new Notice(`已记录复习结果: ${rating.text}`);
                this.close();
                this.onSubmit();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 导入和编辑模态框的简单实现
class ImportVocabularyModal extends Modal {
    plugin: PolyglotHelper;
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '导入词汇库' });
        contentEl.createEl('p', { text: '请选择要导入的JSON文件' });

        const fileInput = contentEl.createEl('input', { type: 'file', attr: { accept: '.json' } });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('导入')
                .setCta()
                .onClick(async () => {
                    const file = fileInput.files?.[0];
                    if (!file) {
                        new Notice('请选择文件');
                        return;
                    }

                    try {
                        const text = await file.text();
                        const data = JSON.parse(text);
                        await this.plugin.learningTracker.importVocabulary(data);
                        new Notice('导入成功');
                        this.close();
                        this.onSubmit();
                    } catch (error) {
                        new Notice(`导入失败: ${error.message}`);
                    }
                }))
            .addButton(btn => btn
                .setButtonText('取消')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class EditVocabularyModal extends Modal {
    plugin: PolyglotHelper;
    item: VocabularyItem;
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, item: VocabularyItem, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.item = item;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '编辑单词' });

        let translationInput: TextComponent;
        let notesInput: TextComponent;
        let tagsInput: TextComponent;

        new Setting(contentEl)
            .setName('单词')
            .setDesc('单词内容（不可编辑）')
            .addText(text => {
                text.setValue(this.item.word);
                text.setDisabled(true);
            });

        new Setting(contentEl)
            .setName('翻译')
            .addText(text => {
                translationInput = text;
                text.setValue(this.item.translation);
            });

        new Setting(contentEl)
            .setName('备注')
            .addText(text => {
                notesInput = text;
                text.setValue(this.item.notes || '');
            });

        new Setting(contentEl)
            .setName('标签')
            .addText(text => {
                tagsInput = text;
                text.setValue(this.item.tags?.join(', ') || '');
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('保存')
                .setCta()
                .onClick(async () => {
                    const translation = translationInput.getValue().trim();
                    const notes = notesInput.getValue().trim();
                    const tagsStr = tagsInput.getValue().trim();
                    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

                    if (!translation) {
                        new Notice('请填写翻译');
                        return;
                    }

                    await this.plugin.learningTracker.addVocabularyItem(
                        this.item.word,
                        translation,
                        notes,
                        [],
                        tags
                    );
                    this.close();
                    this.onSubmit();
                }))
            .addButton(btn => btn
                .setButtonText('取消')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 日语词汇添加模态框
class AddJapaneseVocabularyModal extends Modal {
    plugin: PolyglotHelper;
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '添加日语词汇' });

        let originalTextInput: TextComponent;
        let japaneseTextInput: TextComponent;
        let readingInput: TextComponent;
        let translationInput: TextComponent;
        let notesInput: TextComponent;
        let tagsInput: TextComponent;

        new Setting(contentEl)
            .setName('原文（中文）')
            .setDesc('用作标题的原文')
            .addText(text => {
                originalTextInput = text;
                text.setPlaceholder('输入中文原文...');
            });

        new Setting(contentEl)
            .setName('日文')
            .setDesc('对应的日文表达')
            .addText(text => {
                japaneseTextInput = text;
                text.setPlaceholder('输入日文...');
            });

        new Setting(contentEl)
            .setName('读音')
            .setDesc('日文的读音（平假名）')
            .addText(text => {
                readingInput = text;
                text.setPlaceholder('输入读音...');
            });

        new Setting(contentEl)
            .setName('翻译')
            .setDesc('详细的中文翻译')
            .addText(text => {
                translationInput = text;
                text.setPlaceholder('输入翻译...');
            });

        new Setting(contentEl)
            .setName('备注')
            .setDesc('可选的备注信息')
            .addText(text => {
                notesInput = text;
                text.setPlaceholder('输入备注...');
            });

        new Setting(contentEl)
            .setName('标签')
            .setDesc('用逗号分隔的标签')
            .addText(text => {
                tagsInput = text;
                text.setPlaceholder('标签1, 标签2...');
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('添加')
                .setCta()
                .onClick(async () => {
                    const originalText = originalTextInput.getValue().trim();
                    const japaneseText = japaneseTextInput.getValue().trim();
                    const reading = readingInput.getValue().trim();
                    const translation = translationInput.getValue().trim();
                    const notes = notesInput.getValue().trim();
                    const tagsStr = tagsInput.getValue().trim();
                    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

                    if (!originalText || !japaneseText || !translation) {
                        new Notice('请填写原文、日文和翻译');
                        return;
                    }

                    await this.plugin.learningTracker.addJapaneseVocabularyItem(
                        originalText, japaneseText, reading, translation, notes, [], tags
                    );
                    this.close();
                    this.onSubmit();
                }))
            .addButton(btn => btn
                .setButtonText('取消')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 英语词汇添加模态框
class AddEnglishVocabularyModal extends Modal {
    plugin: PolyglotHelper;
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '添加英语词汇' });

        let wordInput: TextComponent;
        let translationInput: TextComponent;
        let phoneticsInput: TextComponent;
        let partOfSpeechInput: TextComponent;
        let notesInput: TextComponent;
        let tagsInput: TextComponent;

        new Setting(contentEl)
            .setName('英语单词')
            .setDesc('要添加的英语单词')
            .addText(text => {
                wordInput = text;
                text.setPlaceholder('输入英语单词...');
            });

        new Setting(contentEl)
            .setName('中文翻译')
            .setDesc('单词的中文翻译')
            .addText(text => {
                translationInput = text;
                text.setPlaceholder('输入中文翻译...');
            });

        new Setting(contentEl)
            .setName('音标')
            .setDesc('单词的音标')
            .addText(text => {
                phoneticsInput = text;
                text.setPlaceholder('输入音标...');
            });

        new Setting(contentEl)
            .setName('词性')
            .setDesc('单词的词性')
            .addText(text => {
                partOfSpeechInput = text;
                text.setPlaceholder('如: n. v. adj...');
            });

        new Setting(contentEl)
            .setName('备注')
            .setDesc('可选的备注信息')
            .addText(text => {
                notesInput = text;
                text.setPlaceholder('输入备注...');
            });

        new Setting(contentEl)
            .setName('标签')
            .setDesc('用逗号分隔的标签')
            .addText(text => {
                tagsInput = text;
                text.setPlaceholder('标签1, 标签2...');
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('添加')
                .setCta()
                .onClick(async () => {
                    const word = wordInput.getValue().trim();
                    const translation = translationInput.getValue().trim();
                    const phonetics = phoneticsInput.getValue().trim();
                    const partOfSpeech = partOfSpeechInput.getValue().trim();
                    const notes = notesInput.getValue().trim();
                    const tagsStr = tagsInput.getValue().trim();
                    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

                    if (!word || !translation) {
                        new Notice('请填写单词和翻译');
                        return;
                    }

                    await this.plugin.learningTracker.addEnglishVocabularyItem(
                        word, translation, phonetics, partOfSpeech, [], notes, [], tags
                    );
                    this.close();
                    this.onSubmit();
                }))
            .addButton(btn => btn
                .setButtonText('取消')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 日语复习模态框
class JapaneseReviewModal extends Modal {
    plugin: PolyglotHelper;
    item: any; // JapaneseVocabularyItem
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, item: any, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.item = item;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '日语词汇复习' });

        // 显示原文（中文）
        const originalDiv = contentEl.createDiv({ cls: 'polyglot-review-word' });
        originalDiv.createEl('h3', { text: this.item.originalText });

        // 显示翻译按钮
        const showTranslationBtn = contentEl.createEl('button', {
            text: '显示日文',
            cls: 'polyglot-btn-primary'
        });

        const translationDiv = contentEl.createDiv({ cls: 'polyglot-review-translation' });
        translationDiv.hide();
        translationDiv.createEl('p', { text: `日文: ${this.item.japaneseText}` });
        if (this.item.reading) {
            translationDiv.createEl('p', { text: `读音: ${this.item.reading}` });
        }
        translationDiv.createEl('p', { text: `翻译: ${this.item.translation}` });

        if (this.item.notes) {
            translationDiv.createEl('p', { text: `备注: ${this.item.notes}`, cls: 'polyglot-review-notes' });
        }

        showTranslationBtn.addEventListener('click', () => {
            translationDiv.show();
            showTranslationBtn.hide();
            this.showRatingButtons(contentEl);
        });
    }

    private showRatingButtons(container: HTMLElement) {
        const ratingDiv = container.createDiv({ cls: 'polyglot-review-rating' });
        ratingDiv.createEl('h4', { text: '你对这个日语词汇的掌握程度如何？' });

        const ratings = [
            { text: '完全不认识', value: 0, cls: 'polyglot-btn-danger' },
            { text: '有印象', value: 1, cls: 'polyglot-btn-warning' },
            { text: '基本认识', value: 2, cls: 'polyglot-btn-secondary' },
            { text: '比较熟悉', value: 3, cls: 'polyglot-btn-primary' },
            { text: '非常熟悉', value: 4, cls: 'polyglot-btn-success' },
            { text: '完全掌握', value: 5, cls: 'polyglot-btn-success' }
        ];

        const buttonsDiv = ratingDiv.createDiv({ cls: 'polyglot-rating-buttons' });
        ratings.forEach(rating => {
            const btn = buttonsDiv.createEl('button', {
                text: rating.text,
                cls: rating.cls
            });
            btn.addEventListener('click', async () => {
                await this.plugin.learningTracker.recordJapaneseReview(
                    this.item.originalText,
                    this.item.japaneseText,
                    rating.value
                );
                new Notice(`已记录复习结果: ${rating.text}`);
                this.close();
                this.onSubmit();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 英语复习模态框
class EnglishReviewModal extends Modal {
    plugin: PolyglotHelper;
    item: any; // EnglishVocabularyItem
    onSubmit: () => void;

    constructor(app: any, plugin: PolyglotHelper, item: any, onSubmit: () => void) {
        super(app);
        this.plugin = plugin;
        this.item = item;
        this.onSubmit = onSubmit;
    }

    onOpen() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '英语词汇复习' });

        // 显示英语单词
        const wordDiv = contentEl.createDiv({ cls: 'polyglot-review-word' });
        wordDiv.createEl('h3', { text: this.item.word });

        // 显示翻译按钮
        const showTranslationBtn = contentEl.createEl('button', {
            text: '显示翻译',
            cls: 'polyglot-btn-primary'
        });

        const translationDiv = contentEl.createDiv({ cls: 'polyglot-review-translation' });
        translationDiv.hide();
        translationDiv.createEl('p', { text: `翻译: ${this.item.translation}` });
        if (this.item.phonetics) {
            translationDiv.createEl('p', { text: `音标: ${this.item.phonetics}` });
        }
        if (this.item.partOfSpeech) {
            translationDiv.createEl('p', { text: `词性: ${this.item.partOfSpeech}` });
        }

        if (this.item.notes) {
            translationDiv.createEl('p', { text: `备注: ${this.item.notes}`, cls: 'polyglot-review-notes' });
        }

        showTranslationBtn.addEventListener('click', () => {
            translationDiv.show();
            showTranslationBtn.hide();
            this.showRatingButtons(contentEl);
        });
    }

    private showRatingButtons(container: HTMLElement) {
        const ratingDiv = container.createDiv({ cls: 'polyglot-review-rating' });
        ratingDiv.createEl('h4', { text: '你对这个英语单词的掌握程度如何？' });

        const ratings = [
            { text: '完全不认识', value: 0, cls: 'polyglot-btn-danger' },
            { text: '有印象', value: 1, cls: 'polyglot-btn-warning' },
            { text: '基本认识', value: 2, cls: 'polyglot-btn-secondary' },
            { text: '比较熟悉', value: 3, cls: 'polyglot-btn-primary' },
            { text: '非常熟悉', value: 4, cls: 'polyglot-btn-success' },
            { text: '完全掌握', value: 5, cls: 'polyglot-btn-success' }
        ];

        const buttonsDiv = ratingDiv.createDiv({ cls: 'polyglot-rating-buttons' });
        ratings.forEach(rating => {
            const btn = buttonsDiv.createEl('button', {
                text: rating.text,
                cls: rating.cls
            });
            btn.addEventListener('click', async () => {
                await this.plugin.learningTracker.recordEnglishReview(this.item.word, rating.value);
                new Notice(`已记录复习结果: ${rating.text}`);
                this.close();
                this.onSubmit();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 扩展 ManagementPanelView 类，添加缺失的方法
ManagementPanelView.prototype.renderJapaneseVocabulary = function(this: ManagementPanelView, container: HTMLElement) {
    container.empty();
    container.createEl('h3', { text: '🇯🇵 日语词汇库' });

    // 获取日语词汇
    const japaneseVocab = this.plugin.learningTracker.getJapaneseVocabulary();

    // 操作按钮
    const actions = container.createDiv({ cls: 'polyglot-vocab-actions' });

    const addBtn = actions.createEl('button', { text: '➕ 添加日语词汇', cls: 'polyglot-btn-primary' });
    addBtn.addEventListener('click', () => {
        new AddJapaneseVocabularyModal(this.plugin.app, this.plugin, () => {
            this.renderJapaneseVocabulary(container);
        }).open();
    });

    const reviewBtn = actions.createEl('button', { text: '📖 开始日语复习', cls: 'polyglot-btn-success' });
    reviewBtn.addEventListener('click', () => {
        // 打开复习视图并设置为日语模式
        this.plugin.app.workspace.getLeaf(false).setViewState({
            type: POLYGLOT_REVIEW_VIEW_TYPE,
            active: true,
        });
    });

    // 统计信息
    const stats = container.createDiv({ cls: 'polyglot-vocab-stats' });
    const el1 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el1.createEl('div', { cls: 'stat-number', text: `${japaneseVocab.length}` });
    el1.createEl('div', { cls: 'stat-label', text: '日语词汇总数' });
    const el2 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el2.createEl('div', { cls: 'stat-number', text: `${japaneseVocab.filter(item => !item.nextReview || item.nextReview <= Date.now()).length}` });
    el2.createEl('div', { cls: 'stat-label', text: '待复习' });
    const el3 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el3.createEl('div', { cls: 'stat-number', text: `${japaneseVocab.filter(item => item.reviewCount === 0).length}` });
    el3.createEl('div', { cls: 'stat-label', text: '新词汇' });

    // 词汇列表
    const vocabList = container.createDiv({ cls: 'polyglot-vocab-list' });

    if (japaneseVocab.length === 0) {
        const emptyState = vocabList.createDiv({ cls: 'polyglot-empty-state' });
        emptyState.createEl('div', { cls: 'empty-icon', text: '🇯🇵' });
        emptyState.createEl('div', { cls: 'empty-title', text: '还没有日语词汇' });
        emptyState.createEl('div', { cls: 'empty-subtitle', text: '开始分析日语文本来自动添加词汇吧！' });
        return;
    }

    // 渲染日语词汇项
    japaneseVocab.forEach(item => {
        const itemEl = vocabList.createDiv({ cls: 'polyglot-vocab-item japanese' });

        const contentDiv = itemEl.createDiv({ cls: 'polyglot-vocab-content' });

        // 原文和日文
        const textDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-text' });
        textDiv.createEl('h4', { text: item.originalText, cls: 'original-text' });
        textDiv.createEl('p', { text: item.japaneseText, cls: 'japanese-text' });

        if (item.reading) {
            textDiv.createEl('span', { text: item.reading, cls: 'reading' });
        }

        // 翻译
        const translationDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-translation' });
        translationDiv.createEl('p', { text: item.translation });

        // 状态和操作
        const metaDiv = itemEl.createDiv({ cls: 'polyglot-vocab-meta' });

        // 复习状态
        const statusSpan = metaDiv.createEl('span', { cls: 'polyglot-vocab-status' });
        if (item.reviewCount === 0) {
            statusSpan.setText('新词汇');
            statusSpan.addClass('status-new');
        } else if (!item.nextReview || item.nextReview <= Date.now()) {
            statusSpan.setText('待复习');
            statusSpan.addClass('status-due');
        } else {
            statusSpan.setText('已复习');
            statusSpan.addClass('status-reviewed');
        }

        // 操作按钮
        const actionsDiv = metaDiv.createDiv({ cls: 'polyglot-vocab-actions' });

        const playBtn = actionsDiv.createEl('button', { text: '🔊', cls: 'polyglot-btn-icon' });
        playBtn.addEventListener('click', async () => {
            try {
                await this.plugin.playJapaneseVoice(item.japaneseText, false);
            } catch (error) {
                new Notice('音频播放失败');
            }
        });

        const reviewBtn = actionsDiv.createEl('button', { text: '📖', cls: 'polyglot-btn-icon' });
        reviewBtn.addEventListener('click', () => {
            new JapaneseReviewModal(this.plugin.app, this.plugin, item, () => {
                this.renderJapaneseVocabulary(container);
            }).open();
        });

        const deleteBtn = actionsDiv.createEl('button', { text: '🗑️', cls: 'polyglot-btn-icon danger' });
        deleteBtn.addEventListener('click', async () => {
            const confirmed = confirm(`确定要删除日语词汇 "${item.originalText}" 吗？`);
            if (confirmed) {
                await this.plugin.learningTracker.removeJapaneseVocabularyItem(item.originalText, item.japaneseText);
                this.renderJapaneseVocabulary(container);
            }
        });
    });
};

ManagementPanelView.prototype.renderEnglishVocabulary = function(this: ManagementPanelView, container: HTMLElement) {
    container.empty();
    container.createEl('h3', { text: '🇺🇸 英语词汇库' });

    // 获取英语词汇
    const englishVocab = this.plugin.learningTracker.getEnglishVocabulary();

    // 操作按钮
    const actions = container.createDiv({ cls: 'polyglot-vocab-actions' });

    const addBtn = actions.createEl('button', { text: '➕ 添加英语单词', cls: 'polyglot-btn-primary' });
    addBtn.addEventListener('click', () => {
        new AddEnglishVocabularyModal(this.plugin.app, this.plugin, () => {
            this.renderEnglishVocabulary(container);
        }).open();
    });

    const reviewBtn = actions.createEl('button', { text: '📖 开始英语复习', cls: 'polyglot-btn-success' });
    reviewBtn.addEventListener('click', () => {
        // 打开复习视图并设置为英语模式
        this.plugin.app.workspace.getLeaf(false).setViewState({
            type: POLYGLOT_REVIEW_VIEW_TYPE,
            active: true,
        });
    });

    // 统计信息
    const stats = container.createDiv({ cls: 'polyglot-vocab-stats' });
    const el1 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el1.createEl('div', { cls: 'stat-number', text: `${englishVocab.length}` });
    el1.createEl('div', { cls: 'stat-label', text: '英语单词总数' });
    const el2 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el2.createEl('div', { cls: 'stat-number', text: `${englishVocab.filter(item => !item.nextReview || item.nextReview <= Date.now()).length}` });
    el2.createEl('div', { cls: 'stat-label', text: '待复习' });
    const el3 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el3.createEl('div', { cls: 'stat-number', text: `${englishVocab.filter(item => item.reviewCount === 0).length}` });
    el3.createEl('div', { cls: 'stat-label', text: '新单词' });

    // 词汇列表
    const vocabList = container.createDiv({ cls: 'polyglot-vocab-list' });

    if (englishVocab.length === 0) {
        const emptyState = vocabList.createDiv({ cls: 'polyglot-empty-state' });
        emptyState.createEl('div', { cls: 'empty-icon', text: '🇺🇸' });
        emptyState.createEl('div', { cls: 'empty-title', text: '还没有英语单词' });
        emptyState.createEl('div', { cls: 'empty-subtitle', text: '开始分析英语文本来自动添加单词吧！' });
        return;
    }

    // 渲染英语词汇项
    englishVocab.forEach(item => {
        const itemEl = vocabList.createDiv({ cls: 'polyglot-vocab-item english' });

        const contentDiv = itemEl.createDiv({ cls: 'polyglot-vocab-content' });

        // 单词和音标
        const textDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-text' });
        textDiv.createEl('h4', { text: item.word, cls: 'english-word' });

        if (item.phonetics) {
            textDiv.createEl('span', { text: `[${item.phonetics}]`, cls: 'phonetics' });
        }

        if (item.partOfSpeech) {
            textDiv.createEl('span', { text: item.partOfSpeech, cls: 'part-of-speech' });
        }

        // 翻译
        const translationDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-translation' });
        translationDiv.createEl('p', { text: item.translation });

        // 状态和操作
        const metaDiv = itemEl.createDiv({ cls: 'polyglot-vocab-meta' });

        // 复习状态
        const statusSpan = metaDiv.createEl('span', { cls: 'polyglot-vocab-status' });
        if (item.reviewCount === 0) {
            statusSpan.setText('新单词');
            statusSpan.addClass('status-new');
        } else if (!item.nextReview || item.nextReview <= Date.now()) {
            statusSpan.setText('待复习');
            statusSpan.addClass('status-due');
        } else {
            statusSpan.setText('已复习');
            statusSpan.addClass('status-reviewed');
        }

        // 操作按钮
        const actionsDiv = metaDiv.createDiv({ cls: 'polyglot-vocab-actions' });

        const playBtn = actionsDiv.createEl('button', { text: '🔊', cls: 'polyglot-btn-icon' });
        playBtn.addEventListener('click', async () => {
            try {
                await this.plugin.playEnglishVoice(item.word, false);
            } catch (error) {
                new Notice('音频播放失败');
            }
        });

        const reviewBtn = actionsDiv.createEl('button', { text: '📖', cls: 'polyglot-btn-icon' });
        reviewBtn.addEventListener('click', () => {
            new EnglishReviewModal(this.plugin.app, this.plugin, item, () => {
                this.renderEnglishVocabulary(container);
            }).open();
        });

        const deleteBtn = actionsDiv.createEl('button', { text: '🗑️', cls: 'polyglot-btn-icon danger' });
        deleteBtn.addEventListener('click', async () => {
            const confirmed = confirm(`确定要删除英语单词 "${item.word}" 吗？`);
            if (confirmed) {
                await this.plugin.learningTracker.removeEnglishVocabularyItem(item.word);
                this.renderEnglishVocabulary(container);
            }
        });
    });
};

ManagementPanelView.prototype.renderFavoriteVocabulary = function(this: ManagementPanelView, container: HTMLElement) {
    container.empty();
    container.createEl('h3', { text: '💖 收藏词汇' });

    // 获取所有收藏的词汇
    const japaneseVocab = this.plugin.learningTracker.getJapaneseVocabulary().filter(item => item.isFavorite);
    const englishVocab = this.plugin.learningTracker.getEnglishVocabulary().filter(item => item.isFavorite);
    const totalFavorites = japaneseVocab.length + englishVocab.length;

    // 操作按钮
    const actions = container.createDiv({ cls: 'polyglot-vocab-actions' });

    const reviewBtn = actions.createEl('button', { text: '📖 复习收藏词汇', cls: 'polyglot-btn-success' });
    reviewBtn.addEventListener('click', () => {
        // 打开复习视图
        this.plugin.app.workspace.getLeaf(false).setViewState({
            type: POLYGLOT_REVIEW_VIEW_TYPE,
            active: true,
        });
    });

    // 统计信息
    const stats = container.createDiv({ cls: 'polyglot-vocab-stats' });
    const el1 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el1.createEl('div', { cls: 'stat-number', text: `${totalFavorites}` });
    el1.createEl('div', { cls: 'stat-label', text: '收藏总数' });
    const el2 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el2.createEl('div', { cls: 'stat-number', text: `${japaneseVocab.length}` });
    el2.createEl('div', { cls: 'stat-label', text: '日语收藏' });
    const el3 = stats.createEl('div', { cls: 'polyglot-stat-card' });
    el3.createEl('div', { cls: 'stat-number', text: `${englishVocab.length}` });
    el3.createEl('div', { cls: 'stat-label', text: '英语收藏' });

    // 词汇列表
    const vocabList = container.createDiv({ cls: 'polyglot-vocab-list' });

    if (totalFavorites === 0) {
        const emptyState = vocabList.createDiv({ cls: 'polyglot-empty-state' });
        emptyState.createEl('div', { cls: 'empty-icon', text: '💖' });
        emptyState.createEl('div', { cls: 'empty-title', text: '还没有收藏的词汇' });
        emptyState.createEl('div', { cls: 'empty-subtitle', text: '在复习时点击收藏按钮来添加收藏吧！' });
        return;
    }

    // 分类显示收藏词汇
    if (japaneseVocab.length > 0) {
        const japaneseSection = vocabList.createDiv({ cls: 'polyglot-vocab-section' });
        japaneseSection.createEl('h4', { text: '🇯🇵 日语收藏', cls: 'section-title' });

        japaneseVocab.forEach(item => {
            const itemEl = japaneseSection.createDiv({ cls: 'polyglot-vocab-item japanese favorite' });

            const contentDiv = itemEl.createDiv({ cls: 'polyglot-vocab-content' });

            // 原文和日文
            const textDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-text' });
            textDiv.createEl('h4', { text: item.originalText, cls: 'original-text' });
            textDiv.createEl('p', { text: item.japaneseText, cls: 'japanese-text' });

            if (item.reading) {
                textDiv.createEl('span', { text: item.reading, cls: 'reading' });
            }

            // 翻译
            const translationDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-translation' });
            translationDiv.createEl('p', { text: item.translation });

            // 操作按钮
            const actionsDiv = itemEl.createDiv({ cls: 'polyglot-vocab-actions' });

            const playBtn = actionsDiv.createEl('button', { text: '🔊', cls: 'polyglot-btn-icon' });
            playBtn.addEventListener('click', async () => {
                try {
                    await this.plugin.playJapaneseVoice(item.japaneseText, false);
                } catch (error) {
                    new Notice('音频播放失败');
                }
            });

            const unfavoriteBtn = actionsDiv.createEl('button', { text: '💔', cls: 'polyglot-btn-icon' });
            unfavoriteBtn.addEventListener('click', async () => {
                await this.plugin.learningTracker.updateJapaneseVocabularyItem(item.originalText, item.japaneseText, {
                    isFavorite: false
                });
                this.renderFavoriteVocabulary(container);
                new Notice('已取消收藏');
            });
        });
    }

    if (englishVocab.length > 0) {
        const englishSection = vocabList.createDiv({ cls: 'polyglot-vocab-section' });
        englishSection.createEl('h4', { text: '🇺🇸 英语收藏', cls: 'section-title' });

        englishVocab.forEach(item => {
            const itemEl = englishSection.createDiv({ cls: 'polyglot-vocab-item english favorite' });

            const contentDiv = itemEl.createDiv({ cls: 'polyglot-vocab-content' });

            // 单词和音标
            const textDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-text' });
            textDiv.createEl('h4', { text: item.word, cls: 'english-word' });

            if (item.phonetics) {
                textDiv.createEl('span', { text: `[${item.phonetics}]`, cls: 'phonetics' });
            }

            if (item.partOfSpeech) {
                textDiv.createEl('span', { text: item.partOfSpeech, cls: 'part-of-speech' });
            }

            // 翻译
            const translationDiv = contentDiv.createDiv({ cls: 'polyglot-vocab-translation' });
            translationDiv.createEl('p', { text: item.translation });

            // 操作按钮
            const actionsDiv = itemEl.createDiv({ cls: 'polyglot-vocab-actions' });

            const playBtn = actionsDiv.createEl('button', { text: '🔊', cls: 'polyglot-btn-icon' });
            playBtn.addEventListener('click', async () => {
                try {
                    await this.plugin.playEnglishVoice(item.word, false);
                } catch (error) {
                    new Notice('音频播放失败');
                }
            });

            const unfavoriteBtn = actionsDiv.createEl('button', { text: '💔', cls: 'polyglot-btn-icon' });
            unfavoriteBtn.addEventListener('click', async () => {
                await this.plugin.learningTracker.updateEnglishVocabularyItem(item.word, {
                    isFavorite: false
                });
                this.renderFavoriteVocabulary(container);
                new Notice('已取消收藏');
            });
        });
    }
};
