import { Menu, Notice, setIcon } from "obsidian";
import type PolyglotHelper from "./main";
import { EnglishVocabularyItem, JapaneseVocabularyItem, VocabularyItem } from "./types";

import { fire } from "./shared/fire";
import { errorMessage } from "./shared/errors";
type AnyItem = VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem;
type Scope = 'all' | 'english' | 'japanese';

// 三档评分对应 0-5 的记忆质量：忘了=1、模糊=3、记得=4。
const GRADES = [
    { key: '1', label: '忘了', performance: 1, cls: 'is-forgot' },
    { key: '2', label: '模糊', performance: 3, cls: 'is-fuzzy' },
    { key: '3', label: '记得', performance: 4, cls: 'is-known' },
];

const SECONDS_PER_CARD = 30;

/**
 * 复习页：首屏是今天到期的数量，点开始后一张一张过。
 * 侧栏“学习”页和单独的复习标签页共用这一份。
 */
export class ReviewSession {
    private items: AnyItem[] = [];
    private index = 0;
    private reviewed = 0;
    private showingAnswer = false;
    private startedAt = 0;
    private scope: Scope = 'all';
    private onKey = (e: KeyboardEvent) => this.handleKey(e);

    constructor(private plugin: PolyglotHelper, private host: HTMLElement) {
        this.host.addClass('polyglot-review');
        this.host.setAttr('tabindex', '-1');
        this.host.addEventListener('keydown', this.onKey);
    }

    destroy() {
        this.host.removeEventListener('keydown', this.onKey);
    }

    private get tracker() {
        return this.plugin.learningTracker;
    }

    renderHome() {
        this.host.empty();
        this.items = [];

        if (!this.plugin.settings.enableLearningTracker) {
            const empty = this.host.createDiv({ cls: 'polyglot-review-empty' });
            empty.createEl('p', { text: '生词本还没有开启。开启后，查词时收进的词会按间隔安排复习。' });
            const btn = empty.createEl('button', { text: '开启生词本', cls: 'mod-cta polyglot-primary' });
            btn.addEventListener('click', fire(async () => {
                this.plugin.settings.enableLearningTracker = true;
                await this.plugin.saveSettings();
                this.renderHome();
            }));
            return;
        }

        const due = this.tracker.getDueCounts();
        const total = this.tracker.getEnglishVocabulary().length + this.tracker.getJapaneseVocabulary().length;
        const minutes = Math.max(1, Math.ceil(due.total * SECONDS_PER_CARD / 60));

        // 一张卡：标题行（“…”里是分语种复习与生词本），三格数字，开始按钮
        const card = this.host.createDiv({ cls: 'ap-card polyglot-today' });
        const head = card.createDiv({ cls: 'ap-card-head polyglot-due-head' });
        setIcon(head.createDiv({ cls: 'ap-icon-tile' }), 'calendar-check');
        const title = head.createDiv({ cls: 'ap-row-main' });
        title.createDiv({ cls: 'ap-row-title', text: '今天的复习' });
        title.createDiv({ cls: 'ap-row-desc', text: due.total > 0 ? `约 ${minutes} 分钟` : '今天都复习完了' });
        const more = head.createEl('button', { cls: 'clickable-icon polyglot-due-more', attr: { 'aria-label': '更多' } });
        setIcon(more, 'more-horizontal');
        more.addEventListener('click', (event) => {
            const menu = new Menu();
            if (due.english > 0) menu.addItem(item => item.setTitle('只复习英语').setIcon('languages').onClick(() => this.start('english')));
            if (due.japanese > 0) menu.addItem(item => item.setTitle('只复习日语').setIcon('languages').onClick(() => this.start('japanese')));
            menu.addItem(item => item.setTitle(`打开生词本（${total}）`).setIcon('book-open').onClick(() => this.plugin.activateManagementPanel()));
            menu.showAtMouseEvent(event);
        });

        const stats = card.createDiv({ cls: 'ap-stats polyglot-due-stats' });
        const stat = (label: string, value: number, unit: string) => {
            const cell = stats.createDiv({ cls: 'ap-stat' });
            cell.createDiv({ cls: 'ap-stat-label', text: label });
            const v = cell.createDiv({ cls: 'ap-stat-value', text: String(value) });
            v.createSpan({ cls: 'ap-unit', text: unit });
        };
        stat('到期', due.total, '个');
        stat('英语', due.english, '个');
        stat('日语', due.japanese, '个');

        if (due.total > 0) {
            const start = card.createEl('button', { text: '开始复习', cls: 'ap-btn is-primary polyglot-due-start' });
            start.addEventListener('click', () => this.start('all'));
        }

        if (due.total === 0) {
            this.host.createDiv({ cls: 'polyglot-review-empty', text: '今天没有要复习的词。查词时点“加入生词本”，新词会出现在这里。' });
            return;
        }

        // 今天要复习的词，最多列 8 个
        const SHOW = 8;
        const items = this.tracker.getDueReviewItems('all', SHOW);
        this.host.createDiv({ cls: 'ap-section-title polyglot-due-list-title', text: '今天要复习' });
        const list = this.host.createDiv({ cls: 'ap-group polyglot-due-list' });
        for (const item of items) {
            const kind = this.tracker.kindOf(item);
            const row = list.createDiv({ cls: 'ap-row' });
            const main = row.createDiv({ cls: 'ap-row-main' });
            const word = kind === 'japanese' ? (item as JapaneseVocabularyItem).japaneseText : (item as EnglishVocabularyItem).word;
            main.createDiv({ cls: 'ap-row-title', text: word });
            const reading = kind === 'japanese' ? (item as JapaneseVocabularyItem).reading : '';
            // 旧版本收词时可能把整段 Markdown 存进释义，这里只取第一行干净文字
            const first = (item.translation || '').split('\n')[0].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
            const meaning = [reading, first === word ? '' : first].filter(Boolean).join(' · ');
            if (meaning) main.createDiv({ cls: 'ap-row-desc', text: meaning });
            row.createSpan({ cls: 'ap-pill', text: kind === 'japanese' ? '日' : '英' });
        }
        if (due.total > SHOW) this.host.createDiv({ cls: 'polyglot-muted polyglot-due-rest', text: `还有 ${due.total - SHOW} 个，开始复习后会一起出现` });
    }

