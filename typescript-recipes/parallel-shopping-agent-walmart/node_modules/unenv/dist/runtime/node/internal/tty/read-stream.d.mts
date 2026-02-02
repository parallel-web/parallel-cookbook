import type nodeTty from "node:tty";
import { Socket } from "node:net";
export declare class ReadStream extends Socket implements nodeTty.ReadStream {
	fd: number;
	constructor(fd: number);
	isRaw: boolean;
	setRawMode(mode: boolean);
	isTTY: boolean;
}
