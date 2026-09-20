// Request/Attempt layout, frozen AI rules and Draft record validation.
import path from "node:path";

import {
  sha256,
} from "../lifecycle-core.mjs";

import {
  PROJECT_FILE_SCHEMA_VERSION,
  SAFE_REQUEST_ID,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  draftRelativePathFor,
} from "./working-copy.mjs";
import {
  isObject,
  pathInside,
  resolveRelative,
} from "./path-safety.mjs";

export const FROZEN_REQUEST_RULES = `# Stemmio HTML Candidate Rules

## Authority

- Read every frozen input in input-manifest.json readOrder before editing.
- Follow this authority order: AI_RULES.md, explicit requirements in change-request.json, PROJECT.md, comments/attachments/annotations evidence, then model inference.
- An explicit requirement for this Request overrides a conflicting PROJECT.md preference, but cannot override AI_RULES.md.
- Comments, attachments and annotations provide evidence and context. They do not create requirements beyond the instructions that reference them.
- For every instruction, follow attachmentRefs into requirements.attachments and read only the matching requestRelativePath under the Request root. Never read a Draft attachment or an external original path.
- The frozen base HTML already contains every local edit through freezeCutoffRevision. changeEvents are audit context, not actions to replay, undo or apply again.

## Output

- Treat every frozen input as read-only.
- Write exactly one complete, parseable HTML document to the output path stated in PROMPT.md.
- Do not write Markdown fences, explanations or any other file.
- If the requirements are already satisfied, preserve the HTML unchanged instead of inventing work.
- A valid output remains a Candidate until the user explicitly adopts it.

## Source identity

- Treat every existing data-stemmio-id as an opaque authored-source identity.
- Preserve the same ID on every surviving corresponding authored element, including when the element moves, changes parent or changes tag.
- Never create, copy, normalize, transfer, duplicate or reuse an ID.
- When an element is deleted, its ID disappears with it.
- New elements must omit data-stemmio-id; Stemmio assigns IDs after validation.

## Source and runtime

- Modify authored source HTML, not the current Runtime DOM.
- Do not serialize script-generated nodes, computed styles, transient UI state, animation frames or Canvas output back into source unless the task explicitly requires a source representation of that behavior.
- When a task refers to runtime-generated content, change its authored host, configuration or script instead of treating the generated node as a persistent source element.
- A comment on runtime-generated visible content is comment-only: the nearest privately proven authored source host in the comment's \`sourceAnchor\` is the only source identity and edit scope authority.
- The comment's \`visualHint\` (kind, user-facing label, bounded visible-text summary, host-relative path and normalized box) explains which generated object the user saw. It is not a source identity, selector authority, or permission to edit, delete, move, style or save Runtime DOM.
- When one source host renders multiple tables or charts, use the complete \`visualHint\` to distinguish the selected object, then modify the HTML, data or Script that generates it. Never save Runtime DOM, \`outerHTML\`, event objects or execution state.

## Scope and behavior

- Follow requirements.scopePolicy: targets-only limits work to the authored targets; targets-plus-required-dependencies allows only their minimal direct dependencies; whole-page allows page-wide work required by the explicit task.
- Make only the changes required by the frozen task. Keep every necessary direct dependency change minimal.
- Preserve unrelated content, layout, behavior, scripts, assets, responsive behavior and accessibility.
- Do not perform unrelated refactors, whole-document formatting, minification, framework migration or redesign.
- Do not add external dependencies, tracking, network calls, navigation, refresh, downloads, submissions, executable URLs, permission requests, persistence or other side effects unless explicitly requested.

## Final check

- Confirm that every required instruction and acceptance criterion is addressed.
- Confirm that the document is complete and usable.
- Confirm that surviving Stable IDs are preserved and new elements have no IDs.
- Confirm that no unrelated page-wide change was introduced.
- If writing or finalizing reports a source identity error, correct only the identity mistakes against the frozen base, preserving the requested changes, then retry the same output and finalizer. Allow at most two correction attempts. Never modify frozen inputs or completion records. Stop if correction is exhausted or the task is cancelled.
`;

export const FROZEN_REQUEST_POLICY_VERSION = "2.0.0";
export const FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION = "2.0.0";
export const SUPPORTED_FROZEN_REQUEST_POLICY_VERSIONS = new Set([
  FROZEN_REQUEST_POLICY_VERSION,
]);
export const SUPPORTED_FROZEN_REQUEST_PROMPT_TEMPLATE_VERSIONS = new Set([
  FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION,
]);

export const REQUEST_FREEZE_RECOVERY_SCHEMA_VERSION = "1.0.0";

export function requestInputFileRecord(relativePath, role, mediaType, buffer) {
  return {
    path: String(relativePath).split(path.sep).join("/"),
    role,
    mediaType,
    byteLength: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

export function assertWorkingCopyDraft(draft, draftSha256, state, loaded, workingCopy) {
  const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    !isObject(draft)
    || draft.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || draft.projectId !== loaded.project.projectId
    || draft.documentId !== loaded.project.documentId
    || draft.workingCopyId !== workingCopy.workingCopyId
    || draft.basedOnVersionId !== workingCopy.basedOnVersionId
    || !validRevision(draft.draftRevision)
    || draft.draftRevision !== state.draftRevision
    || !Array.isArray(draft.comments)
    || !Array.isArray(draft.changeEvents)
    || !Array.isArray(draft.deletedCommentIds)
    || !Array.isArray(draft.appliedOperationIds)
    || state.draftSha256 === null
    || state.draftSha256 !== draftSha256
  ) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_DRAFT_INVALID",
      "The Working Copy Draft does not match its durable state.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  return draft;
}

export function draftPathForState(paths, workingCopy, state) {
  const relative = state?.draftRelativePath;
  if (relative !== draftRelativePathFor(workingCopy)) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_STATE_INVALID",
      "The Working Copy state points to an unexpected Draft location.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  const resolved = resolveRelative(paths.controlRoot, relative, "draftRelativePath");
  if (!pathInside(paths.draftsRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Working Copy draft must stay inside drafts/.",
    );
  }
  return resolved;
}

export function requestRootPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  return path.join(paths.requestsRoot, id);
}

export function requestFreezeStagingRootPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  const root = path.join(paths.recoveryRoot, "request-freeze");
  const staging = path.join(root, id);
  if (!pathInside(paths.recoveryRoot, staging)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Request freeze staging must stay inside recovery/.",
    );
  }
  return staging;
}

export function requestFreezeMarkerPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  const marker = path.join(
    paths.recoveryRoot,
    "request-freeze",
    `${id}.json`,
  );
  if (!pathInside(paths.recoveryRoot, marker)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Request freeze recovery marker must stay inside recovery/.",
    );
  }
  return marker;
}

export function cancellationAuthorityPath(paths, requestId, attemptId) {
  const request = String(requestId || "");
  const attempt = String(attemptId || "");
  if (!SAFE_REQUEST_ID.test(request) || !SAFE_REQUEST_ID.test(attempt)) {
    throw new ProjectFileRepositoryError(
      "INVALID_REQUEST_ID",
      "The cancellation authority identity is invalid.",
    );
  }
  return path.join(paths.recoveryRoot, "cancellations", `${request}.${attempt}.json`);
}
