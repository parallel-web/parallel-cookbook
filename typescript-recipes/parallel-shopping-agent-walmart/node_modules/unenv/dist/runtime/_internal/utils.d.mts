import type { HeadersObject } from "./types.mjs";
/*@__NO_SIDE_EFFECTS__*/ export declare function rawHeaders(headers: HeadersObject);
type Fn = (...args: any[]) => any;
/*@__NO_SIDE_EFFECTS__*/ export declare function mergeFns(...functions: Fn[]): unknown;
/*@__NO_SIDE_EFFECTS__*/ export declare function createNotImplementedError(name: string);
/*@__NO_SIDE_EFFECTS__*/ export declare function notImplemented<Fn extends (...args: any) => any>(name: string): Fn;
export interface Promisifiable {
	(): any;
	native: Promisifiable;
	__promisify__: () => Promise<any>;
}
/*@__NO_SIDE_EFFECTS__*/ export declare function notImplementedAsync(name: string): Promisifiable;
/*@__NO_SIDE_EFFECTS__*/ export declare function notImplementedClass<T = unknown>(name: string): T;
export {};
