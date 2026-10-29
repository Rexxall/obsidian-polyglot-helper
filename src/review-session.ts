import { Menu, Notice, setIcon } from "obsidian";
import type PolyglotHelper from "./main";
import { EnglishVocabularyItem, JapaneseVocabularyItem, VocabularyItem } from "./types";

import { fire } from "./shared/fire";
import { errorMessage } from "./shared/errors";
import { tr } from './shared/i18n';
type AnyItem = VocabularyItem | JapaneseVocabularyItem | EnglishVocabularyItem;
type Scope = 'all' | 'english' | 'japanese';

// 三档评分对应 0-5 的记忆质量：忘了=1、模糊=3、记得=4。
// A function, not a constant: labels follow the interface language set when the plugin loads.
const GRADES = () => [
    { key: '1', label: tr('忘了', 'Forgot'), performance: 1, cls: 'is-forgot' },
    { key: '2', label: tr('模糊', 'Unsure'), performance: 3, cls: 'is-fuzzy' },
    { key: '3', label: tr('记得', 'Knew it'), performance: 4, cls: 'is-known' },
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
            empty.createEl('p', { text: tr('生词本还没有开启。开启后，查词时收进的词会按间隔安排复习。', 'The word list is off. Turn it on and words you add while looking up will be scheduled for spaced review.') });
            const btn = empty.createEl('button', { text: tr('开启生词本', 'Turn on the word list'), cls: 'mod-cta polyglot-primary' });
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
        title.createDiv({ cls: 'ap-row-title', text: tr('今天的复习', "Today's review") });
        title.createDiv({ cls: 'ap-row-desc', text: due.total > 0 ? tr(`约 ${minutes} 分钟`, `About ${minutes} min`) : tr('今天都复习完了', 'All done for today') });
        const more = head.createEl('button', { cls: 'clickable-icon polyglot-due-more', attr: { 'aria-label': tr('更多', 'More') } });
        setIcon(more, 'more-horizontal');
        more.addEventListener('click', (event) => {
            const menu = new Menu();
            if (due.english > 0) menu.addItem(item => item.setTitle(tr('只复习英语', 'English only')).setIcon('languages').onClick(() => this.start('english')));
            if (due.japanese > 0) menu.addItem(item => item.setTitle(tr('只复习日语', 'Japanese only')).setIcon('languages').onClick(() => this.start('japanese')));
            menu.addItem(item => item.setTitle(tr(`打开生词本（${total}）`, `Open word list (${total})`)).setIcon('book-open').onClick(() => this.plugin.activateManagementPanel()));
            menu.showAtMouseEvent(event);
        });

        const stats = card.createDiv({ cls: 'ap-stats polyglot-due-stats' });
        const stat = (label: string, value: number, unit: string) => {
            const cell = stats.createDiv({ cls: 'ap-stat' });
            cell.createDiv({ cls: 'ap-stat-label', text: label });
            const v = cell.createDiv({ cls: 'ap-stat-value', text: String(value) });
            v.createSpan({ cls: 'ap-unit', text: unit });
        };
        stat(tr('到期', 'Due'), due.total, tr('个', ' '));
        stat(tr('英语', 'English'), due.english, tr('个', ' '));
        stat(tr('日语', 'Japanese'), due.japanese, tr('个', ' '));

        if (due.total > 0) {
            const start = card.createEl('button', { text: tr('开始复习', 'Start review'), cls: 'ap-btn is-primary polyglot-due-start' });
            start.addEventListener('click', () => this.start('all'));
        }

        if (due.total === 0) {
            this.host.createDiv({ cls: 'polyglot-review-empty', text: tr('今天没有要复习的词。查词时点“加入生词本”，新词会出现在这里。', 'Nothing to review today. Press "Add to word list" while looking up and new words will show here.') });
            return;
        }

        // 今天要复习的词，最多列 8 个
        const SHOW = 8;
        const items = this.tracker.getDueReviewItems('all', SHOW);
        this.host.createDiv({ cls: 'ap-section-title polyglot-due-list-title', text: tr('今天要复习', 'Due today') });
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
            row.createSpan({ cls: 'ap-pill', text: kind === 'japanese' ? tr('日', 'JA') : tr('英', 'EN') });
        }
        if (due.total > SHOW) this.host.createDiv({ cls: 'polyglot-muted polyglot-due-rest', text: tr(`还有 ${due.total - SHOW} 个，开始复习后会一起出现`, `${due.total - SHOW} more appear once you start`) });
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
        prog.createSpan({ text: tr(`已复习 ${this.index} / ${this.items.length}`, `Reviewed ${this.index} / ${this.items.length}`) });
        prog.createSpan({ text: tr(`约 ${Math.max(1, Math.ceil(left * SECONDS_PER_CARD / 60))} 分钟`, `About ${Math.max(1, Math.ceil(left * SECONDS_PER_CARD / 60))} min`) });
        const bar = this.host.createDiv({ cls: 'polyglot-bar' });
        bar.createDiv().style.width = `${(this.index / this.items.length) * 100}%`;

        const card = this.host.createDiv({ cls: 'polyglot-flash' });
        const kind = this.tracker.kindOf(item);
        const front = kind === 'japanese' ? (item as JapaneseVocabularyItem).japaneseText : (item as VocabularyItem).word;
        const reading = kind === 'japanese' ? (item as JapaneseVocabularyItem).reading : (item as EnglishVocabularyItem).phonetics;

        const wordRow = card.createDiv({ cls: 'polyglot-flash-word' });
        wordRow.createSpan({ text: front });
        if (kind !== 'legacy') {
            const play = wordRow.createEl('button', { cls: 'polyglot-play', attr: { 'aria-label': tr('朗读', 'Read aloud') } });
            setIcon(play, 'play');
            play.addEventListener('click', fire(() => this.play(item, kind)));
        }
        if (reading) card.createDiv({ cls: 'polyglot-flash-reading', text: kind === 'japanese' ? reading : `/${reading.replace(/^\/|\/$/g, '')}/` });

        const answer = card.createDiv({ cls: 'polyglot-flash-answer' });
        const reveal = answer.createEl('button', { text: tr('显示答案', 'Show answer'), cls: 'polyglot-secondary' });
        reveal.addEventListener('click', () => this.reveal(answer, item, kind));

        const foot = this.host.createDiv({ cls: 'polyglot-review-foot' });
        const left2 = foot.createDiv({ cls: 'polyglot-quiet-links' });
        if (kind !== 'legacy') {
            const fav = (item as EnglishVocabularyItem).isFavorite;
            this.quietLink(left2, fav ? tr('已收藏', 'Saved') : tr('收藏', 'Save'), fire(async () => {
                await this.toggleFavorite(item, kind);
                this.renderCard();
            }));
        }
        this.quietLink(left2, tr('跳过', 'Skip'), () => { this.index++; this.renderCard(); });
        this.quietLink(foot, tr('结束', 'End'), () => this.renderHome());
    }

    private reveal(answer: HTMLElement, item: AnyItem, kind: 'japanese' | 'english' | 'legacy') {
        if (this.showingAnswer) return;
        this.showingAnswer = true;
        answer.empty();
        answer.addClass('is-shown');
        answer.createDiv({ cls: 'polyglot-flash-meaning', text: item.translation || tr('（没有记下释义）', '(no meaning saved)') });
        if (kind === 'japanese') {
            const original = (item as JapaneseVocabularyItem).originalText;
            if (original && original !== (item as JapaneseVocabularyItem).japaneseText) {
                answer.createDiv({ cls: 'polyglot-muted', text: tr(`原文：${original}`, `Source: ${original}`) });
            }
        }
        const example = item.examples?.[0];
        if (example) answer.createDiv({ cls: 'polyglot-flash-example', text: example });
        const source = sourceNote(item.notes);
        if (source) answer.createDiv({ cls: 'polyglot-muted', text: source });

        const grades = this.host.createDiv({ cls: 'polyglot-grades' });
        // 放在卡片和底部链接之间
        this.host.insertBefore(grades, this.host.querySelector('.polyglot-review-foot'));
        for (const g of GRADES()) {
            const btn = grades.createEl('button', { cls: `polyglot-grade ${g.cls}` });
            btn.createSpan({ text: g.label });
            btn.createEl('small', { text: describeNext(this.tracker.previewNextReview(item, g.performance)) });
            btn.setAttr('title', tr(`快捷键 ${g.key}`, `Shortcut ${g.key}`));
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
            .catch(e => new Notice(tr(`没有记下这次复习：${errorMessage(e)}`, `Could not save this review: ${errorMessage(e)}`)));
    }

    private renderDone() {
        const done = this.host.createDiv({ cls: 'polyglot-review-done' });
        done.createDiv({ cls: 'polyglot-due-count', text: String(this.reviewed) });
        done.createDiv({ text: this.reviewed > 0 ? tr('个词复习完了', 'words reviewed') : tr('这一轮没有打分', 'Nothing rated this round') });
        const due = this.tracker.getDueCounts();
        if (due.total > 0) {
            const again = done.createEl('button', { text: tr(`还有 ${due.total} 个到期，继续`, `${due.total} more are due; continue`), cls: 'mod-cta polyglot-primary' });
            again.addEventListener('click', () => this.start(this.scope));
        }
        this.quietLink(this.host.createDiv({ cls: 'polyglot-review-foot' }), tr('回到开始', 'Back to start'), () => this.renderHome());
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
        const grade = GRADES().find(g => g.key === e.key);
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
            new Notice(tr('朗读失败', 'Could not read aloud'));
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
    if (next.hours) return tr(`${next.hours} 小时后`, `in ${next.hours} h`);
    const d = next.days || 1;
    if (d === 1) return tr('明天', 'Tomorrow');
    if (d < 30) return tr(`${d} 天后`, `in ${d} days`);
    if (d < 365) return tr(`${Math.round(d / 30)} 个月后`, `in ${Math.round(d / 30)} months`);
    return tr(`${Math.round(d / 365)} 年后`, `in ${Math.round(d / 365)} years`);
}

/** notes 里“收自 …”那一行（查词小卡收词时写入），去掉内部的 EF 记录，链接显示成书名号。 */
export function sourceNote(notes?: string): string {
    if (!notes) return '';
    const line = notes.split('\n').find(l => l.trim().startsWith('收自'));
    return line ? line.replace(/\s*EF:[\d.]+/, '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '《$1》').trim() : '';
}
