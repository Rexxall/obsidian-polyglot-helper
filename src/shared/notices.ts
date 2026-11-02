import { tr } from './i18n';

/** Shown once, when the first word goes into a new word list: where it went and how to review it. */
export const FIRST_WORD_NOTICE = () =>
	tr(
		'已存进生词本。点底部状态栏的“待复习”就能复习。',
		'Saved to your word list. Click “to review” in the status bar to review it.',
	);
