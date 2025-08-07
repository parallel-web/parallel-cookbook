import { ReadableStream as ReadableStream_2 } from 'stream/web';
import { RequestInit as RequestInit_10 } from '../../../../../../../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_11 } from '../../../../../../../../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_12 } from '../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_13 } from '../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_14 } from '../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_15 } from '../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_16 } from '../../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_17 } from '../../../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_18 } from '../../../../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_19 } from '../../../../../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_2 } from '../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_20 } from '../../../../../../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_21 } from '../../../../../../../../../../node_modules/undici/index.d.ts';
import { RequestInit as RequestInit_22 } from '../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_23 } from '../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_24 } from '../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_25 } from '../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_26 } from '../../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_27 } from '../../../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_28 } from '../../../../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_29 } from '../../../../../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_3 } from '../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_30 } from '../../../../../../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_31 } from '../../../../../../../../../../node_modules/@types/node-fetch/index.d.ts';
import { RequestInit as RequestInit_32 } from '../node_modules/node-fetch';
import { RequestInit as RequestInit_33 } from '../../node_modules/node-fetch';
import { RequestInit as RequestInit_34 } from '../../../node_modules/node-fetch';
import { RequestInit as RequestInit_35 } from '../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_36 } from '../../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_37 } from '../../../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_38 } from '../../../../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_39 } from '../../../../../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_4 } from '../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_40 } from '../../../../../../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_41 } from '../../../../../../../../../../node_modules/node-fetch';
import { RequestInit as RequestInit_5 } from '../../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_6 } from '../../../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_7 } from '../../../../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_8 } from '../../../../../../../node_modules/undici-types/index.d.ts';
import { RequestInit as RequestInit_9 } from '../../../../../../../../node_modules/undici-types/index.d.ts';

declare namespace API {
    export {
        Beta,
        TaskRun,
        Input,
        JsonSchema,
        TaskRunResult,
        TaskSpec,
        TextSchema,
        TaskRunCreateParams,
        TaskRunResultParams
    }
}

export declare class APIConnectionError extends APIError<undefined, undefined, undefined> {
    constructor({ message, cause }: {
        message?: string | undefined;
        cause?: Error | undefined;
    });
}

export declare class APIConnectionTimeoutError extends APIConnectionError {
    constructor({ message }?: {
        message?: string;
    });
}

export declare class APIError<TStatus extends number | undefined = number | undefined, THeaders extends Headers | undefined = Headers | undefined, TError extends Object | undefined = Object | undefined> extends ParallelError {
    /** HTTP status for the response that caused the error */
    readonly status: TStatus;
    /** HTTP headers for the response that caused the error */
    readonly headers: THeaders;
    /** JSON body of the response that caused the error */
    readonly error: TError;
    constructor(status: TStatus, error: TError, message: string | undefined, headers: THeaders);
    private static makeMessage;
    static generate(status: number | undefined, errorResponse: Object | undefined, message: string | undefined, headers: Headers | undefined): APIError;
}

/**
 * A subclass of `Promise` providing additional helper methods
 * for interacting with the SDK.
 */
export declare class APIPromise<T> extends Promise<T> {
    #private;
    private responsePromise;
    private parseResponse;
    private parsedPromise;
    constructor(client: Parallel, responsePromise: Promise<APIResponseProps>, parseResponse?: (client: Parallel, props: APIResponseProps) => PromiseOrValue<T>);
    _thenUnwrap<U>(transform: (data: T, props: APIResponseProps) => U): APIPromise<U>;
    /**
     * Gets the raw `Response` instance instead of parsing the response
     * data.
     *
     * If you want to parse the response body but still get the `Response`
     * instance, you can use {@link withResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
     * to your `tsconfig.json`.
     */
    asResponse(): Promise<Response>;
    /**
     * Gets the parsed response data and the raw `Response` instance.
     *
     * If you just want to get the raw `Response` instance without parsing it,
     * you can use {@link asResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
     * to your `tsconfig.json`.
     */
    withResponse(): Promise<{
        data: T;
        response: Response;
    }>;
    private parse;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}

declare abstract class APIResource {
    protected _client: Parallel;
    constructor(client: Parallel);
}

declare type APIResponseProps = {
    response: Response;
    options: FinalRequestOptions;
    controller: AbortController;
    requestLogID: string;
    retryOfRequestLogID: string | undefined;
    startTime: number;
};

export declare class APIUserAbortError extends APIError<undefined, undefined, undefined> {
    constructor({ message }?: {
        message?: string;
    });
}

export declare class AuthenticationError extends APIError<401, Headers> {
}

export declare class BadRequestError extends APIError<400, Headers> {
}

declare class Beta extends APIResource {
    taskGroup: TaskGroupAPI.TaskGroup;
}

declare namespace Beta {
        { declare type TaskGroup as TaskGroup, declare type TaskGroupRun as TaskGroupRun, declare type TaskGroupEventsResponse as TaskGroupEventsResponse, declare type TaskGroupRetrieveRunsResponse as TaskGroupRetrieveRunsResponse, declare type TaskGroupCreateParams as TaskGroupCreateParams, declare type TaskGroupAddRunsParams as TaskGroupAddRunsParams, declare type TaskGroupEventsParams as TaskGroupEventsParams, declare type TaskGroupRetrieveRunsParams as TaskGroupRetrieveRunsParams, };
}

