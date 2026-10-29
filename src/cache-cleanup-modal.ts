import { App, Modal, Setting, Notice } from 'obsidian';
import { CacheManager, CacheItem, CacheFilter } from './cache-manager';
import { Logger } from './shared/Logger';

import { fire } from './shared/fire';
import { confirmAction } from './shared/confirm-modal';
import { tr } from './shared/i18n';
export class CacheCleanupModal extends Modal {
    private cacheManager: CacheManager;
    private allItems: CacheItem[] = [];
    private filteredItems: CacheItem[] = [];
    private selectedItems: Set<string> = new Set();
    private filter: CacheFilter = { type: 'all' };

    constructor(
        app: App,
        private logger: Logger,
        private pluginDir: string
    ) {
        super(app);
        this.cacheManager = new CacheManager(app, logger, pluginDir);
    }

    onOpen() {
        void this.render();
    }

    private async render() {

        this.modalEl.addClass('ap', 'ap-modal');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('polyglot-cache-cleanup-modal');

        // 创建主容器
        const mainContainer = contentEl.createDiv({ cls: 'polyglot-cleanup-main-container' });

        // 标题
        mainContainer.createEl('h2', { text: tr('🗑️ 智能缓存清理', '🗑️ Smart cache cleanup'), cls: 'polyglot-cleanup-title' });

        // 加载缓存数据
        await this.loadCacheData();

        // 创建筛选区域
        this.createFilterSection(mainContainer);

        // 创建预览区域
        this.createPreviewSection(mainContainer);

        // 创建操作按钮
        this.createActionButtons(mainContainer);

        // 初始渲染
        this.applyFilter();
    }

    private async loadCacheData() {
        try {
            const loadingNotice = new Notice(tr('正在扫描缓存文件...', 'Scanning cache files...'), 0);
            this.allItems = await this.cacheManager.scanAllCache();
            loadingNotice.hide();
            this.logger.info(`扫描到 ${this.allItems.length} 个缓存文件`);

            if (this.allItems.length === 0) {
                new Notice(tr('没有找到缓存文件', 'No cache files found'));
            } else {
                new Notice(tr(`扫描完成，找到 ${this.allItems.length} 个缓存文件`, `Scan finished: ${this.allItems.length} cache files`));
            }
        } catch (error) {
            this.logger.error('扫描缓存失败', error);
            new Notice(tr('扫描缓存失败', 'Could not scan the cache'));
        }
    }

