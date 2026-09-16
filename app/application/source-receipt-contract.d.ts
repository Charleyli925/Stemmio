import type { ProjectContext } from "./project-session.js";

export type DocumentSourceReceipt = Readonly<{
  sessionIncarnation: number;
  sequence: number;
  origin: "local-edit" | "history" | "authority";
  operationId: string;
  editRevision: number;
  canvasGeneration: number;
  sourceSha256: string;
  context: ProjectContext | null;
  epoch: number | null;
  projectId: string | null;
  documentId: string | null;
  sourcePath: string | null;
  sessionEpoch: number | null;
}>;

export type SourceReceiptInput = {
  sessionIncarnation?: unknown;
  sequence?: unknown;
  origin?: unknown;
  operationId?: unknown;
  editRevision?: unknown;
  canvasGeneration?: unknown;
  sourceSha256?: unknown;
  context?: unknown;
};

export function createSourceReceipt(
  value?: SourceReceiptInput,
): DocumentSourceReceipt;
export function isSourceReceipt(value: unknown): value is DocumentSourceReceipt;
export function sameSourceReceiptContext(left: unknown, right: unknown): boolean;
export function sameSourceReceipt(left: unknown, right: unknown): boolean;
