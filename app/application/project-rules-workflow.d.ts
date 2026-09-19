import type {
  ProjectRulesContext,
  ProjectRulesSession,
  ProjectRulesSnapshot,
} from "./project-rules-session.js";
import type { ProjectSession } from "./project-session.js";
import type { RunSession } from "./run-session.js";

export type ProjectRulesWorkflowOutcome<T = Record<string, unknown>> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{
      status: "stale";
      identity: Readonly<{
        epoch: number;
        projectId: string;
        documentId: string;
        sourcePath: string;
      }>;
    }>;

export type ProjectRulesScheduler = Readonly<{
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type ProjectRulesWorkflowConstruction = Readonly<{
  bridgeClient: {
    projectFile(
      sourcePath: string,
      relativePath: string,
    ): Promise<{ content?: unknown }>;
    updateProjectFile(input: {
      sourcePath: string;
      projectId: string;
      documentId: string;
      content: string;
    }): Promise<unknown>;
  };
  projectSession: ProjectSession;
  runSession: RunSession;
  projectRulesSession: ProjectRulesSession;
  errorMessage?: (cause: unknown, fallback: string) => string;
  scheduler?: ProjectRulesScheduler;
  clock: Readonly<{ now(): number }>;
}>;

export class ProjectRulesWorkflow {
  constructor(options: ProjectRulesWorkflowConstruction);
  getSnapshot(): ProjectRulesSnapshot;
  subscribe(listener: (snapshot: ProjectRulesSnapshot) => void): () => void;
  open(input: {
    context: ProjectRulesContext;
  }): Promise<ProjectRulesWorkflowOutcome<{
    opened: boolean;
    reused?: boolean;
  }>>;
  retry(): Promise<ProjectRulesWorkflowOutcome<{
    opened: boolean;
    reused?: boolean;
  }>>;
  updateContent(input: { content: string }): ProjectRulesWorkflowOutcome<{
    updated: boolean;
  }>;
  beginComposition(input: {
    target: unknown;
    baselineValue: string;
  }): number | null;
  finishComposition(input: { target: unknown }): boolean;
  leaveEditor(): boolean;
  restore(): ProjectRulesWorkflowOutcome<{
    restored: boolean;
    editorGeneration: number;
  }>;
  save(): Promise<ProjectRulesWorkflowOutcome<{
    saved: boolean;
    reconciled?: boolean;
  }>>;
  close(): Promise<ProjectRulesWorkflowOutcome<{ closed: boolean }>>;
  resetForProjectTransition(): void;
  inspect():
    | { state: "resolved" }
    | { state: "pending" | "blocked"; reason: string };
  drain(): Promise<boolean>;
  dispose(): void;
}
