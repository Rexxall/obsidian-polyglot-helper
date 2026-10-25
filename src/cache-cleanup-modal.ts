import { App, Modal, Setting, Notice } from 'obsidian';
import { CacheManager, CacheItem, CacheFilter } from './cache-manager';
import { Logger } from './shared/Logger';

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

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('polyglot-cache-cleanup-modal');

        // 创建主容器
        const mainContainer = contentEl.createDiv({ cls: 'polyglot-cleanup-main-container' });

        // 标题
        mainContainer.createEl('h2', { text: '🗑️ 智能缓存清理', cls: 'polyglot-cleanup-title' });

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
            const loadingNotice = new Notice('正在扫描缓存文件...', 0);
            this.allItems = await this.cacheManager.scanAllCache();
            loadingNotice.hide();
            this.logger.info(`扫描到 ${this.allItems.length} 个缓存文件`);

            if (this.allItems.length === 0) {
                new Notice('没有找到缓存文件');
            } else {
                new Notice(`扫描完成，找到 ${this.allItems.length} 个缓存文件`);
            }
        } catch (error) {
            this.logger.error('扫描缓存失败', error);
            new Notice('扫描缓存失败');
        }
    }

    private createFilterSection(container: HTMLElement) {
        const filterSection = container.createDiv({ cls: 'polyglot-filter-section' });
        filterSection.createEl('h3', { text: '📋 筛选条件' });

        // 类型筛选
        new Setting(filterSection)
            .setName('缓存类型')
            .setDesc('选择要清理的缓存类型')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('all', '🔄 所有类型')
                    .addOption('translation', '📝 翻译缓存')
                    .addOption('audio', '🎵 音频缓存')
                    .setValue(this.filter.type || 'all')
                    .onChange(value => {
                        this.filter.type = value as any;
                        this.applyFilter();
                    });
            });

        // 时间筛选
        new Setting(filterSection)
            .setName('文件时间')
            .setDesc('只显示早于指定天数的文件')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('', '🕐 所有时间')
                    .addOption('1', '1天前')
                    .addOption('7', '1周前')
                    .addOption('30', '1个月前')
                    .addOption('90', '3个月前')
                    .setValue('')
                    .onChange(value => {
                        this.filter.olderThan = value ? parseInt(value) : undefined;
                        this.applyFilter();
                    });
            });

        // 大小筛选
        new Setting(filterSection)
            .setName('文件大小')
            .setDesc('只显示大于指定大小的文件')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('', '📦 所有大小')
                    .addOption('1024', '> 1KB')
                    .addOption('10240', '> 10KB')
                    .addOption('102400', '> 100KB')
                    .addOption('1048576', '> 1MB')
                    .setValue('')
                    .onChange(value => {
                        this.filter.largerThan = value ? parseInt(value) : undefined;
                        this.applyFilter();
                    });
            });

        // 模式筛选
        new Setting(filterSection)
            .setName('文件名模式')
            .setDesc('使用正则表达式筛选文件名')
            .addText(text => {
                text
                    .setPlaceholder('例如: .*hello.*')
                    .setValue(this.filter.pattern || '')
                    .onChange(value => {
                        this.filter.pattern = value || undefined;
                        this.applyFilter();
                    });
            });
    }

    private createPreviewSection(container: HTMLElement) {
        const previewSection = container.createDiv({ cls: 'polyglot-preview-section' });
        previewSection.createEl('h3', { text: '👀 预览结果' });

        // 统计信息
        const statsDiv = previewSection.createDiv({ cls: 'polyglot-cache-stats' });
        this.updateStats(statsDiv);

        // 全选/取消全选
        const selectAllDiv = previewSection.createDiv({ cls: 'polyglot-select-all' });
        const selectAllCheckbox = selectAllDiv.createEl('input', { type: 'checkbox' });
        selectAllDiv.createEl('label', { text: '全选/取消全选' });
        
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
        const refreshBtn = buttonDiv.createEl('button', { text: '🔄 刷新' });
        refreshBtn.addEventListener('click', async () => {
            await this.loadCacheData();
            this.applyFilter();
        });

        // 清理按钮
        const cleanBtn = buttonDiv.createEl('button', { text: '🗑️ 清理选中项', cls: 'mod-warning' });
        cleanBtn.addEventListener('click', () => this.confirmCleanup());

        // 取消按钮
        const cancelBtn = buttonDiv.createEl('button', { text: '❌ 取消' });
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

        statsContainer.createEl('div', { 
            text: `📊 筛选结果: ${stats.total} 个文件 (${this.cacheManager.formatSize(stats.totalSize)})`,
            cls: 'polyglot-stat-item'
        });

        if (this.selectedItems.size > 0) {
            statsContainer.createEl('div', { 
                text: `✅ 已选择: ${this.selectedItems.size} 个文件 (${this.cacheManager.formatSize(selectedStats.totalSize)})`,
                cls: 'polyglot-stat-item selected'
            });
        }

        // 类型统计
        const typeStats = Object.entries(stats.byType)
            .map(([type, count]) => `${type}: ${count}`)
            .join(', ');
        if (typeStats) {
            statsContainer.createEl('div', { 
                text: `📂 类型分布: ${typeStats}`,
                cls: 'polyglot-stat-detail'
            });
        }
    }

    private updateItemList(container?: HTMLElement) {
        const listContainer = container || this.contentEl.querySelector('.polyglot-cache-list') as HTMLElement;
        if (!listContainer) return;

        listContainer.empty();

        if (this.filteredItems.length === 0) {
            listContainer.createEl('div', { 
                text: '没有找到符合条件的缓存文件',
                cls: 'polyglot-empty-message'
            });
            return;
        }

        // 限制显示数量，避免性能问题
        const displayItems = this.filteredItems.slice(0, 100);
        if (this.filteredItems.length > 100) {
            listContainer.createEl('div', { 
                text: `⚠️ 只显示前100个文件，共${this.filteredItems.length}个`,
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
            nameDiv.createEl('span', { text: item.name, cls: 'name' });
            nameDiv.createEl('span', { text: item.type, cls: `type ${item.type}` });
            
            const detailDiv = infoDiv.createDiv({ cls: 'polyglot-item-detail' });
            detailDiv.createEl('span', { text: this.cacheManager.formatSize(item.size), cls: 'size' });
            detailDiv.createEl('span', { text: this.cacheManager.formatTime(item.lastModified), cls: 'time' });
            detailDiv.createEl('span', { text: item.category, cls: 'category' });
        });
    }

    private async confirmCleanup() {
        if (this.selectedItems.size === 0) {
            new Notice('请先选择要清理的文件');
            return;
        }

        const selectedItems = this.filteredItems.filter(item => this.selectedItems.has(item.path));
        const stats = this.cacheManager.getCacheStats(selectedItems);

        const confirmed = confirm(
            `确定要删除 ${selectedItems.length} 个缓存文件吗？\n` +
            `总大小: ${this.cacheManager.formatSize(stats.totalSize)}\n` +
            `此操作不可撤销！`
        );

        if (!confirmed) return;

        try {
            const cleanupNotice = new Notice('正在清理缓存...', 0);
            const result = await this.cacheManager.deleteItems(selectedItems);
            cleanupNotice.hide();

            new Notice(`✅ 清理完成: 成功删除 ${result.success} 个文件${result.failed > 0 ? `，失败 ${result.failed} 个` : ''}`);
            
            // 刷新数据
            await this.loadCacheData();
            this.applyFilter();
        } catch (error) {
            this.logger.error('清理缓存失败', error);
            new Notice('清理缓存失败');
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