/**
 * Intended to match DOM Blob, node-fetch Blob, node:buffer Blob, etc.
 * Don't add arrayBuffer here, node-fetch doesn't have it
 */
declare interface BlobLike {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/size) */
    readonly size: number;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/type) */
    readonly type: string;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/text) */
    text(): Promise<string>;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/slice) */
    slice(start?: number, end?: number): BlobLike;
}

declare type BlobLikePart = string | ArrayBuffer | ArrayBufferView | BlobLike | DataView;

/**
 * A copy of the builtin `BlobPropertyBag` type as it isn't fully supported in certain
 * environments and attempting to reference the global version will error.
 *
 * https://github.com/microsoft/TypeScript/blob/49ad1a3917a0ea57f5ff248159256e12bb1cb705/src/lib/dom.generated.d.ts#L154
 * https://developer.mozilla.org/en-US/docs/Web/API/Blob/Blob#options
 */
declare interface BlobPropertyBag {
    endings?: EndingType;
    type?: string;
}

/**
 * The type for constructing `RequestInit` body.
 *
 * https://developer.mozilla.org/docs/Web/API/RequestInit#body
 */
declare type _BodyInit = RequestInit['body'];

declare const brand_privateNullableHeaders: unique symbol;

declare interface BunFile extends Blob {
    readonly name?: string | undefined;
}

/** @ts-ignore For users with \@types/bun */
declare type BunRequestInit = globalThis.FetchRequestInit;

export declare interface ClientOptions {
    /**
     * Defaults to process.env['PARALLEL_API_KEY'].
     */
    apiKey?: string | undefined;
    /**
     * Specifies the environment to use for the API.
     *
     * Each environment maps to a different base URL:
     * - `production` corresponds to `https://api.parallel.ai`
     * - `staging` corresponds to `https://api.scl124ai.com/staging`
     * - `canary` corresponds to `https://api.scl124ai.com/canary`
     */
    environment?: Environment | undefined;
    /**
     * Override the default base URL for the API, e.g., "https://api.example.com/v2/"
     *
     * Defaults to process.env['PARALLEL_BASE_URL'].
     */
    baseURL?: string | null | undefined;
    /**
     * The maximum amount of time (in milliseconds) that the client should wait for a response
     * from the server before timing out a single request.
     *
     * Note that request timeouts are retried by default, so in a worst-case scenario you may wait
     * much longer than this timeout before the promise succeeds or fails.
     *
     * @unit milliseconds
     */
    timeout?: number | undefined;
    /**
     * Additional `RequestInit` options to be passed to `fetch` calls.
     * Properties will be overridden by per-request `fetchOptions`.
     */
    fetchOptions?: MergedRequestInit | undefined;
    /**
     * Specify a custom `fetch` function implementation.
     *
     * If not provided, we expect that `fetch` is defined globally.
     */
    fetch?: Fetch | undefined;
    /**
     * The maximum number of times that the client will retry a request in case of a
     * temporary failure, like a network error or a 5XX error from the server.
     *
     * @default 2
     */
    maxRetries?: number | undefined;
    /**
     * Default headers to include with every request to the API.
     *
     * These can be removed in individual requests by explicitly setting the
     * header to `null` in request options.
     */
    defaultHeaders?: HeadersLike | undefined;
    /**
     * Default query parameters to include with every request to the API.
     *
     * These can be removed in individual requests by explicitly setting the
     * param to `undefined` in request options.
     */
    defaultQuery?: Record<string, string | undefined> | undefined;
    /**
     * Set the log level.
     *
     * Defaults to process.env['PARALLEL_LOG'] or 'warn' if it isn't set.
     */
    logLevel?: LogLevel | undefined;
    /**
     * Set the logger.
     *
     * Defaults to globalThis.console.
     */
    logger?: Logger | undefined;
}

declare type _ConditionalNodeReadableStream<R = any> = typeof globalThis extends {
    ReadableStream: any;
} ? never : _NodeReadableStream<R>;

export declare class ConflictError extends APIError<409, Headers> {
}

/** @ts-ignore */
declare type _DOMReadableStream<R = any> = globalThis.ReadableStream<R>;

declare type EncodedContent = {
    bodyHeaders: HeadersLike;
    body: _BodyInit;
};

/**
 * A copy of the builtin `EndingType` type as it isn't fully supported in certain
 * environments and attempting to reference the global version will error.
 *
 * https://github.com/microsoft/TypeScript/blob/49ad1a3917a0ea57f5ff248159256e12bb1cb705/src/lib/dom.generated.d.ts#L27941
 */
declare type EndingType = 'native' | 'transparent';

declare type Environment = keyof typeof environments;

declare const environments: {
    production: string;
    staging: string;
    canary: string;
};

declare namespace Errors {
    export {
        ParallelError,
        APIError,
        APIUserAbortError,
        APIConnectionError,
        APIConnectionTimeoutError,
        BadRequestError,
        AuthenticationError,
        PermissionDeniedError,
        NotFoundError,
        ConflictError,
        UnprocessableEntityError,
        RateLimitError,
        InternalServerError
    }
}

declare const FallbackEncoder: RequestEncoder;

