import type { DocumentSourceReceipt } from "./source-receipt-contract.js";

export type DocumentSourceOperationKind =
  | "reload-from-disk"
  | "repair-current-canvas"
  | "accept-shown-external-preview"
  | "accept-external-conflict";

export type DocumentSourceOperationResult = Readonly<{
  operationId: string;
  operation: DocumentSourceOperationKind;
  permission: Readonly<{ status: "not-required" | "accepted" }>;
  source: Readonly<{
    status: "unchanged" | "accepted";
    receipt: DocumentSourceReceipt | null;
    html: string;
    sourceSha256: string;
    lastModifiedAt?: string;
  }>;
  page: Readonly<{
    status: "restored" | "repair-required" | "not-current";
    reason?: string;
    reusedCanvasAuthority?: boolean;
  }>;
}>;

export type DocumentSourceOperationResultInput = Readonly<{
  operationId: string;
  operation: DocumentSourceOperationKind;
  permissionStatus: "not-required" | "accepted";
  sourceStatus: "unchanged" | "accepted";
  receipt: DocumentSourceReceipt | null;
  html: string;
  sourceSha256: string;
  lastModifiedAt?: string;
  pageStatus: "restored" | "repair-required" | "not-current";
  reason?: string;
  reusedCanvasAuthority?: boolean;
}>;

export function createDocumentSourceOperationResult(
  input: DocumentSourceOperationResultInput,
): DocumentSourceOperationResult;
