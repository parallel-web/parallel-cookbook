// src/workers/assets/rpc-proxy.worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";
var RPCProxyWorker = class extends WorkerEntrypoint {
  async fetch(request) {
    return this.env.ROUTER_WORKER.fetch(request);
  }
};
export {
  RPCProxyWorker as default
};
//# sourceMappingURL=rpc-proxy.worker.js.map
