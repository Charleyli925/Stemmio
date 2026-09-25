export const EDITOR_STYLE_ATTRIBUTE: string;
export const FRAME_VERIFICATION_ATTRIBUTE: string;
export const EDIT_RUNTIME_CSP: string;

export type RuntimeCandidateInertOwnership = {
  injected: boolean;
};

export function disableExecutableMarkup(source: string): string;
export function sanitizePreviewDocument(
  source: string,
  baseUrl?: string,
): string;
export function prepareVerifiedFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    baseUrl?: string;
    editorStyles?: string;
    candidateInert?: boolean;
    candidateInertOwnership?: RuntimeCandidateInertOwnership;
  },
): string;
export function prepareDisposableRuntimeFrameDocument(
  source: string,
  verificationToken: string,
  options: {
    sessionId: string;
    executionId: string;
    documentBasePath?: string;
    baseUrl?: string;
    editorStyles?: string;
    candidateInertOwnership?: RuntimeCandidateInertOwnership;
  },
): string | null;
export function prepareCanvasFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    mode?: "static";
    baseUrl?: string;
    editorStyles?: string;
    candidateInert?: boolean;
    candidateInertOwnership?: RuntimeCandidateInertOwnership;
  } | {
    mode: "disposable-runtime";
    sessionId: string;
    executionId: string;
    documentBasePath?: string;
    baseUrl?: string;
    editorStyles?: string;
    candidateInertOwnership?: RuntimeCandidateInertOwnership;
  },
): string | null;
export function baseHrefFromSourcePath(
  sourcePath?: string,
): string | undefined;
