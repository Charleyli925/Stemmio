import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(productRoot, relativePath), "utf8");
}

const CURRENT_CONTRACT_ROOTS = [
  "app/",
  "bridge/",
  "desktop/",
  "shared/",
  "worker/",
  "scripts/",
  "schemas/",
  ".github/workflows/",
  ".github/actions/",
  ".github/ISSUE_TEMPLATE/",
  ".codex/",
  ".agents/",
  ".qoder/",
  "docs/",
];

const CURRENT_CONTRACT_ROOT_FILES = new Set([
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "README.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
  "TRADEMARKS.md",
  "docs/decisions/0074-proven-in-place-structural-editing.md",
]);

// These are surgical exceptions for current production modules and current
// project guidance. Each expression names the one persisted, semantic or
// historical token that must remain readable; a new retired identifier in the
// same file must still fail the scanner below.
const SURGICAL_CONTENT_EXCEPTIONS = Object.freeze({
  "shared/conversation.mjs": [
    // The v3 decoder documents the intentionally unsupported historical actor.
    /historical PageRoot actor contract/gu,
  ],
  "shared/editable-island.mjs": [
    // Authored v1 source markers remain byte-preserved while runtime markers are Stemmio-owned.
    /data-html-ai-source-node-id/gu,
  ],
  "bridge/lifecycle-core.mjs": [
    // The finalizer strips only these five historical HTML metadata names.
    /html-ai-(?:document-id|version-id|version-label|based-on-version-id|request-id)/gu,
  ],
  "app/lib/source-index.js": [
    // SourceIndex still recognizes the legacy authored marker without exposing it as identity.
    /data-html-ai-source-node-id/gu,
  ],
  "app/components/IslandEditingController.ts": [
    // The editor removes the same legacy authored marker during source cleanup.
    /data-html-ai-source-node-id/gu,
  ],
  "app/components/HtmlCanvasEditor.tsx": [
    // Page-root is a semantic HTML selection term, not the product identity.
    /isPageRoot(?:Element|Selection)?/gu,
  ],
  "app/components/html-canvas-comment-layout.ts": [
    // Page-root is a semantic HTML selection term, not the product identity.
    /isPageRoot(?:Element|Selection)?/gu,
  ],
  "app/components/html-canvas-pointer-capability.ts": [
    // Page-root is a semantic HTML selection term, not the product identity.
    /isPageRoot(?:Element|Selection)?/gu,
  ],
  "app/components/html-canvas-selection-chrome.tsx": [
    // Page-root is a semantic HTML selection term, not the product identity.
    /isPageRoot(?:Element|Selection)?/gu,
  ],
  "app/components/html-canvas-selection.ts": [
    // Page-root is a semantic HTML selection term, not the product identity.
    /isPageRoot(?:Element|Selection)?/gu,
  ],
  "scripts/notice-policy.mjs": [
    // Notice fingerprints intentionally normalize the historical product label.
    /const PRODUCT_BRAND_TOKEN = \/\(\?:PageRoot\|Stemmio\|源页\)\/gu;/gu,
  ],
  "scripts/developer-preview.mjs": [
    // Existing annotated release tags retain their immutable pre-cutover message.
    /PageRoot \$\{version\}/gu,
  ],
  "scripts/capability-context.json": [
    // Capability routing keeps the historical ADR filename as a stable reference.
    /docs\/decisions\/0069-pageroot-native-openai-compatible-agent\.md/gu,
  ],
  ".github/workflows/release.yml": [
    // Only the fixed one-time legacy updater bridge retains the former repository name.
    /Charleyli925\/PageRoot/gu,
  ],
  "docs/PRIVATE_SOURCE_BOUNDARY.md": [
    // The former repository name is only the one-time updater bridge for signed older clients.
    /Charleyli925\/PageRoot/gu,
  ],
  "docs/PRIVATE_SOURCE_CUTOVER.md": [
    // The cutover must name the bridge it verifies without reintroducing a source endpoint.
    /Charleyli925\/PageRoot/gu,
  ],
  "docs/RELEASING.md": [
    // Publication guidance names the bridge only for the one transition version.
    /Charleyli925\/PageRoot/gu,
  ],
  "docs/RELEASE_PIPELINE_GOVERNANCE.md": [
    // The release credential is scoped to the fixed temporary bridge as well as the public channel.
    /Charleyli925\/PageRoot/gu,
  ],
  "AGENTS.md": [],
  "TRADEMARKS.md": [
    // The former brand is named once to identify historical builds only.
    /former PageRoot name/gu,
  ],
});

