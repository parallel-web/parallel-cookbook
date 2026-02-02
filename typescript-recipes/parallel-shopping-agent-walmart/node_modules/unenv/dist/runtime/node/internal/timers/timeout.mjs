export class Timeout {
	constructor(callback, args) {
		if (typeof callback === "function") {
			callback(...args);
		}
	}
	ref() {
		return this;
	}
	unref() {
		return this;
	}
	hasRef() {
		return false;
	}
	refresh() {
		return this;
	}
	[Symbol.dispose]() {}
	[Symbol.toPrimitive]() {
		return 0;
	}
}
