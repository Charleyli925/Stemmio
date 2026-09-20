import type { OpenTarget } from "./project-session.js";

export type ProjectSurfaceContext = Readonly<OpenTarget & {
  surfaceContextId: string;
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
  sourceSha256: string;
}>;

export function isProjectSurfaceContext(value: unknown): value is ProjectSurfaceContext;
export function copyProjectSurfaceContext(value: unknown): ProjectSurfaceContext | null;
export function createProjectSurfaceContext(input: {
  transactionId?: string | null;
  project: unknown;
}): ProjectSurfaceContext | null;
export function sameProjectSurfaceContext(left: unknown, right: unknown): boolean;