declare type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** @ts-ignore For users who use Deno */
declare type FetchRequestInit = NonNullable<OverloadedParameters<typeof fetch>[1]>;

/**
 * Intended to match DOM File, node:buffer File, undici File, etc.
 */
declare interface FileLike extends BlobLike {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/lastModified) */
    readonly lastModified: number;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/name) */
    readonly name?: string | undefined;
}

/**
 * A copy of the builtin `FilePropertyBag` type as it isn't fully supported in certain
 * environments and attempting to reference the global version will error.
 *
 * https://github.com/microsoft/TypeScript/blob/49ad1a3917a0ea57f5ff248159256e12bb1cb705/src/lib/dom.generated.d.ts#L503
 * https://developer.mozilla.org/en-US/docs/Web/API/File/File#options
 */
declare interface FilePropertyBag extends BlobPropertyBag {
    lastModified?: number;
}

declare type FinalizedRequestInit = RequestInit & {
    headers: Headers;
};

declare type FinalRequestOptions = RequestOptions & {
    method: HTTPMethod;
    path: string;
};

declare type FsReadStream = AsyncIterable<Uint8Array> & {
    path: string | {
        toString(): string;
    };
};

declare type HeadersLike = Headers | readonly HeaderValue[][] | Record<string, HeaderValue | readonly HeaderValue[]> | undefined | null | NullableHeaders;

declare type HeaderValue = string | undefined | null;

declare type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Request to run a task.
 */
declare interface Input {
    /**
     * Input to the task, either text or a JSON object.
     */
    input: string | unknown;
    /**
     * Processor to use for the task.
     */
    processor: string;
    /**
     * User-provided metadata stored with the run. Keys and values must be strings with
     * a maximum length of 16 and 512 characters respectively.
     */
    metadata?: {
        [key: string]: string | number | boolean;
    } | null;
    /**
     * Specification for a task.
     *
     * For convenience we allow bare strings as input or output schemas, which is
     * equivalent to a text schema with the same description.
     */
    task_spec?: TaskSpec | null;
}

export declare class InternalServerError extends APIError<number, Headers> {
}

/**
 * JSON schema for a task input or output.
 */
declare interface JsonSchema {
    /**
     * A JSON Schema object. Only a subset of JSON Schema is supported.
     */
    json_schema: unknown;
    /**
     * The type of schema being defined. Always `json`.
     */
    type?: 'json';
}

declare type LogFn = (message: string, ...rest: unknown[]) => void;

declare type Logger = {
    error: LogFn;
    warn: LogFn;
    info: LogFn;
    debug: LogFn;
};

declare type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

/**
 * This type contains `RequestInit` options that may be available on the current runtime,
 * including per-platform extensions like `dispatcher`, `agent`, `client`, etc.
 */
declare type MergedRequestInit = RequestInits & 
/** We don't include these in the types as they'll be overridden for every request. */
Partial<Record<'body' | 'headers' | 'method' | 'signal', never>>;

/**
 * Shims for types that we can't always rely on being available globally.
 *
 * Note: these only exist at the type-level, there is no corresponding runtime
 * version for any of these symbols.
 */
declare type NeverToAny<T> = T extends never ? any : T;

/** @ts-ignore For users with node-fetch@2 */
declare type NodeFetch2RequestInit = NotAny<RequestInit_22> | NotAny<RequestInit_23> | NotAny<RequestInit_24> | NotAny<RequestInit_25> | NotAny<RequestInit_26> | NotAny<RequestInit_27> | NotAny<RequestInit_28> | NotAny<RequestInit_29> | NotAny<RequestInit_30> | NotAny<RequestInit_31>;

/** @ts-ignore For users with node-fetch@3, doesn't need file extension because types are at ./@types/index.d.ts */
declare type NodeFetch3RequestInit = NotAny<RequestInit_32> | NotAny<RequestInit_33> | NotAny<RequestInit_34> | NotAny<RequestInit_35> | NotAny<RequestInit_36> | NotAny<RequestInit_37> | NotAny<RequestInit_38> | NotAny<RequestInit_39> | NotAny<RequestInit_40> | NotAny<RequestInit_41>;

/** @ts-ignore */
declare type _NodeReadableStream<R = any> = ReadableStream_2<R>;

declare type NotAny<T> = [0] extends [1 & T] ? never : T;

export declare class NotFoundError extends APIError<404, Headers> {
}

/* Excluded from this release type: NullableHeaders */

declare namespace Opts {
    export {
        FinalRequestOptions,
        RequestOptions,
        EncodedContent,
        RequestEncoder,
        FallbackEncoder
    }
}

/**
 * Some environments overload the global fetch function, and Parameters<T> only gets the last signature.
 */
declare type OverloadedParameters<T> = T extends ({
    (...args: infer A): unknown;
    (...args: infer B): unknown;
    (...args: infer C): unknown;
    (...args: infer D): unknown;
}) ? A | B | C | D : T extends ({
    (...args: infer A): unknown;
    (...args: infer B): unknown;
    (...args: infer C): unknown;
}) ? A | B | C : T extends ({
    (...args: infer A): unknown;
    (...args: infer B): unknown;
}) ? A | B : T extends (...args: infer A) => unknown ? A : never;

