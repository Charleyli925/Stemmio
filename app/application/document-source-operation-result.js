/** @typedef {import("./document-source-operation-contract.js").DocumentSourceOperationResult} DocumentSourceOperationResult */
/** @typedef {import("./document-source-operation-contract.js").DocumentSourceOperationResultInput} DocumentSourceOperationResultInput */

/**
 * The checked production constructor for every successful Document source
 * operation. Keeping this small avoids widening checkJs to orchestration code
 * while making the public result union executable and compiler-owned.
 *
 * @param {DocumentSourceOperationResultInput} input
 * @returns {DocumentSourceOperationResult}
 */
export function createDocumentSourceOperationResult(input) {
  return Object.freeze({
    operationId: input.operationId,
    operation: input.operation,
    permission: Object.freeze({ status: input.permissionStatus }),
    source: Object.freeze({
      status: input.sourceStatus,
      receipt: input.receipt,
      html: input.html,
      sourceSha256: input.sourceSha256,
      ...(input.lastModifiedAt ? { lastModifiedAt: input.lastModifiedAt } : {}),
    }),
    page: Object.freeze({
      status: input.pageStatus,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.reusedCanvasAuthority !== undefined
        ? { reusedCanvasAuthority: input.reusedCanvasAuthority }
        : {}),
    }),
  });
}
