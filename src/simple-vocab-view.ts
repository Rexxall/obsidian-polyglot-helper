import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, TextComponent } from "obsidian";
import PolyglotHelper from "./main";

export const SIMPLE_VOCAB_VIEW_TYPE = "simple-vocab-view";

export class SimpleVocabView extends ItemView {
    plugin: PolyglotHelper;
    private searchInput: TextComponent;
    private vocabList: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: PolyglotHelper) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return SIMPLE_VOCAB_VIEW_TYPE; }
    getDisplayText() { return "词汇库"; }
    getIcon() { return "book-open"; }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass('simple-vocab-container');
        
        this.renderHeader();
        this.renderSearchBar();
        this.renderVocabList();
    }

    private renderHeader() {
        const header = this.contentEl.createDiv({ cls: 'simple-vocab-header' });
        header.createEl('h2', { text: '📚 我的词汇库' });
        
        const stats = this.contentEl.createDiv({ cls: 'simple-vocab-stats' });
        const vocab = this.plugin.getSimpleVocabulary();
        const totalWords = Object.keys(vocab).length;
        const favoriteWords = Object.values(vocab).filter((item: any) => item.isFavorite).length;
        
        stats.innerHTML = `
            <span class="stat-item">📖 总词汇: ${totalWords}</span>
            <span class="stat-item">⭐ 收藏: ${favoriteWords}</span>
        `;
    }

    private renderSearchBar() {
        const searchContainer = this.contentEl.createDiv({ cls: 'simple-vocab-search' });
        
        this.searchInput = new TextComponent(searchContainer)
            .setPlaceholder('搜索词汇...')
            .onChange((value) => this.filterVocab(value));
        
        const addButton = new ButtonComponent(searchContainer)
            .setButtonText('➕ 添加词汇')
            .setCta()
            .onClick(() => this.showAddVocabModal());
    }

    private renderVocabList() {
        this.vocabList = this.contentEl.createDiv({ cls: 'simple-vocab-list' });
        this.updateVocabList();
    }

    private updateVocabList(searchTerm: string = '') {
        this.vocabList.empty();
        
        const vocab = this.plugin.getSimpleVocabulary();
        const filteredVocab = Object.entries(vocab).filter(([word, item]: [string, any]) => {
            if (!searchTerm) return true;
            const search = searchTerm.toLowerCase();
            return word.toLowerCase().includes(search) || 
                   item.translation.toLowerCase().includes(search) ||
                   item.notes.toLowerCase().includes(search);
        });

        if (filteredVocab.length === 0) {
            const emptyDiv = this.vocabList.createDiv({ cls: 'simple-vocab-empty' });
            emptyDiv.innerHTML = `
                <div class="empty-icon">📚</div>
                <h3>词汇库为空</h3>
                <p>点击"添加词汇"开始收集你的词汇吧！</p>
            `;
            return;
        }

        // 按创建时间排序，最新的在前面
        filteredVocab.sort(([, a]: [string, any], [, b]: [string, any]) => b.createdAt - a.createdAt);

        filteredVocab.forEach(([word, item]: [string, any]) => {
            this.createVocabCard(word, item);
        });
    }

    private createVocabCard(word: string, item: any) {
        const card = this.vocabList.createDiv({ cls: 'simple-vocab-card' });
        
        const header = card.createDiv({ cls: 'vocab-card-header' });
        const wordEl = header.createEl('h3', { text: word, cls: 'vocab-word' });
        const translationEl = header.createEl('p', { text: item.translation, cls: 'vocab-translation' });
        
        if (item.notes) {
            const notesEl = card.createEl('p', { text: item.notes, cls: 'vocab-notes' });
        }
        
        const footer = card.createDiv({ cls: 'vocab-card-footer' });
        
        // 收藏按钮
        const favoriteBtn = new ButtonComponent(footer)
            .setButtonText(item.isFavorite ? '⭐' : '☆')
            .setClass(item.isFavorite ? 'favorite active' : 'favorite')
            .onClick(async () => {
                item.isFavorite = !item.isFavorite;
                await this.plugin.saveSettings();
                this.updateVocabList(this.searchInput.getValue());
            });
        
        // 删除按钮
        const deleteBtn = new ButtonComponent(footer)
            .setButtonText('🗑️')
            .setClass('delete-btn')
            .onClick(async () => {
                if (confirm(`确定要删除词汇 "${word}" 吗？`)) {
                    await this.plugin.removeSimpleVocabularyItem(word);
                    this.updateVocabList(this.searchInput.getValue());
                    new Notice(`已删除词汇 "${word}"`);
                }
            });
        
        // 复习按钮
        const reviewBtn = new ButtonComponent(footer)
            .setButtonText('🔄')
            .setClass('review-btn')
            .onClick(async () => {
                item.reviewCount++;
                item.lastReviewed = Date.now();
                await this.plugin.saveSettings();
                new Notice(`已复习词汇 "${word}" (第${item.reviewCount}次)`);
            });
        
        // 显示统计信息
        const stats = footer.createDiv({ cls: 'vocab-stats' });
        stats.innerHTML = `
            <span class="stat">复习: ${item.reviewCount}次</span>
            <span class="stat">添加: ${new Date(item.createdAt).toLocaleDateString()}</span>
        `;
    }

    private filterVocab(searchTerm: string) {
        this.updateVocabList(searchTerm);
    }

    private showAddVocabModal() {
        const modal = document.createElement('div');
        modal.className = 'simple-vocab-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>➕ 添加新词汇</h3>
                <div class="form-group">
                    <label>词汇:</label>
                    <input type="text" id="vocab-word" placeholder="输入词汇">
                </div>
                <div class="form-group">
                    <label>翻译:</label>
                    <input type="text" id="vocab-translation" placeholder="输入翻译">
                </div>
                <div class="form-group">
                    <label>备注:</label>
                    <textarea id="vocab-notes" placeholder="可选备注"></textarea>
                </div>
                <div class="modal-actions">
                    <button id="cancel-btn">取消</button>
                    <button id="save-btn" class="primary">保存</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 绑定事件
        modal.querySelector('#cancel-btn')?.addEventListener('click', () => {
            modal.remove();
        });
        
        modal.querySelector('#save-btn')?.addEventListener('click', async () => {
            const word = (modal.querySelector('#vocab-word') as HTMLInputElement)?.value?.trim();
            const translation = (modal.querySelector('#vocab-translation') as HTMLInputElement)?.value?.trim();
            const notes = (modal.querySelector('#vocab-notes') as HTMLTextAreaElement)?.value?.trim();
            
            if (!word || !translation) {
                new Notice('请填写词汇和翻译');
                return;
            }
            
            await this.plugin.addSimpleVocabularyItem(word, translation, notes);
            this.updateVocabList(this.searchInput.getValue());
            modal.remove();
            new Notice(`已添加词汇 "${word}"`);
        });
        
        // 自动聚焦到第一个输入框
        setTimeout(() => {
            (modal.querySelector('#vocab-word') as HTMLInputElement)?.focus();
        }, 100);
    }
}
