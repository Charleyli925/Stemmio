import {
  createDocumentSourceOperationResult,
  type DocumentSourceOperationResult,
} from "../app/application/document-source-operation-contract.js";
import type { DocumentSourceReceipt } from "../app/application/source-receipt-contract.js";

declare const receipt: DocumentSourceReceipt;

const productionShapedStub: DocumentSourceOperationResult =
  createDocumentSourceOperationResult({
    operationId: "source-operation-contract",
    operation: "repair-current-canvas",
    permissionStatus: "not-required",
    sourceStatus: "unchanged",
    receipt,
    html: "<!doctype html><html><body></body></html>",
    sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    pageStatus: "repair-required",
    reason: "canvas pending",
  });

void productionShapedStub;

createDocumentSourceOperationResult({
  operationId: "invalid-source-operation-contract",
  operation: "reload-from-disk",
  permissionStatus: "accepted",
  sourceStatus: "accepted",
  receipt,
  html: "<!doctype html><html><body></body></html>",
  sourceSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  // @ts-expect-error Production cannot publish a generic failed page branch.
  pageStatus: "failed",
});
