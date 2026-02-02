import { Socket } from "node:net";
export class ReadStream extends Socket {
	fd;
	constructor(fd) {
		super();
		this.fd = fd;
	}
	isRaw = false;
	setRawMode(mode) {
		this.isRaw = mode;
		return this;
	}
	isTTY = false;
}