// These exact files are immutable legal, compatibility, historical or
// negative-evidence records. They are intentionally not treated as current
// product contracts, but their paths still participate in the path scan below.
const LEGACY_CONTENT_PATHS = new Set([
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "design-qa.md",
  "desktop/resources/开发者测试版说明.txt",
  "docs/ARCHITECTURE_CONTRACT.md",
  "docs/CHANGE_REQUEST_PROTOCOL.md",
  "docs/COMPATIBILITY.md",
  "docs/DESIGN_DECISIONS.md",
  "docs/DEVELOPER_PREVIEW_PLAYBOOK.md",
  "docs/IMPORT_CONFIRMATION_PLAN.md",
  "docs/MVP_PRD.md",
  "docs/NOTIFICATION_AND_STARTUP_POLICY.md",
  "docs/PERSISTENCE_PERFORMANCE_12_PR1.md",
  "docs/POST_MVP_CLEANUP_PROGRAM.md",
  "docs/PRODUCT_DESIGN_SYSTEM.md",
  "docs/STEMMIO_RENAME_PLAN.md",
  "docs/STEMMIO_TRUSTED_LOOP_QA.md",
  "docs/VERSION_TREE_HOVER_PRD.md",
  "docs/WORKBENCH_ORCHESTRATION_REFACTOR_PLAN.md",
  "examples/change-request.insert-section.example.json",
  "schemas/scope-report.v1.schema.json",
  "tests/stemmio-rename-contract.test.mjs",
]);

const LEGACY_PATH_EXCEPTIONS = new Set([
  "docs/decisions/0069-pageroot-native-openai-compatible-agent.md",
  "docs/PERSISTENCE_PERFORMANCE_12_PR1.md",
]);

const RETIRED_PRODUCT_IDENTIFIERS = /(?:PageRoot|pageroot|PAGEROOT|HTML AI|HTML_AI|pr1_|htmlAI|com\.htmlai\.workbench|pageroot\.local|html-change\.local|html-app:|x-html-ai-bridge-token)/u;
const CURRENT_SOURCE_REPOSITORY_URL = "https://github.com/Charleyli925/Stemmio";
const PUBLIC_RELEASES_REPOSITORY_URL =
  "https://github.com/Charleyli925/Stemmio-Releases";
const LEGACY_UPDATE_BRIDGE_REPOSITORY = "Charleyli925/PageRoot";

function removeContractExceptions(contents, relativePath = "") {
  let normalized = String(contents);

  for (const pattern of SURGICAL_CONTENT_EXCEPTIONS[relativePath] || []) {
    normalized = normalized.replace(pattern, "");
  }
  return normalized;
}

function trackedPaths() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: productRoot })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function currentContractPaths() {
  return trackedPaths().filter((relativePath) => (
    existsSync(path.join(productRoot, relativePath))
    && (
    CURRENT_CONTRACT_ROOT_FILES.has(relativePath)
    || CURRENT_CONTRACT_ROOTS.some((prefix) => relativePath.startsWith(prefix))
    )
  ));
}

function isLegacyContentPath(relativePath) {
  if (CURRENT_CONTRACT_ROOT_FILES.has(relativePath)) return false;
  return LEGACY_CONTENT_PATHS.has(relativePath)
    || relativePath.startsWith("docs/decisions/");
}

test("current Stemmio contracts have no unexplained retired product identifiers", async () => {
  const paths = currentContractPaths();
  const retiredPath = /(?:PageRoot|pageroot|page-root|PAGEROOT|HTML AI|HTML_AI|pr1_|html-ai|html_ai|htmlai|html-change)/u;
  for (const relativePath of trackedPaths()) {
    if (retiredPath.test(relativePath) && !LEGACY_PATH_EXCEPTIONS.has(relativePath)) {
      assert.fail(`${relativePath} retains a retired product identifier in its path`);
    }
  }
  const entries = await Promise.all(paths
    .filter((relativePath) => !isLegacyContentPath(relativePath))
    .map(async (relativePath) => ({
    relativePath,
    contents: removeContractExceptions(await source(relativePath), relativePath),
  })));
  for (const { relativePath, contents } of entries) {
    assert.doesNotMatch(
      contents,
      RETIRED_PRODUCT_IDENTIFIERS,
      `${relativePath} contains an unexplained retired product identifier`,
    );
  }
});

