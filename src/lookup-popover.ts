import { Notice, TFile, setIcon } from "obsidian";
import type PolyglotHelper from "./main";
import { getDictionaryInfoTS } from "./apis/dictionary";
import { getJishoInfoTS } from "./apis/jisho";
import { postChatCompletion } from "./apis/llm";

interface LookupResult {
    reading: string;
    pos: string;
    meaning: string;
    inContext: string;
    example: string;
    definitions: string[];
    sources: string[];
}

const LLM_TIMEOUT_MS = 20_000;
const cache = new Map<string, LookupResult>();

export function isJapaneseText(text: string): boolean {
    return /[぀-ヿ一-龯]/.test(text) && !/^[\x00-\x7F]+$/.test(text);
}

/** 从一行里取出包含选中词的那一句。 */
export function sentenceAround(line: string, word: string): string {
    const parts = line.split(/(?<=[.!?。！？])\s*/);
    return (parts.find(p => p.includes(word)) || line).trim();
}

/**
 * 查词小卡：贴着选中的词弹出，只给读音、本句里的意思和一条例句。
 * 详细内容点“完整词条”再去侧栏看。
 */
export class LookupPopover {
    private static current: LookupPopover | null = null;
    private el: HTMLElement;
    private body: HTMLElement;
    private result: LookupResult | null = null;
    private readonly japanese: boolean;
    private cleanup: Array<() => void> = [];

    constructor(
        private plugin: PolyglotHelper,
        private word: string,
        private sentence: string,
        private anchor: DOMRect,
        private file: TFile | null,
    ) {
        this.japanese = isJapaneseText(word);
    }

    static close() {
        LookupPopover.current?.close();
    }

    open() {
        LookupPopover.close();
        LookupPopover.current = this;

        this.el = document.body.createDiv({ cls: 'polyglot-root polyglot-popover' });
        this.el.setAttr('role', 'dialog');
        this.el.setAttr('aria-label', `查词：${this.word}`);

        const head = this.el.createDiv({ cls: 'polyglot-pop-head' });
        head.createSpan({ cls: 'polyglot-pop-word', text: this.word });
        head.createSpan({ cls: 'polyglot-pop-reading' });
        const play = head.createEl('button', { cls: 'polyglot-play', attr: { 'aria-label': '朗读' } });
        setIcon(play, 'play');
        play.addEventListener('click', () => this.play());

        this.body = this.el.createDiv({ cls: 'polyglot-pop-body' });
        this.body.createDiv({ cls: 'polyglot-muted', text: '正在查……' });

        const acts = this.el.createDiv({ cls: 'polyglot-pop-actions' });
        const save = acts.createEl('button', { cls: 'mod-cta polyglot-primary', text: '收进生词本' });
        save.addEventListener('click', () => this.save(save));
        const full = acts.createEl('button', { cls: 'polyglot-link', text: '完整词条 →' });
        full.addEventListener('click', () => {
            this.close();
            this.plugin.openFullEntry(this.word, this.japanese, this.file);
        });
        acts.createSpan({ cls: 'polyglot-pop-src' });

        this.position();
        this.bindDismiss();
        this.load();
    }

    close() {
        this.cleanup.forEach(fn => fn());
        this.cleanup = [];
        this.el?.remove();
        if (LookupPopover.current === this) LookupPopover.current = null;
    }

    private position() {
        const margin = 8;
        const width = Math.min(380, window.innerWidth - margin * 2);
        this.el.style.width = `${width}px`;
        const left = Math.min(Math.max(margin, this.anchor.left - 24), window.innerWidth - width - margin);
        this.el.style.left = `${left}px`;
        this.el.style.setProperty('--arrow-x', `${Math.max(16, this.anchor.left - left + this.anchor.width / 2 - 6)}px`);

        const below = this.anchor.bottom + 10;
        const height = this.el.offsetHeight || 200;
        if (below + height > window.innerHeight - margin && this.anchor.top - height - 10 > margin) {
            this.el.style.top = `${this.anchor.top - height - 10}px`;
            this.el.addClass('is-above');
        } else {
            this.el.style.top = `${below}px`;
        }
    }

    private bindDismiss() {
        const onDown = (e: MouseEvent) => {
            if (!this.el.contains(e.target as Node)) this.close();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.close();
        };
        const onScroll = (e: Event) => {
            if (!this.el.contains(e.target as Node)) this.close();
        };
        // 下一轮再挂，避免触发打开的那次点击立刻把它关掉
        window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('scroll', onScroll, true);
        this.cleanup.push(
            () => document.removeEventListener('mousedown', onDown, true),
            () => document.removeEventListener('keydown', onKey, true),
            () => document.removeEventListener('scroll', onScroll, true),
        );
    }

    private async load() {
        const key = `${this.word}\u0000${this.sentence}`;
        try {
            this.result = cache.get(key) || (this.japanese ? await this.lookupJapanese() : await this.lookupEnglish());
            cache.set(key, this.result);
        } catch (e) {
            this.plugin.logger.error('查词小卡失败', e);
            this.result = null;
        }
        if (!this.el.isConnected) return;
        this.render();
    }