/**
 * API Client for interfacing with the Parallel API.
 */
declare class Parallel {
    #private;
    apiKey: string;
    baseURL: string;
    maxRetries: number;
    timeout: number;
    logger: Logger | undefined;
    logLevel: LogLevel | undefined;
    fetchOptions: MergedRequestInit | undefined;
    private fetch;
    protected idempotencyHeader?: string;
    private _options;
    /**
     * API Client for interfacing with the Parallel API.
     *
     * @param {string | undefined} [opts.apiKey=process.env['PARALLEL_API_KEY'] ?? undefined]
     * @param {Environment} [opts.environment=production] - Specifies the environment URL to use for the API.
     * @param {string} [opts.baseURL=process.env['PARALLEL_BASE_URL'] ?? https://api.parallel.ai] - Override the default base URL for the API.
     * @param {number} [opts.timeout=1 minute] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
     * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
     * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
     * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
     * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
     * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
     */
    constructor({ baseURL, apiKey, ...opts }?: ClientOptions);
    /**
     * Create a new client instance re-using the same options given to the current client with optional overriding.
     */
    withOptions(options: Partial<ClientOptions>): this;
    protected defaultQuery(): Record<string, string | undefined> | undefined;
    protected validateHeaders({ values, nulls }: NullableHeaders): void;
    protected authHeaders(opts: FinalRequestOptions): Promise<NullableHeaders | undefined>;
    /**
     * Basic re-implementation of `qs.stringify` for primitive types.
     */
    protected stringifyQuery(query: Record<string, unknown>): string;
    private getUserAgent;
    protected defaultIdempotencyKey(): string;
    protected makeStatusError(status: number, error: Object, message: string | undefined, headers: Headers): Errors.APIError;
    buildURL(path: string, query: Record<string, unknown> | null | undefined, defaultBaseURL?: string | undefined): string;
    /**
     * Used as a callback for mutating the given `FinalRequestOptions` object.
     */
    protected prepareOptions(options: FinalRequestOptions): Promise<void>;
    /**
     * Used as a callback for mutating the given `RequestInit` object.
     *
     * This is useful for cases where you want to add certain headers based off of
     * the request properties, e.g. `method` or `url`.
     */
    protected prepareRequest(request: _RequestInit, { url, options }: {
        url: string;
        options: FinalRequestOptions;
    }): Promise<void>;
    get<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp>;
    post<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp>;
    patch<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp>;
    put<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp>;
    delete<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp>;
    private methodRequest;
    request<Rsp>(options: PromiseOrValue<FinalRequestOptions>, remainingRetries?: number | null): APIPromise<Rsp>;
    private makeRequest;
    fetchWithTimeout(url: _RequestInfo, init: _RequestInit | undefined, ms: number, controller: AbortController): Promise<Response>;
    private shouldRetry;
    private retryRequest;
    private calculateDefaultRetryTimeoutMillis;
    buildRequest(inputOptions: FinalRequestOptions, { retryCount }?: {
        retryCount?: number;
    }): Promise<{
        req: FinalizedRequestInit;
        url: string;
        timeout: number;
    }>;
    private buildHeaders;
    private buildBody;
    static Parallel: typeof Parallel;
    static DEFAULT_TIMEOUT: number;
    static ParallelError: typeof Errors.ParallelError;
    static APIError: typeof Errors.APIError;
    static APIConnectionError: typeof Errors.APIConnectionError;
    static APIConnectionTimeoutError: typeof Errors.APIConnectionTimeoutError;
    static APIUserAbortError: typeof Errors.APIUserAbortError;
    static NotFoundError: typeof Errors.NotFoundError;
    static ConflictError: typeof Errors.ConflictError;
    static RateLimitError: typeof Errors.RateLimitError;
    static BadRequestError: typeof Errors.BadRequestError;
    static AuthenticationError: typeof Errors.AuthenticationError;
    static InternalServerError: typeof Errors.InternalServerError;
    static PermissionDeniedError: typeof Errors.PermissionDeniedError;
    static UnprocessableEntityError: typeof Errors.UnprocessableEntityError;
    static toFile: typeof Uploads.toFile;
    taskRun: API.TaskRun;
    beta: API.Beta;
}

declare namespace Parallel {
    type RequestOptions = Opts.RequestOptions;
        { declare type TaskRun as TaskRun, declare type Input as Input, declare type JsonSchema as JsonSchema, declare type TaskRunResult as TaskRunResult, declare type TaskSpec as TaskSpec, declare type TextSchema as TextSchema, declare type TaskRunCreateParams as TaskRunCreateParams, declare type TaskRunResultParams as TaskRunResultParams, };
        { Beta as Beta };
}
export { Parallel }
export default Parallel;

export declare class ParallelError extends Error {
}

export declare class PermissionDeniedError extends APIError<403, Headers> {
}

declare type PromiseOrValue<T> = T | Promise<T>;

export declare class RateLimitError extends APIError<429, Headers> {
}

declare type _ReadableStream_2<R = any> = NeverToAny<([0] extends [1 & _DOMReadableStream<R>] ? never : _DOMReadableStream<R>) | ([0] extends [1 & _ConditionalNodeReadableStream<R>] ? never : _ConditionalNodeReadableStream<R>)>;