test("private source provenance stays separate from public distribution endpoints", async () => {
  const [packageText, desktopLinks, workbench, provenance, candidate, checkpoint, issueTemplate, ciIncidentTemplate, readme] = await Promise.all([
    source("package.json"),
    source("desktop/product-links.mjs"),
    source("app/workbench.tsx"),
    source("scripts/release-provenance.mjs"),
    source("scripts/release-candidate-provenance.mjs"),
    source("scripts/release-app-checkpoint.mjs"),
    source(".github/ISSUE_TEMPLATE/config.yml"),
    source(".github/ISSUE_TEMPLATE/ci_incident.yml"),
    source("README.md"),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.homepage, `${PUBLIC_RELEASES_REPOSITORY_URL}#readme`);
  assert.equal(packageJson.repository.url, `git+${CURRENT_SOURCE_REPOSITORY_URL}.git`);
  assert.equal(packageJson.bugs.url, `${PUBLIC_RELEASES_REPOSITORY_URL}/issues`);
  assert.equal(packageJson.build.publish[0].repo, "Stemmio-Releases");
  for (const contents of [desktopLinks, workbench, issueTemplate, readme]) {
    assert.match(contents, /Charleyli925\/Stemmio-Releases/u);
    assert.doesNotMatch(contents, /Charleyli925\/PageRoot/u);
  }
  assert.match(provenance, /Charleyli925\/Stemmio/u);
  assert.doesNotMatch(provenance, /Charleyli925\/Stemmio-Releases/u);
  for (const contents of [candidate, checkpoint]) {
    assert.match(contents, /SOURCE_REPOSITORY_URL/u);
    assert.doesNotMatch(contents, /Charleyli925\/PageRoot/u);
  }
  assert.match(ciIncidentTemplate, /Charleyli925\/Stemmio\/actions\/runs/u);
});

test("private source policy keeps the user-facing release channel public", async () => {
  const [agentGuide, boundary, cutover, releasing, governance, license, security, about, releaseWorkflow] = await Promise.all([
    source("AGENTS.md"),
    source("docs/PRIVATE_SOURCE_BOUNDARY.md"),
    source("docs/PRIVATE_SOURCE_CUTOVER.md"),
    source("docs/RELEASING.md"),
    source("docs/RELEASE_PIPELINE_GOVERNANCE.md"),
    source("LICENSE"),
    source("SECURITY.md"),
    source("app/components/AboutStemmioDialog.tsx"),
    source(".github/workflows/release.yml"),
  ]);
  assert.equal(existsSync(path.join(productRoot, "docs/OPEN_SOURCE_BOUNDARY.md")), false);
  assert.match(agentGuide, /complete private source boundary/u);
  assert.match(boundary, /private, canonical source repository/u);
  assert.match(boundary, /public download and update channel/u);
  assert.match(license, /Proprietary Source License/u);
  assert.match(license, /previously published under Apache License 2\.0/u);
  assert.match(security, /Charleyli925\/Stemmio-Releases\/security\/advisories\/new/u);
  assert.match(about, /Stemmio Releases on GitHub/u);
  assert.doesNotMatch(about, /查看源代码/u);
  assert.match(releaseWorkflow, /STEMMIO_PUBLIC_RELEASES_TOKEN/u);
  assert.match(releaseWorkflow, /--repo "\$repository"/u);
  assert.match(releaseWorkflow, /publish_release "\$PUBLIC_RELEASES_REPOSITORY" false/u);
  assert.match(releaseWorkflow, /LEGACY_UPDATE_BRIDGE_REPOSITORY:\s*Charleyli925\/PageRoot/u);
  assert.match(releaseWorkflow, /LEGACY_UPDATE_BRIDGE_VERSION:\s*0\.9\.90/u);
  assert.match(releaseWorkflow, /--jq '\.full_name'/u);
  assert.match(
    releaseWorkflow,
    /if \[ "\$VERSION" = "\$LEGACY_UPDATE_BRIDGE_VERSION" \]; then[\s\S]+publish_release "\$LEGACY_UPDATE_BRIDGE_REPOSITORY" true/u,
  );
  for (const contents of [boundary, cutover, releasing, governance]) {
    assert.match(contents, /legacy updater bridge/u);
    assert.match(contents, new RegExp(LEGACY_UPDATE_BRIDGE_REPOSITORY.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("retired-identifier exceptions are surgical rather than file-wide", async () => {
  for (const relativePath of Object.keys(SURGICAL_CONTENT_EXCEPTIONS)) {
    const contents = await source(relativePath);
    const injected = removeContractExceptions(
      `${contents}\n// PageRoot regression sentinel`,
      relativePath,
    );
    assert.match(
      injected,
      RETIRED_PRODUCT_IDENTIFIERS,
      `${relativePath} must reject a new retired identifier outside its exact exception`,
    );
  }
});

test("current repository values are not globally exempt from retired-name scanning", () => {
  const injected = removeContractExceptions(
    "homepage: https://github.com/Charleyli925/PageRoot",
    "package.json",
  );
  assert.match(injected, /Charleyli925\/PageRoot/u);
  assert.match(injected, RETIRED_PRODUCT_IDENTIFIERS);
});

test("the frozen Stemmio identity and storage contracts are packaged atomically", async () => {
  const [identity, storage, schema, packageText, previewProtocol, editRuntime] = await Promise.all([
    source("shared/product-identity.mjs"),
    source("shared/project-storage-contract.mjs"),
    source("schemas/stemmio-element-identity.v1.schema.json"),
    source("package.json"),
    source("desktop/preview-protocol.mjs"),
    source("app/domain/edit-runtime-contract.js"),
  ]);

  assert.match(identity, /PRODUCT_NAME = "Stemmio"/u);
  assert.match(identity, /PRODUCT_TECHNICAL_NAME = "stemmio"/u);
  assert.match(identity, /PRODUCT_BUNDLE_ID = "com\.stemmio\.app"/u);
  assert.match(identity, /PRODUCT_PREVIEW_BUNDLE_ID = "com\.stemmio\.app\.developer-preview"/u);
  assert.match(identity, /PRODUCT_CONTROL_DIRECTORY_NAME = "\.stemmio"/u);
  assert.match(storage, /PROJECT_REGISTRY_FILE_NAME = PRODUCT_REGISTRY_FILE_NAME/u);
  assert.match(storage, /PROJECT_IMPORT_TEMP_PREFIX = PRODUCT_IMPORT_TEMP_PREFIX/u);
  assert.match(storage, /export function projectControlPath/u);
  assert.match(storage, /export function importTemporaryName/u);
  assert.match(storage, /export function nonReplaceTemporaryName/u);
  assert.match(schema, /https:\/\/stemmio\.local\/schemas\/stemmio-element-identity\.v1\.schema\.json/u);
  assert.match(schema, /\^sm1_/u);
  assert.match(packageText, /"name": "stemmio"/u);
  assert.match(packageText, /"appId": "com\.stemmio\.app"/u);
  assert.match(packageText, /"productName": "Stemmio"/u);
  assert.match(packageText, /"from": "shared\/product-identity\.mjs"/u);
  assert.match(packageText, /"from": "shared\/project-storage-contract\.mjs"/u);
  assert.match(packageText, /"conversation\.v3\.schema\.json"/u);
  assert.match(previewProtocol, /stemmio-preview/gu);
  assert.match(editRuntime, /stemmio-edit-runtime/gu);
  assert.match(await source("shared/editable-island.mjs"), /data-stemmio-editing/u);
});

test("legacy management roots and channel variables are rejected rather than redirected", async () => {
  const [runtime, pathSafety, catalog] = await Promise.all([
    source("desktop/runtime-environment.mjs"),
    source("bridge/project-file-repository/path-safety.mjs"),
    source("bridge/agent/catalog/agent-catalog.mjs"),
  ]);
  assert.doesNotMatch(runtime, /process\.env\.PAGEROOT_|PAGEROOT_RUNTIME_CHANNEL/u);
  assert.doesNotMatch(pathSafety, /process\.env\.PAGEROOT_|PAGEROOT_PROJECT_FILES_ROOT|\.pageroot-new-/u);
  assert.doesNotMatch(catalog, /~\/\.pageroot|PAGEROOT_AGENTS_ROOT/u);
  assert.match(runtime, /STEMMIO_RUNTIME_CHANNEL/u);
  assert.match(pathSafety, /nonReplaceTemporaryName/u);
  assert.match(pathSafety, /PRODUCT_PROJECTS_DIRECTORY_NAME/u);
  assert.match(catalog, /PRODUCT_ENV\.AGENTS_ROOT/u);
});
