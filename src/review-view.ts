import { ItemView, WorkspaceLeaf } from "obsidian";
import PolyglotHelper from "./main";
import { LearningTracker } from "./learning-tracker";
import { ReviewSession } from "./review-session";

export const POLYGLOT_REVIEW_VIEW_TYPE = "polyglot-review-view";

// 单独标签页里的复习，与侧栏“学习”页是同一个界面。
export class PolyglotReviewView extends ItemView {
    plugin: PolyglotHelper;
    private session: ReviewSession | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: PolyglotHelper, _learningTracker: LearningTracker) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return POLYGLOT_REVIEW_VIEW_TYPE; }
    getDisplayText() { return "复习单词"; }
    getIcon() { return "brain"; }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass('polyglot-root', 'polyglot-review-page');
        this.session = new ReviewSession(this.plugin, this.contentEl.createDiv());
        this.session.renderHome();
    }

    async onClose() {
        this.session?.destroy();
    }
}