declare type RequestEncoder = (request: {
    headers: NullableHeaders;
    body: unknown;
}) => EncodedContent;

/**
 * The type for the first argument to `fetch`.
 *
 * https://developer.mozilla.org/docs/Web/API/Window/fetch#resource
 */
declare type _RequestInfo = Request | URL | string;

/**
 * An alias to the builtin `RequestInit` type so we can
 * easily alias it in import statements if there are name clashes.
 *
 * https://developer.mozilla.org/docs/Web/API/RequestInit
 */
declare type _RequestInit = RequestInit;

declare type RequestInits = NotAny<UndiciTypesRequestInit> | NotAny<UndiciRequestInit> | NotAny<BunRequestInit> | NotAny<NodeFetch2RequestInit> | NotAny<NodeFetch3RequestInit> | NotAny<RequestInit> | NotAny<FetchRequestInit>;

declare type RequestOptions = {
    /**
     * The HTTP method for the request (e.g., 'get', 'post', 'put', 'delete').
     */
    method?: HTTPMethod;
    /**
     * The URL path for the request.
     *
     * @example "/v1/foo"
     */
    path?: string;
    /**
     * Query parameters to include in the request URL.
     */
    query?: object | undefined | null;
    /**
     * The request body. Can be a string, JSON object, FormData, or other supported types.
     */
    body?: unknown;
    /**
     * HTTP headers to include with the request. Can be a Headers object, plain object, or array of tuples.
     */
    headers?: HeadersLike;
    /**
     * The maximum number of times that the client will retry a request in case of a
     * temporary failure, like a network error or a 5XX error from the server.
     *
     * @default 2
     */
    maxRetries?: number;
    stream?: boolean | undefined;
    /**
     * The maximum amount of time (in milliseconds) that the client should wait for a response
     * from the server before timing out a single request.
     *
     * @unit milliseconds
     */
    timeout?: number;
    /**
     * Additional `RequestInit` options to be passed to the underlying `fetch` call.
     * These options will be merged with the client's default fetch options.
     */
    fetchOptions?: MergedRequestInit;
    /**
     * An AbortSignal that can be used to cancel the request.
     */
    signal?: AbortSignal | undefined | null;
    /**
     * A unique key for this request to enable idempotency.
     */
    idempotencyKey?: string;
    /**
     * Override the default base URL for this specific request.
     */
    defaultBaseURL?: string | undefined;
    __binaryResponse?: boolean | undefined;
    __streamClass?: typeof Stream;
};

/**
 * Intended to match DOM Response, node-fetch Response, undici Response, etc.
 */
declare interface ResponseLike {
    url: string;
    blob(): Promise<BlobLike>;
}

declare class Stream<Item> implements AsyncIterable<Item> {
    #private;
    private iterator;
    controller: AbortController;
    constructor(iterator: () => AsyncIterator<Item>, controller: AbortController, client?: Parallel);
    static fromSSEResponse<Item>(response: Response, controller: AbortController, client?: Parallel): Stream<Item>;
    /**
     * Generates a Stream from a newline-separated ReadableStream
     * where each item is a JSON value.
     */
    static fromReadableStream<Item>(readableStream: _ReadableStream_2, controller: AbortController, client?: Parallel): Stream<Item>;
    [Symbol.asyncIterator](): AsyncIterator<Item>;
    /**
     * Splits the stream into two streams which can be
     * independently read from at different speeds.
     */
    tee(): [Stream<Item>, Stream<Item>];
    /**
     * Converts this stream to a newline-separated ReadableStream of
     * JSON stringified values in the stream
     * which can be turned back into a Stream with `Stream.fromReadableStream()`.
     */
    toReadableStream(): _ReadableStream_2;
}

declare class TaskGroup extends APIResource {
    /**
     * Initiates a TaskGroup to group and track multiple runs.
     */
    create(body: TaskGroupCreateParams, options?: RequestOptions): APIPromise<TaskGroup>;
    /**
     * Retrieves aggregated status across runs in a TaskGroup.
     */
    retrieve(taskGroupID: string, options?: RequestOptions): APIPromise<TaskGroup>;
    /**
     * Initiates multiple task runs within a TaskGroup.
     */
    addRuns(taskGroupID: string, body: TaskGroupAddRunsParams, options?: RequestOptions): APIPromise<TaskGroupRun>;
    /**
     * Streams events from a TaskGroup: status updates and run completions.
     *
     * The connection will remain open for up to 10 minutes as long as at least one run
     * in the TaskGroup is active.
     */
    events(taskGroupID: string, query?: TaskGroupEventsParams | undefined, options?: RequestOptions): APIPromise<Stream<TaskGroupEventsResponse>>;
    /**
     * Retrieves task runs in a TaskGroup and optionally their inputs and outputs.
     *
     * Note: this method signature might change in the future based on feedback.
     * Questions:
     *
     * - is it confusing to return the same TaskRunEvent object as the event stream?
     * - should we support blocking until each run is completed?
     * - should event_id be an integer or opaque string instead of run_id?
     */
    retrieveRuns(taskGroupID: string, query?: TaskGroupRetrieveRunsParams | undefined, options?: RequestOptions): APIPromise<Stream<TaskGroupRetrieveRunsResponse>>;
}

/**
 * Response object for a task group, including its status and metadata.
 */
