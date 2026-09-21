import type { DocumentSourceReceipt } from "./document-session.js";

export type WorkbenchNavigationPhase =
  | "idle"
  | "admitted"
  | "preparing"
  | "awaiting-user"
  | "opening"
  | "applied"
  | "display-ready"
  | "hydrating"
  | "canvas-verified"
  | "committed";
export type WorkbenchNavigationReceipt = Readonly<{
  transactionId: string;
  applicationId: string | null;
  projectId: string | null;
  documentId: string | null;
  epoch: number;
  tabId: string | null;
  kind: string;
  sourceReceipt?: DocumentSourceReceipt | null;
}>;
export type WorkbenchNavigationSnapshot = Readonly<{
  revision: number;
  admissionOrdinal: number;
  phase: WorkbenchNavigationPhase;
  transactionId: string | null;
  intent: Readonly<Record<string, unknown>> | null;
  receipt: WorkbenchNavigationReceipt | null;
  lastReceipt: WorkbenchNavigationReceipt | null;
  error: Readonly<{ code: string; reason: string }> | null;
}>;
export const INITIAL_WORKBENCH_NAVIGATION_SNAPSHOT: WorkbenchNavigationSnapshot;
export class WorkbenchNavigationSession {
  readonly snapshot: WorkbenchNavigationSnapshot;
  subscribe(listener: (snapshot: WorkbenchNavigationSnapshot) => void): () => void;
  admit(input: { transactionId: string; intent: Readonly<Record<string, unknown>>; admissionOrdinal: number }): WorkbenchNavigationSnapshot | null;
  transition(transactionId: string, phase: WorkbenchNavigationPhase, patch?: Readonly<Record<string, unknown>>): WorkbenchNavigationSnapshot | null;
  applied(transactionId: string, receipt: WorkbenchNavigationReceipt): WorkbenchNavigationSnapshot | null;
  finish(transactionId: string, input?: { receipt?: WorkbenchNavigationReceipt | null; error?: Readonly<{ code: string; reason: string }> | null }): WorkbenchNavigationSnapshot | null;
  dispose(): void;
}
