/**
 * 事件回调要求返回 void，异步处理函数交给它：Promise 照常执行，出错写进控制台，不会变成未处理的拒绝。
 */
export function fire<A extends unknown[]>(handler: (...args: A) => unknown): (...args: A) => void {
	return (...args: A) => {
		void Promise.resolve(handler(...args)).catch((error: unknown) => console.error('[Polyglot Helper]', error));
	};
}
