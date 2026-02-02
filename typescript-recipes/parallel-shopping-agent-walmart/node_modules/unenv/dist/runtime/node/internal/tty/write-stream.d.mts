import type nodeTty from "node:tty";
import { Socket } from "node:net";
export declare class WriteStream extends Socket implements nodeTty.WriteStream {
	fd: number;
	constructor(fd: number);
	clearLine(dir: nodeTty.Direction, callback?: (() => void) | undefined): boolean;
	clearScreenDown(callback?: (() => void) | undefined): boolean;
	cursorTo(x: number, y?: number | undefined, callback?: (() => void) | undefined): boolean;
	cursorTo(x: number, callback: () => void): boolean;
	moveCursor(dx: number, dy: number, callback?: (() => void) | undefined): boolean;
	getColorDepth(env?: object | undefined): number;
	hasColors(count?: number | undefined): boolean;
	hasColors(env?: object | undefined): boolean;
	hasColors(count: number, env?: object | undefined): boolean;
	getWindowSize(): [number, number];
	columns: number;
	rows: number;
	isTTY: boolean;
}
