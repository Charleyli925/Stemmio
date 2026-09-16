export type DocumentSurfaceCacheEntry = Readonly<{
  tabId: string;
  projectId: string;
  documentId: string;
  sourcePath: string;
  sourceSha256: string;
  html: string;
  canvasMode: "edit" | "preview";
  pageViewContext: Readonly<Record<string, unknown>> | null;
  scrollTop: number;
  byteLength: number;
  tier: "hot" | "warm";
}>;

export type DocumentSurfaceCacheSnapshot = Readonly<{
  revision: number;
  entries: readonly DocumentSurfaceCacheEntry[];
  hotTabIds: readonly string[];
  warmTabIds: readonly string[];
  coldTabIds: readonly string[];
  totalBytes: number;
  limits: Readonly<{
    maxHotEntries: number;
    maxEntries: number;
    maxBytes: number;
  }>;
}>;

export const INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT: DocumentSurfaceCacheSnapshot;

export type DocumentSurfaceCacheToken = Readonly<{
  tabId: string;
  sourceSha256: string;
}>;

export function documentSurfaceCacheToken(
  value: Readonly<{ tabId?: unknown; sourceSha256?: unknown }> | null | undefined,
): DocumentSurfaceCacheToken | null;
export function sameDocumentSurfaceCacheToken(
  left: DocumentSurfaceCacheToken | null | undefined,
  right: DocumentSurfaceCacheToken | null | undefined,
): boolean;
export function documentSurfaceCacheEntryMatchesToken(
  entry: DocumentSurfaceCacheEntry | null | undefined,
  token: DocumentSurfaceCacheToken | null | undefined,
): boolean;

export class DocumentSurfaceCacheSession {
  constructor(input?: { maxHotEntries?: number; maxWarmEntries?: number; maxBytes?: number });
  readonly snapshot: DocumentSurfaceCacheSnapshot;
  subscribe(listener: (snapshot: DocumentSurfaceCacheSnapshot) => void): () => void;
  capture(input?: Record<string, unknown>): DocumentSurfaceCacheEntry | null;
  touch(tabId: string): DocumentSurfaceCacheEntry | null;
  updatePresentation(tabId: string, presentation?: Readonly<Record<string, unknown>>): DocumentSurfaceCacheEntry | null;
  remove(tabId: string): boolean;
  reconcile(tabIds: readonly string[]): DocumentSurfaceCacheSnapshot;
  clear(): void;
  dispose(): void;
}
