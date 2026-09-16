import type { DocumentSession } from "./document-session.js";
import type { DocumentWorkflow, DocumentWorkflowOutcome } from "./document-workflow.js";
import type { ProjectSession } from "./project-session.js";
import type { VersionSession } from "./version-session.js";

export type BrowserOpenRequest = Readonly<{
  targetKind: "working-copy";
  sourcePath: string;
  expectedSha256: string;
}> | Readonly<{
  targetKind: "version";
  sourcePath: string;
  versionId: string;
  expectedSha256: string;
}>;

export type BrowserOpenResult = Readonly<{
  operationId: string;
  target: BrowserOpenRequest;
  opened: unknown;
}>;

export class BrowserOpenWorkflow {
  constructor(options: Readonly<{
    projectSession: ProjectSession;
    documentSession: DocumentSession;
    versionSession: VersionSession;
    documentWorkflow: Pick<DocumentWorkflow, "enqueueEdit" | "flush" | "hasHistoryAction">;
    ports: Readonly<{
      canvas: Readonly<{
        checkpointSource(input?: Readonly<{ trigger?: string }>): Readonly<{
          ok: boolean;
          html: string;
          pendingMutation?: unknown;
          reason?: string;
        }> | undefined;
      }>;
      files: Readonly<{
        openInDefaultBrowser(input: BrowserOpenRequest): Promise<unknown>;
      }>;
    }>;
    errorMessage?: (cause: unknown, fallback: string) => string;
    clock?: Readonly<{ now(): number }>;
  }>);
  dispose(): void;
  openSelectedDocument(): Promise<DocumentWorkflowOutcome<BrowserOpenResult>>;
}