    private start(scope: Scope) {
        this.scope = scope;
        this.items = this.tracker.getDueReviewItems(scope, 50);
        this.index = 0;
        this.reviewed = 0;
        if (this.items.length === 0) {
            this.renderHome();
            return;
        }
        this.renderCard();
        this.host.focus();
    }

    private renderCard() {
        this.host.empty();
        if (this.index >= this.items.length) {
            this.renderDone();
            return;
        }
        const item = this.items[this.index];
        this.showingAnswer = false;
        this.startedAt = Date.now();

        const left = this.items.length - this.index;
        const prog = this.host.createDiv({ cls: 'polyglot-review-progress' });
        prog.createSpan({ text: `已复习 ${this.index} / ${this.items.length}` });
        prog.createSpan({ text: `约 ${Math.max(1, Math.ceil(left * SECONDS_PER_CARD / 60))} 分钟` });
        const bar = this.host.createDiv({ cls: 'polyglot-bar' });
        bar.createDiv().style.width = `${(this.index / this.items.length) * 100}%`;

        const card = this.host.createDiv({ cls: 'polyglot-flash' });
        const kind = this.tracker.kindOf(item);
        const front = kind === 'japanese' ? (item as JapaneseVocabularyItem).japaneseText : (item as VocabularyItem).word;
        const reading = kind === 'japanese' ? (item as JapaneseVocabularyItem).reading : (item as EnglishVocabularyItem).phonetics;

        const wordRow = card.createDiv({ cls: 'polyglot-flash-word' });
        wordRow.createSpan({ text: front });
        if (kind !== 'legacy') {
            const play = wordRow.createEl('button', { cls: 'polyglot-play', attr: { 'aria-label': '朗读' } });
            setIcon(play, 'play');
            play.addEventListener('click', fire(() => this.play(item, kind)));
        }
        if (reading) card.createDiv({ cls: 'polyglot-flash-reading', text: kind === 'japanese' ? reading : `/${reading.replace(/^\/|\/$/g, '')}/` });

        const answer = card.createDiv({ cls: 'polyglot-flash-answer' });
        const reveal = answer.createEl('button', { text: '显示答案', cls: 'polyglot-secondary' });
        reveal.addEventListener('click', () => this.reveal(answer, item, kind));

        const foot = this.host.createDiv({ cls: 'polyglot-review-foot' });
        const left2 = foot.createDiv({ cls: 'polyglot-quiet-links' });
        if (kind !== 'legacy') {
            const fav = (item as EnglishVocabularyItem).isFavorite;
            this.quietLink(left2, fav ? '已收藏' : '收藏', fire(async () => {
                await this.toggleFavorite(item, kind);
                this.renderCard();
            }));
        }
        this.quietLink(left2, '跳过', () => { this.index++; this.renderCard(); });
        this.quietLink(foot, '结束', () => this.renderHome());
    }

