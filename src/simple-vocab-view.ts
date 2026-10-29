import type { SimpleVocabularyItem } from "./types";
import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, TextComponent } from "obsidian";
import PolyglotHelper from "./main";

import { fire } from "./shared/fire";
import { confirmAction } from "./shared/confirm-modal";
import { tr } from './shared/i18n';
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
    getDisplayText() { return tr("词汇库", "Word list"); }
    getIcon() { return "book-open"; }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass('simple-vocab-container', 'ap', 'ap-view');
        
        this.renderHeader();
        this.renderSearchBar();
        this.renderVocabList();
    }

    private renderHeader() {
        const header = this.contentEl.createDiv({ cls: 'simple-vocab-header' });
        header.createEl('h2', { text: tr('📚 我的词汇库', '📚 My word list') });
        
        const stats = this.contentEl.createDiv({ cls: 'simple-vocab-stats' });
        const vocab = this.plugin.getSimpleVocabulary();
        const totalWords = Object.keys(vocab).length;
        const favoriteWords = Object.values(vocab).filter((item) => item.isFavorite).length;
        
        stats.empty();
        stats.createSpan({ cls: 'stat-item', text: tr(`📖 总词汇: ${totalWords}`, `📖 Total: ${totalWords}`) });
        stats.createSpan({ cls: 'stat-item', text: tr(`⭐ 收藏: ${favoriteWords}`, `⭐ Favourites: ${favoriteWords}`) });
    }

    private renderSearchBar() {
        const searchContainer = this.contentEl.createDiv({ cls: 'simple-vocab-search' });
        
        this.searchInput = new TextComponent(searchContainer)
            .setPlaceholder(tr('搜索词汇...', 'Search words...'))
            .onChange((value) => this.filterVocab(value));
        
        new ButtonComponent(searchContainer)
            .setButtonText(tr('➕ 添加词汇', '➕ Add word'))
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
        const filteredVocab = Object.entries(vocab).filter(([word, item]) => {
            if (!searchTerm) return true;
            const search = searchTerm.toLowerCase();
            return word.toLowerCase().includes(search) || 
                   item.translation.toLowerCase().includes(search) ||
                   item.notes.toLowerCase().includes(search);
        });

        if (filteredVocab.length === 0) {
            const emptyDiv = this.vocabList.createDiv({ cls: 'simple-vocab-empty' });
            emptyDiv.createDiv({ cls: 'empty-icon', text: '📚' });
            emptyDiv.createEl('h3', { text: tr('词汇库为空', 'The word list is empty') });
            emptyDiv.createEl('p', { text: tr('点击"添加词汇"开始收集你的词汇吧！', 'Press "Add word" to start collecting words.') });
            return;
        }

        // 按创建时间排序，最新的在前面
        filteredVocab.sort(([, a], [, b]) => b.createdAt - a.createdAt);

        filteredVocab.forEach(([word, item]) => {
            this.createVocabCard(word, item);
        });
    }

    private createVocabCard(word: string, item: SimpleVocabularyItem) {
        const card = this.vocabList.createDiv({ cls: 'simple-vocab-card' });
        
        const header = card.createDiv({ cls: 'vocab-card-header' });
        header.createEl('h3', { text: word, cls: 'vocab-word' });
        header.createEl('p', { text: item.translation, cls: 'vocab-translation' });
        
        if (item.notes) {
            card.createEl('p', { text: item.notes, cls: 'vocab-notes' });
        }
        
        const footer = card.createDiv({ cls: 'vocab-card-footer' });
        
        // 收藏按钮
        new ButtonComponent(footer)
            .setButtonText(item.isFavorite ? '⭐' : '☆')
            .setClass(item.isFavorite ? 'favorite active' : 'favorite')
            .onClick(async () => {
                item.isFavorite = !item.isFavorite;
                await this.plugin.saveSettings();
                this.updateVocabList(this.searchInput.getValue());
            });
        
        // 删除按钮
        new ButtonComponent(footer)
            .setButtonText('🗑️')
            .setClass('delete-btn')
            .onClick(async () => {
                if (await confirmAction(this.app, tr(`确定要删除词汇 "${word}" 吗？`, `Delete "${word}"?`))) {
                    await this.plugin.removeSimpleVocabularyItem(word);
                    this.updateVocabList(this.searchInput.getValue());
                    new Notice(tr(`已删除词汇 "${word}"`, `Deleted "${word}"`));
                }
            });
        
        // 复习按钮
        new ButtonComponent(footer)
            .setButtonText('🔄')
            .setClass('review-btn')
            .onClick(async () => {
                item.reviewCount++;
                item.lastReviewed = Date.now();
                await this.plugin.saveSettings();
                new Notice(tr(`已复习词汇 "${word}" (第${item.reviewCount}次)`, `Reviewed "${word}" (${item.reviewCount} times)`));
            });
        
        // 显示统计信息
        const stats = footer.createDiv({ cls: 'vocab-stats' });
        stats.createSpan({ cls: 'stat', text: tr(`复习: ${item.reviewCount}次`, `Reviews: ${item.reviewCount}`) });
        stats.createSpan({ cls: 'stat', text: tr(`添加: ${new Date(item.createdAt).toLocaleDateString()}`, `Added: ${new Date(item.createdAt).toLocaleDateString()}`) });
    }

    private filterVocab(searchTerm: string) {
        this.updateVocabList(searchTerm);
    }

    private showAddVocabModal() {
        const modal = createDiv();
        modal.className = 'simple-vocab-modal';
        const el1 = modal.createDiv({ cls: 'modal-content' });
        el1.createEl('h3', { text: tr('➕ 添加新词汇', '➕ Add a new word') });
        const el2 = el1.createDiv({ cls: 'form-group' });
        el2.createEl('label', { text: tr('词汇:', 'Word:') });
        el2.createEl('input', { attr: { type: 'text', id: 'vocab-word', placeholder: tr('输入词汇', 'Type a word') } });
        const el3 = el1.createDiv({ cls: 'form-group' });
        el3.createEl('label', { text: tr('翻译:', 'Translation:') });
        el3.createEl('input', { attr: { type: 'text', id: 'vocab-translation', placeholder: tr('输入翻译', 'Type the translation') } });
        const el4 = el1.createDiv({ cls: 'form-group' });
        el4.createEl('label', { text: tr('备注:', 'Notes:') });
        el4.createEl('textarea', { attr: { id: 'vocab-notes', placeholder: tr('可选备注', 'Optional notes') } });
        const el5 = el1.createDiv({ cls: 'modal-actions' });
        el5.createEl('button', { text: tr('取消', 'Cancel'), attr: { id: 'cancel-btn' } });
        el5.createEl('button', { cls: 'primary', text: tr('保存', 'Save'), attr: { id: 'save-btn' } });
        
        document.body.appendChild(modal);
        
        // 绑定事件
        modal.querySelector('#cancel-btn')?.addEventListener('click', () => {
            modal.remove();
        });
        
        modal.querySelector('#save-btn')?.addEventListener('click', fire(async () => {
            const word = (modal.querySelector('#vocab-word') as HTMLInputElement)?.value?.trim();
            const translation = (modal.querySelector('#vocab-translation') as HTMLInputElement)?.value?.trim();
            const notes = (modal.querySelector('#vocab-notes') as HTMLTextAreaElement)?.value?.trim();
            
            if (!word || !translation) {
                new Notice(tr('请填写词汇和翻译', 'Fill in the word and its translation'));
                return;
            }
            
            await this.plugin.addSimpleVocabularyItem(word, translation, notes);
            this.updateVocabList(this.searchInput.getValue());
            modal.remove();
            new Notice(tr(`已添加词汇 "${word}"`, `Added "${word}"`));
        }));
        
        // 自动聚焦到第一个输入框
        window.setTimeout(() => {
            (modal.querySelector('#vocab-word') as HTMLInputElement)?.focus();
        }, 100);
    }
}