declare interface TaskGroup {
    /**
     * Timestamp of the creation of the group, as an RFC 3339 string.
     */
    created_at: string | null;
    /**
     * Status of a task group.
     */
    status: TaskGroup.Status;
    /**
     * ID of the group.
     */
    taskgroup_id: string;
    /**
     * User-provided metadata stored with the group.
     */
    metadata?: {
        [key: string]: string | number | boolean;
    } | null;
}

declare namespace TaskGroup {
    /**
     * Status of a task group.
     */
    interface Status {
        /**
         * True if at least one run in the group is currently active, i.e. status is one of
         * {'cancelling', 'queued', 'running'}.
         */
        is_active: boolean;
        /**
         * Timestamp of the last status update to the group, as an RFC 3339 string.
         */
        modified_at: string | null;
        /**
         * Number of task runs in the group.
         */
        num_task_runs: number;
        /**
         * Human-readable status message for the group.
         */
        status_message: string | null;
        /**
         * Number of task runs with each status.
         */
        task_run_status_counts: {
            [key: string]: number;
        };
    }
}

declare namespace TaskGroup {
        { declare type TaskGroup as TaskGroup, declare type TaskGroupRun as TaskGroupRun, declare type TaskGroupEventsResponse as TaskGroupEventsResponse, declare type TaskGroupRetrieveRunsResponse as TaskGroupRetrieveRunsResponse, declare type TaskGroupCreateParams as TaskGroupCreateParams, declare type TaskGroupAddRunsParams as TaskGroupAddRunsParams, declare type TaskGroupEventsParams as TaskGroupEventsParams, declare type TaskGroupRetrieveRunsParams as TaskGroupRetrieveRunsParams, };
}

declare interface TaskGroupAddRunsParams {
    /**
     * List of task runs to execute.
     */
    inputs: Array<TaskGroupAddRunsParams.Input>;
    /**
     * Specification for a task.
     *
     * For convenience we allow bare strings as input or output schemas, which is
     * equivalent to a text schema with the same description.
     */
    default_task_spec?: TaskRunAPI.TaskSpec | null;
}

declare namespace TaskGroupAddRunsParams {
    /**
     * Request to run a task.
     */
    interface Input {
        /**
         * Input to the task, either text or a JSON object.
         */
        input: string | unknown;
        /**
         * Processor to use for the task.
         */
        processor: string;
        /**
         * User-provided metadata stored with the run. Keys and values must be strings with
         * a maximum length of 16 and 512 characters respectively.
         */
        metadata?: {
            [key: string]: string | number | boolean;
        } | null;
        /**
         * Specification for a task.
         *
         * For convenience we allow bare strings as input or output schemas, which is
         * equivalent to a text schema with the same description.
         */
        task_spec?: TaskRunAPI.TaskSpec | null;
    }
}

declare namespace TaskGroupAPI {
    export {
        TaskGroup,
        TaskGroupRun,
        TaskGroupEventsResponse,
        TaskGroupRetrieveRunsResponse,
        TaskGroupCreateParams,
        TaskGroupAddRunsParams,
        TaskGroupEventsParams,
        TaskGroupRetrieveRunsParams
    }
}

declare interface TaskGroupCreateParams {
    /**
     * User-provided metadata stored with the task group.
     */
    metadata?: {
        [key: string]: string | number | boolean;
    } | null;
}

declare interface TaskGroupEventsParams {
    last_event_id?: string | null;
    timeout?: number | null;
}

declare type TaskGroupEventsResponse = string;

declare interface TaskGroupRetrieveRunsParams {
    include_input?: boolean;
    include_output?: boolean;
    last_event_id?: string | null;
    status?: 'queued' | 'action_required' | 'running' | 'completed' | 'failed' | 'cancelling' | 'cancelled' | null;
}

declare type TaskGroupRetrieveRunsResponse = string;

/**
 * Response from adding new task runs to a task group.
 */
declare interface TaskGroupRun {
    /**
     * Cursor for these runs in the event stream at
     * taskgroup/events?last_event_id=<event_cursor>. Empty for the first runs in the
     * group.
     */
    event_cursor: string | null;
    /**
     * Cursor for these runs in the run stream at
     * taskgroup/runs?last_event_id=<run_cursor>. Empty for the first runs in the
     * group.
     */
    run_cursor: string | null;
    /**
     * IDs of the newly created runs.
     */
    run_ids: Array<string>;
    /**
     * Status of a task group.
     */
    status: TaskGroupRun.Status;
}

declare namespace TaskGroupRun {
    /**
     * Status of a task group.
     */
    interface Status {
        /**
         * True if at least one run in the group is currently active, i.e. status is one of
         * {'cancelling', 'queued', 'running'}.
         */
        is_active: boolean;
        /**
         * Timestamp of the last status update to the group, as an RFC 3339 string.
         */
        modified_at: string | null;
        /**
         * Number of task runs in the group.
         */
        num_task_runs: number;
        /**
         * Human-readable status message for the group.
         */
        status_message: string | null;
        /**
         * Number of task runs with each status.
         */
        task_run_status_counts: {
            [key: string]: number;
        };
    }
}

