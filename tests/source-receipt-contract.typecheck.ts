import {
  DocumentSession,
  isSourceReceipt,
  type DocumentCanvasAuthority,
  type DocumentSourceReceipt,
  type DocumentWriteConfirmation,
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

const canvasAuthority = session.canvasAuthority;
if (canvasAuthority.status === "verified") {
  const renderedSha256: string = canvasAuthority.renderedSha256;
  const error: null = canvasAuthority.error;
  void renderedSha256;
  void error;
} else if (canvasAuthority.status === "failed") {
  const renderedSha256: null = canvasAuthority.renderedSha256;
  const error: string = canvasAuthority.error;
  void renderedSha256;
  void error;
} else {
  const renderedSha256: null = canvasAuthority.renderedSha256;
  const error: null = canvasAuthority.error;
  void renderedSha256;
  void error;
}

// @ts-expect-error Canvas authority is immutable evidence.
canvasAuthority.status = "pending";

const previewEdit = session.acceptEdit({ html: "<main>preview</main>", write: null });
if (previewEdit.accepted) {
  const revision: number = previewEdit.revision;
  void revision;
}

// @ts-expect-error Rejected confirmation cannot claim current-document completion.
const impossibleRejectedConfirmation: DocumentWriteConfirmation = {
  accepted: false,
  completesCurrentDocument: true,
  authorityChanged: false,
};
void impossibleRejectedConfirmation;

// @ts-expect-error Verified Canvas authority always carries a rendered Hash.
const verifiedWithoutHash: DocumentCanvasAuthority = {
  status: "verified",
  generation: 1,
  renderedSha256: null,
  error: null,
};
void verifiedWithoutHash;