    private createFilterSection(container: HTMLElement) {
        const filterSection = container.createDiv({ cls: 'polyglot-filter-section' });
        filterSection.createEl('h3', { text: tr('📋 筛选条件', '📋 Filters') });

        // 类型筛选
        new Setting(filterSection)
            .setName(tr('缓存类型', 'Cache type'))
            .setDesc(tr('选择要清理的缓存类型', 'Which cache to clean'))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('all', tr('🔄 所有类型', '🔄 All types'))
                    .addOption('translation', tr('📝 翻译缓存', '📝 Translation cache'))
                    .addOption('audio', tr('🎵 音频缓存', '🎵 Audio cache'))
                    .setValue(this.filter.type || 'all')
                    .onChange(value => {
                        this.filter.type = value as CacheFilter['type'];
                        this.applyFilter();
                    });
            });

        // 时间筛选
        new Setting(filterSection)
            .setName(tr('文件时间', 'File age'))
            .setDesc(tr('只显示早于指定天数的文件', 'Only files older than this'))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('', tr('🕐 所有时间', '🕐 Any age'))
                    .addOption('1', tr('1天前', '1 day'))
                    .addOption('7', tr('1周前', '1 week'))
                    .addOption('30', tr('1个月前', '1 month'))
                    .addOption('90', tr('3个月前', '3 months'))
                    .setValue('')
                    .onChange(value => {
                        this.filter.olderThan = value ? parseInt(value) : undefined;
                        this.applyFilter();
                    });
            });

        // 大小筛选
        new Setting(filterSection)
            .setName(tr('文件大小', 'File size'))
            .setDesc(tr('只显示大于指定大小的文件', 'Only files larger than this'))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('', tr('📦 所有大小', '📦 Any size'))
                    .addOption('1024', tr('大于 1 千字节', 'Over 1 KB'))
                    .addOption('10240', tr('大于 10 千字节', 'Over 10 KB'))
                    .addOption('102400', tr('大于 100 千字节', 'Over 100 KB'))
                    .addOption('1048576', tr('大于 1 兆字节', 'Over 1 MB'))
                    .setValue('')
                    .onChange(value => {
                        this.filter.largerThan = value ? parseInt(value) : undefined;
                        this.applyFilter();
                    });
            });

        // 模式筛选
        new Setting(filterSection)
            .setName(tr('文件名模式', 'File name pattern'))
            .setDesc(tr('使用正则表达式筛选文件名', 'Filter file names with a regular expression'))
            .addText(text => {
                text
                    .setPlaceholder(tr('例如: .*hello.*', 'For example .*hello.*'))
                    .setValue(this.filter.pattern || '')
                    .onChange(value => {
                        this.filter.pattern = value || undefined;
                        this.applyFilter();
                    });
            });
    }

    private createPreviewSection(container: HTMLElement) {
        const previewSection = container.createDiv({ cls: 'polyglot-preview-section' });
        previewSection.createEl('h3', { text: tr('👀 预览结果', '👀 Preview') });

        // 统计信息
        const statsDiv = previewSection.createDiv({ cls: 'polyglot-cache-stats' });
        this.updateStats(statsDiv);

        // 全选/取消全选
        const selectAllDiv = previewSection.createDiv({ cls: 'polyglot-select-all' });
        const selectAllCheckbox = selectAllDiv.createEl('input', { type: 'checkbox' });
        selectAllDiv.createEl('label', { text: tr('全选/取消全选', 'Select all / none') });
        
        selectAllCheckbox.addEventListener('change', () => {
            if (selectAllCheckbox.checked) {
                this.filteredItems.forEach(item => this.selectedItems.add(item.path));
            } else {
                this.selectedItems.clear();
            }
            this.updateItemList();
        });

        // 文件列表容器
        const listContainer = previewSection.createDiv({ cls: 'polyglot-list-container' });
        const listDiv = listContainer.createDiv({ cls: 'polyglot-cache-list' });
        this.updateItemList(listDiv);
    }

    private createActionButtons(container: HTMLElement) {
        const buttonDiv = container.createDiv({ cls: 'polyglot-action-buttons' });

        // 刷新按钮
        const refreshBtn = buttonDiv.createEl('button', { text: tr('🔄 刷新', '🔄 Refresh') });
        refreshBtn.addEventListener('click', fire(async () => {
            await this.loadCacheData();
            this.applyFilter();
        }));

        // 清理按钮
        const cleanBtn = buttonDiv.createEl('button', { text: tr('🗑️ 清理选中项', '🗑️ Delete selected'), cls: 'mod-warning' });
        cleanBtn.addEventListener('click', fire(() => this.confirmCleanup()));

        // 取消按钮
        const cancelBtn = buttonDiv.createEl('button', { text: tr('❌ 取消', '❌ Cancel') });
        cancelBtn.addEventListener('click', () => this.close());
    }

    private applyFilter() {
        this.filteredItems = this.cacheManager.filterCache(this.allItems, this.filter);
        this.selectedItems.clear();
        this.updateStats();
        this.updateItemList();
    }

    private updateStats(container?: HTMLElement) {
        const statsContainer = container || this.contentEl.querySelector('.polyglot-cache-stats') as HTMLElement;
        if (!statsContainer) return;

        statsContainer.empty();
        
        const stats = this.cacheManager.getCacheStats(this.filteredItems);
        const selectedStats = this.cacheManager.getCacheStats(
            this.filteredItems.filter(item => this.selectedItems.has(item.path))
        );

        statsContainer.createDiv({ 
            text: tr(`📊 筛选结果: ${stats.total} 个文件 (${this.cacheManager.formatSize(stats.totalSize)})`, `📊 Matches: ${stats.total} files (${this.cacheManager.formatSize(stats.totalSize)})`),
            cls: 'polyglot-stat-item'
        });

        if (this.selectedItems.size > 0) {
            statsContainer.createDiv({ 
                text: tr(`✅ 已选择: ${this.selectedItems.size} 个文件 (${this.cacheManager.formatSize(selectedStats.totalSize)})`, `✅ Selected: ${this.selectedItems.size} files (${this.cacheManager.formatSize(selectedStats.totalSize)})`),
                cls: 'polyglot-stat-item selected'
            });
        }

        // 类型统计
        const typeStats = Object.entries(stats.byType)
            .map(([type, count]) => `${type}: ${count}`)
            .join(', ');
        if (typeStats) {
            statsContainer.createDiv({ 
                text: tr(`📂 类型分布: ${typeStats}`, `📂 By type: ${typeStats}`),
                cls: 'polyglot-stat-detail'
            });
        }
    }

    private updateItemList(container?: HTMLElement) {
        const listContainer = container || this.contentEl.querySelector('.polyglot-cache-list') as HTMLElement;
        if (!listContainer) return;

        listContainer.empty();

        if (this.filteredItems.length === 0) {
            listContainer.createDiv({ 
                text: tr('没有找到符合条件的缓存文件', 'No cache files match'),
                cls: 'polyglot-empty-message'
            });
            return;
        }

        // 限制显示数量，避免性能问题
        const displayItems = this.filteredItems.slice(0, 100);
        if (this.filteredItems.length > 100) {
            listContainer.createDiv({ 
                text: tr(`⚠️ 只显示前100个文件，共${this.filteredItems.length}个`, `⚠️ Showing the first 100 of ${this.filteredItems.length} files`),
                cls: 'polyglot-warning-message'
            });
        }

        displayItems.forEach(item => {
            const itemDiv = listContainer.createDiv({ cls: 'polyglot-cache-item' });
            
            // 复选框
            const checkbox = itemDiv.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.selectedItems.has(item.path);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedItems.add(item.path);
                } else {
                    this.selectedItems.delete(item.path);
                }
                this.updateStats();
            });

            // 文件信息
            const infoDiv = itemDiv.createDiv({ cls: 'polyglot-item-info' });
            
            const nameDiv = infoDiv.createDiv({ cls: 'polyglot-item-name' });
            nameDiv.createSpan({ text: item.name, cls: 'name' });
            nameDiv.createSpan({ text: item.type, cls: `type ${item.type}` });
            
            const detailDiv = infoDiv.createDiv({ cls: 'polyglot-item-detail' });
            detailDiv.createSpan({ text: this.cacheManager.formatSize(item.size), cls: 'size' });
            detailDiv.createSpan({ text: this.cacheManager.formatTime(item.lastModified), cls: 'time' });
            detailDiv.createSpan({ text: item.category, cls: 'category' });
        });
    }

    private async confirmCleanup() {
        if (this.selectedItems.size === 0) {
            new Notice(tr('请先选择要清理的文件', 'Select files to clean first'));
            return;
        }

        const selectedItems = this.filteredItems.filter(item => this.selectedItems.has(item.path));
        const stats = this.cacheManager.getCacheStats(selectedItems);

        const confirmed = await confirmAction(this.app, 
            tr(`确定要删除 ${selectedItems.length} 个缓存文件吗？\n`, `Delete ${selectedItems.length} cache files?\n`) +
            tr(`总大小: ${this.cacheManager.formatSize(stats.totalSize)}\n`, `Total size: ${this.cacheManager.formatSize(stats.totalSize)}\n`) +
            tr(`此操作不可撤销！`, `This cannot be undone.`)
        );

        if (!confirmed) return;

        try {
            const cleanupNotice = new Notice(tr('正在清理缓存...', 'Cleaning the cache...'), 0);
            const result = await this.cacheManager.deleteItems(selectedItems);
            cleanupNotice.hide();

            new Notice(tr(`✅ 清理完成: 成功删除 ${result.success} 个文件${result.failed > 0 ? `，失败 ${result.failed} 个` : ''}`, `✅ Done: deleted ${result.success} files${result.failed > 0 ? `, ${result.failed} failed` : ''}`));
            
            // 刷新数据
            await this.loadCacheData();
            this.applyFilter();
        } catch (error) {
            this.logger.error('清理缓存失败', error);
            new Notice(tr('清理缓存失败', 'Could not clean the cache'));
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