declare class TaskRun extends APIResource {
    /**
     * Initiates a task run.
     *
     * Returns immediately with a run object in status 'queued'.
     */
    create(body: TaskRunCreateParams, options?: RequestOptions): APIPromise<TaskRun>;
    /**
     * Retrieves run status by run_id.
     *
     * The run result is available from the `/result` endpoint.
     */
    retrieve(runID: string, options?: RequestOptions): APIPromise<TaskRun>;
    /**
     * Retrieves a run result by run_id, blocking until the run is completed.
     */
    result(runID: string, query?: TaskRunResultParams | null | undefined, options?: RequestOptions): APIPromise<TaskRunResult>;
}

/**
 * Status of a task run.
 */
declare interface TaskRun {
    /**
     * Timestamp of the creation of the task, as an RFC 3339 string.
     */
    created_at: string | null;
    /**
     * Whether the run is currently active, i.e. status is one of {'cancelling',
     * 'queued', 'running'}.
     */
    is_active: boolean;
    /**
     * Timestamp of the last modification to the task, as an RFC 3339 string.
     */
    modified_at: string | null;
    /**
     * Processor used for the run.
     */
    processor: string;
    /**
     * ID of the task run.
     */
    run_id: string;
    /**
     * Status of the run.
     */
    status: 'queued' | 'action_required' | 'running' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
    /**
     * An error message.
     */
    error?: TaskRun.Error | null;
    /**
     * User-provided metadata stored with the run.
     */
    metadata?: {
        [key: string]: string | number | boolean;
    } | null;
    /**
     * ID of the taskgroup to which the run belongs.
     */
    taskgroup_id?: string | null;
    /**
     * Warnings for the run, if any.
     */
    warnings?: Array<TaskRun.Warning> | null;
}

declare namespace TaskRun {
    /**
     * An error message.
     */
    interface Error {
        /**
         * Human-readable message.
         */
        message: string;
        /**
         * Reference ID for the error.
         */
        ref_id: string;
        /**
         * Optional detail supporting the error.
         */
        detail?: unknown | null;
    }
    /**
     * Human-readable message for a task.
     */
    interface Warning {
        /**
         * Human-readable message.
         */
        message: string;
        /**
         * Type of warning. Note that adding new warning types is considered a
         * backward-compatible change.
         */
        type: string;
        /**
         * Optional detail supporting the warning.
         */
        detail?: unknown | null;
    }
}

declare namespace TaskRun {
        { declare type Input as Input, declare type JsonSchema as JsonSchema, declare type TaskRun as TaskRun, declare type TaskRunResult as TaskRunResult, declare type TaskSpec as TaskSpec, declare type TextSchema as TextSchema, declare type TaskRunCreateParams as TaskRunCreateParams, declare type TaskRunResultParams as TaskRunResultParams, };
}

declare namespace TaskRunAPI {
    export {
        TaskRun,
        Input,
        JsonSchema,
        TaskRunResult,
        TaskSpec,
        TextSchema,
        TaskRunCreateParams,
        TaskRunResultParams
    }
}

declare interface TaskRunCreateParams {
    /**
     * Input to the task, either text or a JSON object.
     */
    input: string | unknown;
    /**
     * Processor to use for the task.
     */
    processor: string;
    /**
     * User-provided metadata stored with the run. Keys and values must be strings with
     * a maximum length of 16 and 512 characters respectively.
     */
    metadata?: {
        [key: string]: string | number | boolean;
    } | null;
    /**
     * Specification for a task.
     *
     * For convenience we allow bare strings as input or output schemas, which is
     * equivalent to a text schema with the same description.
     */
    task_spec?: TaskSpec | null;
}

/**
 * Result of a task run.
 */
declare interface TaskRunResult {
    /**
     * Output from the task conforming to the output schema.
     */
    output: TaskRunResult.TaskRunTextOutput | TaskRunResult.TaskRunJsonOutput;
    /**
     * Status of a task run.
     */
    run: TaskRun;
}

declare namespace TaskRunResult {
    /**
     * Output from a task that returns text.
     */
    interface TaskRunTextOutput {
        /**
         * Basis for the output. The basis has a single field 'output'.
         */
        basis: Array<TaskRunTextOutput.Basis>;
        /**
         * Text output from the task.
         */
        content: string;
        /**
         * The type of output being returned, as determined by the output schema of the
         * task spec.
         */
        type?: 'text';
    }
    namespace TaskRunTextOutput {
        /**
         * Citations and reasoning supporting one field of a task output.
         */
        interface Basis {
            /**
             * Name of the output field.
             */
            field: string;
            /**
             * Reasoning for the output field.
             */
            reasoning: string;
            /**
             * List of citations supporting the output field.
             */
            citations?: Array<Basis.Citation>;
            /**
             * Confidence level for the output field. Only certain processors provide
             * confidence levels.
             */
            confidence?: string | null;
        }
        namespace Basis {
            /**
             * A citation for a task output.
             */
            interface Citation {
                /**
                 * URL of the citation.
                 */
                url: string;
                /**
                 * Excerpts from the citation supporting the output. Only certain processors
                 * provide excerpts.
                 */
                excerpts?: Array<string> | null;
                /**
                 * Title of the citation.
                 */
                title?: string | null;
            }
        }
    }
    /**
     * Output from a task that returns text.
     */
    interface TaskRunJsonOutput {
        /**
         * Basis for each top-level field in the JSON output.
         */
        basis: Array<TaskRunJsonOutput.Basis>;
        /**
         * Output from the task as a native JSON object, as determined by the output schema
         * of the task spec.
         */
        content: unknown;
        /**
         * The type of output being returned, as determined by the output schema of the
         * task spec.
         */
        type?: 'json';
    }
    namespace TaskRunJsonOutput {
        /**
         * Citations and reasoning supporting one field of a task output.
         */
        interface Basis {
            /**
             * Name of the output field.
             */
            field: string;
            /**
             * Reasoning for the output field.
             */
            reasoning: string;
            /**
             * List of citations supporting the output field.
             */
            citations?: Array<Basis.Citation>;
            /**
             * Confidence level for the output field. Only certain processors provide
             * confidence levels.
             */
            confidence?: string | null;
        }
        namespace Basis {
            /**
             * A citation for a task output.
             */
            interface Citation {
                /**
                 * URL of the citation.
                 */
                url: string;
                /**
                 * Excerpts from the citation supporting the output. Only certain processors
                 * provide excerpts.
                 */
                excerpts?: Array<string> | null;
                /**
                 * Title of the citation.
                 */
                title?: string | null;
            }
        }
    }
}

