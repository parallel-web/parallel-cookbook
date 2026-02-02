import {
  asyncWrapProviders,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId
} from "unenv/node/async_hooks";
export {
  asyncWrapProviders,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId
} from "unenv/node/async_hooks";
const workerdAsyncHooks = process.getBuiltinModule("node:async_hooks");
export const { AsyncLocalStorage, AsyncResource } = workerdAsyncHooks;
export default {
  /**
   * manually unroll unenv-polyfilled-symbols to make it tree-shakeable
   */
  // @ts-expect-error @types/node is missing this one - this is a bug in typings
  asyncWrapProviders,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId,
  /**
   * manually unroll workerd-polyfilled-symbols to make it tree-shakeable
   */
  AsyncLocalStorage,
  AsyncResource
};
