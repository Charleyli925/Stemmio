export type WorkbenchTabStatus = "normal" | "processing" | "review-ready" | "error" | "opening";
export type WorkbenchTab = Readonly<{
  tabId: string;
  kind: "start" | "settings" | "project-rules" | "document" | "history";
  title: string;
  status: WorkbenchTabStatus;
  projectId?: string;
  documentId?: string;
  versionId?: string;
  versionOrdinal?: number;
  versionLabel?: string;
  displayFileName?: string;
}>;
export type WorkbenchTabsSnapshot = Readonly<{
  revision: number;
  tabs: readonly WorkbenchTab[];
  activeTabId: string;
  pendingTabId: string | null;
  mountedDocumentTabId: string | null;
  runtimeOwnerTabId: string | null;
}>;
export const INITIAL_WORKBENCH_TABS_SNAPSHOT: WorkbenchTabsSnapshot;
export class WorkbenchTabsSession {
  readonly snapshot: WorkbenchTabsSnapshot;
  captureAuthority(): unknown;
  restoreAuthority(authority: unknown): WorkbenchTabsSnapshot | null;
  subscribe(listener: (snapshot: WorkbenchTabsSnapshot) => void): () => void;
  hydrate(value: unknown): WorkbenchTabsSnapshot;
  createStart(input?: { focus?: boolean }): WorkbenchTabsSnapshot | null;
  createSettings(input?: { focus?: boolean }): WorkbenchTabsSnapshot | null;
  createProjectRules(input: {
    projectId: string;
    documentId: string;
    title: string;
    focus?: boolean;
  }): WorkbenchTabsSnapshot | null;
  createHistory(input: {
    projectId: string;
    documentId: string;
    title: string;
    versionId: string;
    versionOrdinal: number;
    versionLabel?: string;
    displayFileName?: string;
    focus?: boolean;
  }): WorkbenchTabsSnapshot | null;
  bindDocument(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
    focus?: boolean;
  }): WorkbenchTabsSnapshot | null;
  stageDocument(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
  }): WorkbenchTab | null;
  resolveTab(tabId: string): WorkbenchTab | null;
  discardUnstartedDocument(tabId: string): boolean;
  beginSwitch(tabId: string, input?: { force?: boolean }): WorkbenchTabsSnapshot | null;
  commitStart(tabId: string): WorkbenchTabsSnapshot | null;
  commitSettings(tabId: string): WorkbenchTabsSnapshot | null;
  commitProjectRules(tabId: string): WorkbenchTabsSnapshot | null;
  commitHistory(tabId: string): WorkbenchTabsSnapshot | null;
  commitDocument(input: { tabId: string; projectId: string; documentId: string; title: string }): WorkbenchTabsSnapshot | null;
  cancelSwitch(tabId: string): WorkbenchTabsSnapshot;
  updateStatus(projectId: string, documentId: string, status: WorkbenchTabStatus): WorkbenchTabsSnapshot;
  updateTitle(projectId: string, documentId: string, title: string): WorkbenchTabsSnapshot;
  reconcileRegisteredProjects(projects: readonly unknown[]): Readonly<{
    snapshot: WorkbenchTabsSnapshot;
    missing: readonly WorkbenchTab[];
  }>;
  close(tabId: string): Readonly<{ snapshot: WorkbenchTabsSnapshot; nextTabId: string | null }>;
  serialize(): Readonly<Record<string, unknown>>;
}
export function projectAppliedEventToWorkbenchTabs(input: {
  session: WorkbenchTabsSession;
  event: Readonly<{
    type: "project-applied";
    project: Readonly<{
      projectId?: string;
      documentId?: string;
      name?: string;
    }>;
    activeLocked?: boolean;
  }>;
  title?: string;
}): WorkbenchTabsSnapshot | null;
export function reconcileWorkbenchTabsWhenReady(input: {
  session: WorkbenchTabsSession;
  tabsPersistenceReady: boolean;
  registeredProjectsReady: boolean;
  registeredProjects: readonly unknown[];
}): ReturnType<WorkbenchTabsSession["reconcileRegisteredProjects"]> | null;
