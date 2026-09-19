export type ProjectOpenWorkspaceEnvelope = Readonly<{
  operationId: string;
  snapshotRevision: string | null;
  core: Readonly<Record<string, unknown>>;
  supplemental: Readonly<Record<string, unknown>>;
  performanceTiming: Readonly<Record<string, unknown>> | null;
}>;

export function normalizeProjectOpenWorkspaceEnvelope(
  payload: unknown,
  operationId: string,
): ProjectOpenWorkspaceEnvelope;

export function acquireProjectOpenWorkspace(input: Readonly<{
  bridgeClient: Readonly<Record<string, unknown>>;
  sourcePath: string;
  operationId: string;
  isCurrent(): boolean;
}>): Promise<Readonly<{
  kind: "stale";
}> | Readonly<{
  kind: "ready";
  envelope: ProjectOpenWorkspaceEnvelope;
}>>;

export function verifyProjectOpenCoreSource(input: Readonly<{
  core: Readonly<Record<string, unknown>>;
  hashPort: Readonly<{ sha256(content: string): Promise<string> }>;
  expectedSourceSha256?: string;
}>): Promise<Readonly<{
  content: string;
  sourceSha256: string;
  lastModifiedAt: string;
}>>;

export function resolveProjectOpenSource(input: Readonly<{
  core: Readonly<Record<string, unknown>>;
  hashPort: Readonly<{ sha256(content: string): Promise<string> }>;
  expectedSourceSha256?: string;
  markStage?(stage: string): void;
}>): Promise<Readonly<{
  stale?: boolean;
  content?: string;
  sourceSha256?: string;
  lastModifiedAt?: string;
}>>;

export function prepareProjectOpenCore(input: Readonly<Record<string, unknown>>): Readonly<{
  projectId: string;
  documentId: string;
  canonicalSourcePath: string;
  sourceSha256: string;
  openTarget: Readonly<Record<string, unknown>> | null;
}>;

export function inspectProjectOpenProjection(
  input: Readonly<Record<string, unknown>>,
): Promise<Readonly<{ clean: boolean; cleanMismatch: boolean }>>;