    private reveal(answer: HTMLElement, item: AnyItem, kind: 'japanese' | 'english' | 'legacy') {
        if (this.showingAnswer) return;
        this.showingAnswer = true;
        answer.empty();
        answer.addClass('is-shown');
        answer.createDiv({ cls: 'polyglot-flash-meaning', text: item.translation || '（没有记下释义）' });
        if (kind === 'japanese') {
            const original = (item as JapaneseVocabularyItem).originalText;
            if (original && original !== (item as JapaneseVocabularyItem).japaneseText) {
                answer.createDiv({ cls: 'polyglot-muted', text: `原文：${original}` });
            }
        }
        const example = item.examples?.[0];
        if (example) answer.createDiv({ cls: 'polyglot-flash-example', text: example });
        const source = sourceNote(item.notes);
        if (source) answer.createDiv({ cls: 'polyglot-muted', text: source });

        const grades = this.host.createDiv({ cls: 'polyglot-grades' });
        // 放在卡片和底部链接之间
        this.host.insertBefore(grades, this.host.querySelector('.polyglot-review-foot'));
        for (const g of GRADES) {
            const btn = grades.createEl('button', { cls: `polyglot-grade ${g.cls}` });
            btn.createSpan({ text: g.label });
            btn.createEl('small', { text: describeNext(this.tracker.previewNextReview(item, g.performance)) });
            btn.setAttr('title', `快捷键 ${g.key}`);
            btn.addEventListener('click', () => this.grade(item, g.performance));
        }
    }

    private grade(item: AnyItem, performance: number) {
        const spent = Date.now() - this.startedAt;
        this.reviewed++;
        this.index++;
        this.renderCard();
        this.host.focus();
        // 先翻到下一张，保存在后台进行
        this.tracker.recordItemReview(item, performance, spent)
            .catch(e => new Notice(`没有记下这次复习：${errorMessage(e)}`));
    }

    private renderDone() {
        const done = this.host.createDiv({ cls: 'polyglot-review-done' });
        done.createDiv({ cls: 'polyglot-due-count', text: String(this.reviewed) });
        done.createDiv({ text: this.reviewed > 0 ? '个词复习完了' : '这一轮没有打分' });
        const due = this.tracker.getDueCounts();
        if (due.total > 0) {
            const again = done.createEl('button', { text: `还有 ${due.total} 个到期，继续`, cls: 'mod-cta polyglot-primary' });
            again.addEventListener('click', () => this.start(this.scope));
        }
        this.quietLink(this.host.createDiv({ cls: 'polyglot-review-foot' }), '回到开始', () => this.renderHome());
    }

    private handleKey(e: KeyboardEvent) {
        if (this.items.length === 0 || this.index >= this.items.length) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const item = this.items[this.index];
        if (!this.showingAnswer && (e.key === ' ' || e.key === 'Enter')) {
            e.preventDefault();
            const answer = this.host.querySelector<HTMLElement>('.polyglot-flash-answer');
            if (answer) this.reveal(answer, item, this.tracker.kindOf(item));
            return;
        }
        const grade = GRADES.find(g => g.key === e.key);
        if (this.showingAnswer && grade) {
            e.preventDefault();
            this.grade(item, grade.performance);
        }
    }

    private async play(item: AnyItem, kind: 'japanese' | 'english' | 'legacy') {
        try {
            if (kind === 'japanese') await this.plugin.playJapaneseVoice((item as JapaneseVocabularyItem).japaneseText, false);
            else await this.plugin.playEnglishVoice((item as EnglishVocabularyItem).word, false);
        } catch {
            new Notice('朗读失败');
        }
    }

    private async toggleFavorite(item: AnyItem, kind: 'japanese' | 'english' | 'legacy') {
        const next = !(item as EnglishVocabularyItem).isFavorite;
        try {
            if (kind === 'japanese') {
                const jp = item as JapaneseVocabularyItem;
                await this.tracker.updateJapaneseVocabularyItem(jp.originalText, jp.japaneseText, { isFavorite: next });
            } else {
                await this.tracker.updateEnglishVocabularyItem((item as EnglishVocabularyItem).word, { isFavorite: next });
            }
        } catch (e) {
            new Notice(errorMessage(e));
        }
    }

    private quietLink(parent: HTMLElement, text: string, onClick: () => void) {
        const a = parent.createEl('button', { text, cls: 'polyglot-link' });
        a.addEventListener('click', onClick);
        return a;
    }
}

function describeNext(next: { hours?: number; days?: number }): string {
    if (next.hours) return `${next.hours} 小时后`;
    const d = next.days || 1;
    if (d === 1) return '明天';
    if (d < 30) return `${d} 天后`;
    if (d < 365) return `${Math.round(d / 30)} 个月后`;
    return `${Math.round(d / 365)} 年后`;
}

/** notes 里“收自 …”那一行（查词小卡收词时写入），去掉内部的 EF 记录，链接显示成书名号。 */
export function sourceNote(notes?: string): string {
    if (!notes) return '';
    const line = notes.split('\n').find(l => l.trim().startsWith('收自'));
    return line ? line.replace(/\s*EF:[\d.]+/, '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '《$1》').trim() : '';
}