    private render() {
        this.body.empty();
        const r = this.result;
        if (!r || (!r.meaning && !r.inContext && r.definitions.length === 0)) {
            this.body.createDiv({ cls: 'polyglot-muted', text: '没有查到。可以点“完整词条”用模型分析。' });
            this.position();
            return;
        }
        if (r.reading) (this.el.querySelector('.polyglot-pop-reading') as HTMLElement).setText(r.reading);

        const mean = this.body.createDiv({ cls: 'polyglot-pop-meaning' });
        if (r.pos) mean.createSpan({ cls: 'polyglot-pos', text: r.pos });
        mean.appendText(r.meaning || r.definitions[0] || '');
        if (r.inContext) this.body.createDiv({ cls: 'polyglot-pop-context', text: `本句里：${r.inContext}` });
        if (r.example) this.body.createDiv({ cls: 'polyglot-pop-example', text: r.example });

        (this.el.querySelector('.polyglot-pop-src') as HTMLElement).setText(r.sources.join(' · '));
        this.position();
    }

    private async lookupEnglish(): Promise<LookupResult> {
        const lower = this.word.toLowerCase();
        const [dict, llm] = await Promise.all([
            getDictionaryInfoTS(lower, this.plugin.logger as any).catch(() => ({} as any)),
            this.askModel(
                `Word: "${this.word}"\nSentence: "${this.sentence}"\n` +
                'Return strict JSON: {"pos":"part of speech abbreviation like adj.","meaning":"简短中文释义，不超过20字","in_context":"这个词在这句话里具体指什么，中文，不超过30字"}'
            ),
        ]);
        const sources: string[] = [];
        if (dict.meanings?.length) sources.push('Free Dictionary');
        if (llm) sources.push('模型');
        const firstDef = (dict.meanings?.[0] || '').replace(/^_([^_]+)_:\s*/, '');
        const dictPos = (dict.meanings?.[0] || '').match(/^_([^_]+)_/)?.[1] || '';
        return {
            reading: dict.phonetics || '',
            pos: llm?.pos || abbreviatePos(dictPos),
            meaning: llm?.meaning || firstDef,
            inContext: llm?.in_context || '',
            example: dict.examples?.[0] || '',
            definitions: (dict.meanings || []).map((m: string) => m.replace(/^_([^_]+)_:\s*/, '')),
            sources,
        };
    }

    private async lookupJapanese(): Promise<LookupResult> {
        const [jisho, llm] = await Promise.all([
            getJishoInfoTS(this.word, this.plugin.logger as any).catch(() => null),
            this.askModel(
                `語: 「${this.word}」\n文: 「${this.sentence}」\n` +
                'Return strict JSON: {"reading":"かな読み","pos":"品詞（中文，如 名词、动词）","meaning":"简短中文释义，不超过20字","in_context":"这个词在这句话里具体指什么，中文，不超过30字"}'
            ),
        ]);
        const sources: string[] = [];
        if (jisho) sources.push('Jisho');
        if (llm) sources.push('模型');
        return {
            reading: llm?.reading || jisho?.reading || '',
            pos: llm?.pos || '',
            meaning: llm?.meaning || jisho?.meanings?.[0]?.definition || '',
            inContext: llm?.in_context || '',
            example: '',
            definitions: (jisho?.meanings || []).map(m => m.definition),
            sources,
        };
    }

    private async askModel(prompt: string): Promise<Record<string, string> | null> {
        const config = this.plugin.tryGetApiConfig('quickTranslation');
        if (!config?.apiKey || !config.baseUrl) return null;
        try {
            const res = await postChatCompletion(config.baseUrl, config.apiKey, {
                model: config.model,
                temperature: 0,
                messages: [
                    { role: 'system', content: 'You are a concise bilingual dictionary. Output strict JSON only.' },
                    { role: 'user', content: prompt },
                ],
            }, LLM_TIMEOUT_MS);
            if (res.status !== 200) return null;
            const raw = (res.json.choices?.[0]?.message?.content || '').replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
            return JSON.parse(raw);
        } catch (e) {
            this.plugin.logger.warn?.('查词小卡：模型没有给出结果', e);
            return null;
        }
    }

    private async play() {
        try {
            if (this.japanese) await this.plugin.playJapaneseVoice(this.word, false);
            else await this.plugin.playEnglishVoice(this.word, false);
        } catch (e) {
            new Notice('朗读失败');
        }
    }

    private async save(button: HTMLButtonElement) {
        const r = this.result;
        if (!r) {
            new Notice('还没查到释义，稍等一下再收');
            return;
        }
        const settings = this.plugin.settings;
        if (!settings.enableLearningTracker) {
            settings.enableLearningTracker = true;
            new Notice('已开启生词本');
        }
        const today = new Date().toISOString().slice(0, 10);
        const note = `收自 ${this.file ? `[[${this.file.basename}]]` : '查词'} · ${today}`;
        const meaning = r.meaning || r.definitions[0] || '';
        const tracker = this.plugin.learningTracker;
        // 已经收过的词不再覆盖，免得冲掉复习记录
        const exists = this.japanese
            ? !!settings.japaneseVocabItems[`${this.word}_${this.word}`]
            : !!settings.englishVocabItems[this.word.toLowerCase()];
        if (exists) {
            button.setText('已在生词本里');
            button.disabled = true;
            return;
        }
        if (this.japanese) {
            await tracker.addJapaneseVocabularyItem(this.word, this.word, r.reading, meaning, note, [this.sentence], ['查词小卡']);
        } else {
            await tracker.addEnglishVocabularyItem(this.word.toLowerCase(), meaning, r.reading, r.pos, r.definitions, note, [this.sentence], ['查词小卡']);
        }
        button.setText('已收进生词本');
        button.disabled = true;
    }
}

function abbreviatePos(pos: string): string {
    const map: Record<string, string> = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.', conjunction: 'conj.', pronoun: 'pron.', interjection: 'interj.' };
    return map[pos.toLowerCase()] || pos;
}
