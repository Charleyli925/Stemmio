/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-unused-vars -- The runtime facade intentionally merges its constructor declaration with the shared instance contract. */

import type {
  DocumentSourceReceipt,
  DocumentSessionInstance,
  DocumentSessionOptions,
  DocumentWrite,
} from "./document-session-contract.js";

export type * from "./document-session-contract.js";

export function isSourceReceipt(value: unknown): value is DocumentSourceReceipt;
export function sameSourceReceiptContext(left: unknown, right: unknown): boolean;
export function sameSourceReceipt(left: unknown, right: unknown): boolean;

export declare class DocumentSession<
  TWrite extends DocumentWrite = DocumentWrite,
  TFlushResult = unknown,
> {
  constructor(options?: DocumentSessionOptions);
}

export interface DocumentSession<
  TWrite extends DocumentWrite = DocumentWrite,
  TFlushResult = unknown,
> extends DocumentSessionInstance<TWrite, TFlushResult> {}
