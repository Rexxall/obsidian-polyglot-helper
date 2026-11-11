/**
 * The most common English function words: articles, prepositions, pronouns, forms of "be",
 * and conjunctions. They appear in almost every sentence, so they are never underlined in
 * reading view and never added to the word list automatically. Saving one by hand still works.
 */
const FUNCTION_WORDS = new Set([
	// articles and determiners
	'a', 'an', 'the', 'this', 'that', 'these', 'those',
	// prepositions
	'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'as', 'at',
	'before', 'behind', 'below', 'beside', 'between', 'beyond', 'by', 'down', 'during', 'for',
	'from', 'in', 'inside', 'into', 'near', 'of', 'off', 'on', 'onto', 'out', 'over', 'per',
	'since', 'than', 'through', 'to', 'toward', 'towards', 'under', 'until', 'up', 'upon',
	'via', 'with', 'within', 'without',
	// pronouns
	'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself', 'yourselves',
	'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself',
	'we', 'us', 'our', 'ours', 'ourselves', 'they', 'them', 'their', 'theirs', 'themselves',
	'who', 'whom', 'whose', 'which', 'what',
	// be
	'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
	// conjunctions
	'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'because', 'although', 'though', 'while',
	'whether', 'unless', 'when', 'where',
]);

export function isFunctionWord(word: string): boolean {
	return FUNCTION_WORDS.has(word.trim().toLowerCase());
}

/** The word auto-add would save for a lookup: its first word, or none when that is a function word. */
export function autoAddEnglishWord(query: string): string {
	const word = query.trim().split(/\s+/)[0].toLowerCase();
	return isFunctionWord(word) ? '' : word;
}
