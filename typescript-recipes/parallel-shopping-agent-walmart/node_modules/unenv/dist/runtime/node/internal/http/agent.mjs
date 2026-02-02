import { EventEmitter } from "node:events";
export class Agent extends EventEmitter {
	__unenv__ = {};
	maxFreeSockets = 256;
	maxSockets = Infinity;
	maxTotalSockets = Infinity;
	freeSockets = {};
	sockets = {};
	requests = {};
	destroy() {}
}
