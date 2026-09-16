import {
  DocumentSession,
  isSourceReceipt,
  type DocumentSourceReceipt,
} from "../app/application/document-session.js";

declare const candidate: unknown;
declare const receipt: DocumentSourceReceipt;
declare const session: DocumentSession;

if (isSourceReceipt(candidate)) {
  const sequence: number = candidate.sequence;
  void sequence;
  // @ts-expect-error The runtime guard must not invent undeclared receipt fields.
  const missingReceiptField = candidate.missingReceiptField;
  void missingReceiptField;
}

session.confirmCanvas({
  // @ts-expect-error Canvas generation is a numeric identity, never a string projection.
  generation: "1",
  renderedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  receipt,
});

// @ts-expect-error Published receipts are immutable authority evidence.
receipt.sequence = 2;
