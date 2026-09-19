import type { ProjectSurfaceContext } from "./project-surface-context.js";

export type ProjectRulesContext = Readonly<{
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
}> | ProjectSurfaceContext;

export type ProjectRulesSnapshot = Readonly<{
  open: boolean;
  path: "PROJECT.md";
  content: string;
  savedContent: string;
  loading: boolean;
  error: string;
  saving: boolean;
  saveError: string;
  compositionActive: boolean;
  editorGeneration: number;
}>;

export type ProjectRulesOperation = Readonly<{
  context: ProjectRulesContext;
  generation: number;
  content?: string;
}>;

export class ProjectRulesSession {
  subscribe(listener: (snapshot: ProjectRulesSnapshot) => void): () => void;
  beginOpen(context: ProjectRulesContext): ProjectRulesOperation | null;
  commitOpen(
    context: ProjectRulesContext,
    payload: { content?: unknown } | null | undefined,
  ): boolean;
  completeOpen(
    token: ProjectRulesOperation,
    payload: { content?: unknown } | null | undefined,
  ): boolean;
  failOpen(token: ProjectRulesOperation, error: string): boolean;
  close(): void;
  matchesContext(context: ProjectRulesContext): boolean;
  isCurrent(token: ProjectRulesOperation | null | undefined): boolean;
  updateContent(content: string): boolean;
  beginComposition(target: unknown, baselineValue: string): number | null;
  finishComposition(target: unknown): boolean;
  leaveEditor(): boolean;
  restore(): Readonly<{
    compositionEpoch: number | null;
    editorGeneration: number;
  }> | null;
  settleRestore(compositionEpoch: number | null): boolean;
  beginSave(): ProjectRulesOperation | null;
  completeSave(token: ProjectRulesOperation): boolean;
  failSave(token: ProjectRulesOperation, error: string): boolean;
  abandonSave(token: ProjectRulesOperation): boolean;
  readonly compositionActive: boolean;
  readonly context: ProjectRulesContext | null;
  inspect(options?: { locked?: boolean }):
    | { state: "resolved" }
    | { state: "pending" | "blocked"; reason: string };
  readonly snapshot: ProjectRulesSnapshot;
}