declare interface TaskRunResultParams {
    timeout?: number;
}

/**
 * Specification for a task.
 *
 * For convenience we allow bare strings as input or output schemas, which is
 * equivalent to a text schema with the same description.
 */
declare interface TaskSpec {
    /**
     * JSON schema or text fully describing the desired output from the task.
     * Descriptions of output fields will determine the form and content of the
     * response. A bare string is equivalent to a text schema with the same
     * description.
     */
    output_schema: JsonSchema | TextSchema | string;
    /**
     * Optional JSON schema or text description of expected input to the task. A bare
     * string is equivalent to a text schema with the same description.
     */
    input_schema?: JsonSchema | TextSchema | string | null;
}

/**
 * Text description for a task input or output.
 */
declare interface TextSchema {
    /**
     * A text description of the desired output from the task.
     */
    description: string;
    /**
     * The type of schema being defined. Always `text`.
     */
    type?: 'text';
}

/**
 * Helper for creating a {@link File} to pass to an SDK upload method from a variety of different data formats
 * @param value the raw content of the file.  Can be an {@link Uploadable}, {@link BlobLikePart}, or {@link AsyncIterable} of {@link BlobLikePart}s
 * @param {string=} name the name of the file. If omitted, toFile will try to determine a file name from bits if possible
 * @param {Object=} options additional properties
 * @param {string=} options.type the MIME type of the content
 * @param {number=} options.lastModified the last modified timestamp
 * @returns a {@link File} with the given properties
 */
export declare function toFile(value: ToFileInput | PromiseLike<ToFileInput>, name?: string | null | undefined, options?: FilePropertyBag | undefined): Promise<File>;

declare type ToFileInput = FileLike | ResponseLike | Exclude<BlobLikePart, string> | AsyncIterable<BlobLikePart>;

/** @ts-ignore For users with undici */
declare type UndiciRequestInit = NotAny<RequestInit_12> | NotAny<RequestInit_13> | NotAny<RequestInit_14> | NotAny<RequestInit_15> | NotAny<RequestInit_16> | NotAny<RequestInit_17> | NotAny<RequestInit_18> | NotAny<RequestInit_19> | NotAny<RequestInit_20> | NotAny<RequestInit_21>;

/**
 * These imports attempt to get types from a parent package's dependencies.
 * Unresolved bare specifiers can trigger [automatic type acquisition][1] in some projects, which
 * would cause typescript to show types not present at runtime. To avoid this, we import
 * directly from parent node_modules folders.
 *
 * We need to check multiple levels because we don't know what directory structure we'll be in.
 * For example, pnpm generates directories like this:
 * ```
 * node_modules
 * ├── .pnpm
 * │   └── pkg@1.0.0
 * │       └── node_modules
 * │           └── pkg
 * │               └── internal
 * │                   └── types.d.ts
 * ├── pkg -> .pnpm/pkg@1.0.0/node_modules/pkg
 * └── undici
 * ```
 *
 * [1]: https://www.typescriptlang.org/tsconfig/#typeAcquisition
 */
/** @ts-ignore For users with \@types/node */
declare type UndiciTypesRequestInit = NotAny<RequestInit_2> | NotAny<RequestInit_3> | NotAny<RequestInit_4> | NotAny<RequestInit_5> | NotAny<RequestInit_6> | NotAny<RequestInit_7> | NotAny<RequestInit_8> | NotAny<RequestInit_9> | NotAny<RequestInit_10> | NotAny<RequestInit_11>;

export declare class UnprocessableEntityError extends APIError<422, Headers> {
}

/**
 * Typically, this is a native "File" class.
 *
 * We provide the {@link toFile} utility to convert a variety of objects
 * into the File class.
 *
 * For convenience, you can also pass a fetch Response, or in Node,
 * the result of fs.createReadStream().
 */
export declare type Uploadable = File | Response | FsReadStream | BunFile;

declare namespace Uploads {
    export {
        Uploadable,
        toFile,
        ToFileInput
    }
}

export { }
