export declare class Timeout<TArgs extends any[]> implements NodeJS.Timeout {
	constructor(callback: TimerHandler, args: TArgs);
	ref();
	unref();
	hasRef(): boolean;
	refresh();
	[Symbol.dispose]();
	[Symbol.toPrimitive](): number;
}
