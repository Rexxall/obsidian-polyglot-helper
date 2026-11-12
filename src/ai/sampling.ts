/**
 * OpenAI reasoning models (o-series, gpt-5 and later) only accept the default temperature
 * and answer HTTP 400 to any other value, so their requests leave it out.
 */
export function isReasoningModel(model: string | undefined): boolean {
	const name = (model ?? '').trim().toLowerCase().replace(/^openai\//, '');
	return /^(o\d|gpt-([5-9]|\d{2,}))/.test(name);
}

export function temperatureFor(model: string | undefined, value: number): { temperature?: number } {
	return isReasoningModel(model) ? {} : { temperature: value };
}
