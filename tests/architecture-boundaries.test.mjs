import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  architectureScan,
  discoverSourceFiles,
  dialogPolicyViolations,
  escapeBoundaryViolations,
  layerBoundaryViolations,
  ownershipBoundaryViolations,
  retiredArtifactViolations,
  noticePolicyViolations,
} from "../scripts/check-architecture.mjs";
import { loadNoticeLedger } from "../scripts/notice-policy.mjs";
import {
  countReactHooks,
  hasLiteralComparison,
  jsxElementNames,
  moduleSpecifiers,
  newExpressionNames,
  parseModule,
} from "../scripts/architecture-ast-query.mjs";

const execFileAsync = promisify(execFile);
const checker = fileURLToPath(new URL("../scripts/check-architecture.mjs", import.meta.url));

test("the production graph satisfies the responsibility boundaries", async () => {
  const result = await architectureScan();
  assert.equal(result.scope, "full");
  assert.deepEqual(result.roots, ["app", "bridge", "scripts", "desktop", "shared"]);
  assert.ok(result.scannedCount > 0);
  assert.equal(result.scannedCount, result.files.length);
  assert.deepEqual(result.violations, []);
});

test("plain Node test modules never import TypeScript runtime files", async () => {
  const testsDirectory = new URL("./", import.meta.url);
  const testFiles = (await readdir(testsDirectory))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const violations = [];
  for (const name of testFiles) {
    const source = await readFile(new URL(name, testsDirectory), "utf8");
    if (/\b(?:from\s*|import\s*\()\s*["'][^"']+\.tsx?["']/u.test(source)) {
      violations.push(name);
    }
  }
  assert.deepEqual(violations, []);
});

async function fixture(name) {
  return readFile(
    new URL(`./fixtures/architecture-boundaries/${name}`, import.meta.url),
    "utf8",
  );
}

test("layer, ownership and escape checks reject the four forbidden boundaries", async () => {
  const [viewBridge, controllerReact, duplicateSession, domainImport, secondWriter] = await Promise.all([
    fixture("view-bridge-call.tsx"),
    fixture("controller-react-import.js"),
    fixture("duplicate-session-owner.js"),
    fixture("domain-imports-application.js"),
    fixture("second-persistence-writer.js"),
  ]);

  assert.match(
    layerBoundaryViolations({ file: "app/components/example.tsx", source: viewBridge }).join("\n"),
    /views cannot import the Bridge client/u,
  );
  assert.match(
    layerBoundaryViolations({ file: "app/application/example.js", source: controllerReact }).join("\n"),
    /application code cannot import react/u,
  );
  assert.match(
    ownershipBoundaryViolations({ file: "app/workbench/example.tsx", source: duplicateSession }).join("\n"),
    /may only be constructed by the composition root/u,
  );
  assert.match(
    layerBoundaryViolations({ file: "app/domain/example.js", source: domainImport }).join("\n"),
    /domain code cannot import/u,
  );
  assert.match(
    ownershipBoundaryViolations({ file: "app/application/example.js", source: secondWriter }).join("\n"),
    /persistence writes belong to an approved repository/u,
  );
});

test("renderer-local workspace preferences remain an explicit presentation owner", () => {
  const source = [
    'import { WorkspacePreferencesSession } from "../application/workspace-preferences-session.js";',
    "const session = new WorkspacePreferencesSession({ port: null });",
  ].join("\n");
  assert.deepEqual(
    ownershipBoundaryViolations({ file: "app/workbench/use-workspace-preferences.ts", source }),
    [],
  );
});

test("generic Bridge escapes remain forbidden without freezing implementation names", () => {
  assert.match(
    escapeBoundaryViolations({
      file: "app/application/example.js",
      source: "export function submit(input) { return input.executeBridge('request'); }",
    }).join("\n"),
    /generic Bridge command escapes are forbidden/u,
  );
  assert.match(
    escapeBoundaryViolations({
      file: "app/application/example.js",
      source: "export function load() { return fetch('/workspace'); }",
    }).join("\n"),
    /raw fetch belongs/u,
  );
  assert.deepEqual(
    escapeBoundaryViolations({
      file: "app/application/example.js",
      source: "const internalName = value; function submit(payload) { return payload.run(internalName); }",
    }),
    [],
  );
});

test("high-value architecture rules have explicit failing and passing forms", () => {
  for (const source of [
    'export * from "../../application/bridge-client.js";',
    [
      'import * as RuntimeBridge from "../../application/bridge-client.js";',
      "export const bridge = RuntimeBridge.createRuntimeBridgeClient();",
    ].join("\n"),
  ]) {
    assert.match(
      layerBoundaryViolations({
        file: "app/workbench/document-view.tsx",
        source,
      }).join("\n"),
      /views cannot import the Bridge client/u,
    );
  }
  assert.match(
    escapeBoundaryViolations({
      file: "app/workbench/document-view.tsx",
      source: "export function open() { return window.fetch('/workspace'); }",
    }).join("\n"),
    /views cannot issue raw business requests/u,
  );
  assert.deepEqual(
    escapeBoundaryViolations({
      file: "app/workbench/document-view.tsx",
      source: "export function open(commands) { return commands.openSelectedDocument(); }",
    }),
    [],
  );

  assert.match(
    layerBoundaryViolations({
      file: "app/domain/source-state.js",
      source: 'import fs from "node:fs"; export const read = fs.readFileSync;',
    }).join("\n"),
    /domain code cannot import node:fs/u,
  );
  assert.deepEqual(
    layerBoundaryViolations({
      file: "app/domain/source-state.js",
      source: 'import { transition } from "./transition.js"; export { transition };',
    }),
    [],
  );

  const aliasedSession = [
    'import { DocumentSession as SessionOwner } from "./document-session.js";',
    "export const session = new SessionOwner();",
  ].join("\n");
  assert.match(
    ownershipBoundaryViolations({
      file: "app/workbench/document-view.tsx",
      source: aliasedSession,
    }).join("\n"),
    /may only be constructed by the composition root/u,
  );
  assert.deepEqual(
    ownershipBoundaryViolations({
      file: "app/application/workspace-controller.js",
      source: aliasedSession,
    }),
    [],
  );

  const aliasedWriter = [
    'import { writeFile as persist } from "node:fs/promises";',
    "export function save(path, bytes) { return persist(path, bytes); }",
  ].join("\n");
  assert.match(
    ownershipBoundaryViolations({
      file: "app/application/example.js",
      source: aliasedWriter,
    }).join("\n"),
    /persistence writes belong to an approved repository/u,
  );
  assert.deepEqual(
    ownershipBoundaryViolations({
      file: "bridge/lifecycle-core.mjs",
      source: aliasedWriter,
    }),
    [],
  );

  assert.match(
    layerBoundaryViolations({
      file: "shared/cross-runtime.mjs",
      source: 'import path from "node:path"; export const join = path.join;',
    }).join("\n"),
    /cross-runtime shared code cannot import host module node:path/u,
  );
  assert.deepEqual(
    layerBoundaryViolations({
      file: "shared/project-storage-contract.mjs",
      source: 'import path from "node:path"; export const join = path.join;',
    }),
    [],
  );
  assert.match(
    layerBoundaryViolations({
      file: "app/workbench/document-view.tsx",
      source: 'import { projectControlPath } from "../../shared/project-storage-contract.mjs";',
    }).join("\n"),
    /cannot import host-only shared storage paths/u,
  );
});

test("the checker entry fails closed for scanned violations and parse errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stemmio-architecture-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(root, "app", "workbench"), { recursive: true }),
    mkdir(join(root, "app", "domain"), { recursive: true }),
    mkdir(join(root, "shared"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "app", "workbench", "raw-request.tsx"),
      "export const load = () => fetch('/workspace');\n",
    ),
    writeFile(
      join(root, "app", "domain", "broken.js"),
      "export function broken( {\n",
    ),
    writeFile(
      join(root, "shared", "host-leak.mjs"),
      'import path from "node:path"; export const join = path.join;\n',
    ),
  ]);
  await assert.rejects(
    execFileAsync(process.execPath, [
      checker,
      "--root", root,
      "--scope", "limited",
      "--include", "app/workbench",
      "--include", "app/domain",
      "--include", "shared",
    ]),
    (error) => {
      assert.match(error.stderr, /after scanning 3 source files across limited scope/u);
      assert.match(error.stderr, /views cannot issue raw business requests/u);
      assert.match(error.stderr, /app\/domain\/broken\.js: parse error/u);
      assert.match(error.stderr, /shared\/host-leak\.mjs: cross-runtime shared code/u);
      return true;
    },
  );
});

test("the checker CLI rejects invalid roots, incomplete full scans and malformed arguments", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stemmio-architecture-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ordinaryFile = join(root, "not-a-directory");
  await writeFile(ordinaryFile, "fixture\n");

  const cases = [
    {
      name: "missing root",
      args: ["--root", join(root, "missing")],
      expected: /architecture root is unavailable/u,
    },
    {
      name: "ordinary file root",
      args: ["--root", ordinaryFile],
      expected: /architecture root must be a directory/u,
    },
    {
      name: "missing root argument",
      args: ["--root"],
      expected: /--root requires a value/u,
    },
    {
      name: "full scan missing required source roots",
      args: ["--root", root],
      expected: /required architecture source app is unavailable/u,
    },
  ];
  for (const fixtureCase of cases) {
    await assert.rejects(
      execFileAsync(process.execPath, [checker, ...fixtureCase.args]),
      (error) => {
        assert.match(error.stderr, /Architecture check could not complete/u, fixtureCase.name);
        assert.match(error.stderr, fixtureCase.expected, fixtureCase.name);
        return true;
      },
    );
  }
});

test("an explicitly limited checker scan reports its scope and non-zero work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stemmio-architecture-limited-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "app", "domain"), { recursive: true });
  await writeFile(join(root, "app", "domain", "value.js"), "export const value = 1;\n");

  const { stdout } = await execFileAsync(process.execPath, [
    checker,
    "--root", root,
    "--scope", "limited",
    "--include", "app/domain",
  ]);
  assert.match(
    stdout,
    /Architecture contract passed\. Scanned 1 source files across limited scope: app\/domain\./u,
  );

  const emptyRoot = join(root, "empty");
  await mkdir(join(emptyRoot, "app", "domain"), { recursive: true });
  await assert.rejects(
    execFileAsync(process.execPath, [
      checker,
      "--root", emptyRoot,
      "--scope", "limited",
      "--include", "app/domain",
    ]),
    (error) => {
      assert.match(error.stderr, /architecture scan completed no work/u);
      return true;
    },
  );
});

test("source discovery preserves directory I/O failures instead of returning an empty scan", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stemmio-architecture-io-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "app"), { recursive: true });
  const denied = new Error("fixture permission denied");
  denied.code = "EACCES";

  await assert.rejects(
    discoverSourceFiles({
      productRoot: root,
      scope: "limited",
      includes: ["app"],
      io: {
        stat,
        readFile: (target, encoding) => readFile(target, encoding),
        readdir: async () => { throw denied; },
      },
    }),
    /cannot read architecture source directory app: fixture permission denied/u,
  );
});

test("renaming private fields, methods, parameters and locals does not alter responsibility results", () => {
  const source = [
    'import { RunWorkflow } from "./run-workflow.js";',
    "export class WorkspaceController {",
    "  #renamedWorkflow = new RunWorkflow({});",
    "  #renamedGuard = null;",
    "  submitRenamed(requestBody) {",
    "    return this.#renamedWorkflow.submit(requestBody);",
    "  }",
    "}",
  ].join("\n");
  const handle = parseModule("app/application/workspace-controller.js", source);
  assert.deepEqual(layerBoundaryViolations({ file: "app/application/workspace-controller.js", source, module: handle }), []);
  assert.deepEqual(ownershipBoundaryViolations({ file: "app/application/workspace-controller.js", source, module: handle }), []);
  assert.deepEqual(escapeBoundaryViolations({ file: "app/application/workspace-controller.js", source, module: handle }), []);
  assert.deepEqual(newExpressionNames(handle), ["RunWorkflow"]);
  assert.deepEqual(moduleSpecifiers(handle), ["./run-workflow.js"]);
});

test("AST queries retain responsibility facts while ignoring member spelling", () => {
  const handle = parseModule(
    "fixture.tsx",
    [
      "function View() {",
      "  const [value, setValue] = useState(0);",
      "  const reference = useRef<HTMLDivElement>(null);",
      "  useEffect(() => {}, []);",
      "  return value;",
      "}",
    ].join("\n"),
  );
  assert.equal(countReactHooks(handle), 3);
  assert.deepEqual(jsxElementNames(handle), []);
  assert.equal(
    hasLiteralComparison(
      parseModule("fixture.js", 'const delivery = { mode: "managed-agent" };'),
      { literals: ["qoder"], propertyNames: ["mode"] },
    ),
    false,
  );
});

test("dialog policy forbids unregistered native alerts and window.confirm", async () => {
  const source = await fixture("unregistered-confirm.js");
  const violations = dialogPolicyViolations({
    file: "app/workbench/example.js",
    source,
  }).join("\n");
  assert.match(violations, /ordinary showMessageBox is forbidden/u);
  assert.match(violations, /showErrorBox is forbidden except the registered startup failure/u);
  assert.match(
    violations,
    /window.confirm is forbidden unless the copy is a registered delete\/overwrite\/abandon confirm/u,
  );
  assert.deepEqual(
    dialogPolicyViolations({
      file: "app/workbench/example.js",
      source: [
        'window.confirm("确定要用磁盘上的版本继续吗？未写入的编辑都会丢弃。");',
        'window.confirm("确定要用外部版本覆盖当前编辑吗？此操作不可撤销。");',
      ].join("\n"),
    }),
    [],
  );
});

test("notice freeze forbids unregistered setToast, NoticeBar, aliases and background-result", async () => {
  const ledger = await loadNoticeLedger();
  const noticeSource = await fixture("unregistered-notice.js");
  const noticeViolations = noticePolicyViolations({
    file: "app/workbench/example.js",
    source: noticeSource,
    ledger,
  }).join("\n");
  assert.match(noticeViolations, /setToast create calls are frozen/u);
  assert.match(noticeViolations, /background-result is frozen/u);
  assert.match(noticeViolations, /uncatalogued is frozen/u);
  assert.match(noticeViolations, /setToast aliases are forbidden/u);
  assert.match(
    noticePolicyViolations({
      file: "app/components/example.tsx",
      source: "export default function Example() { return <NoticeBar title=\"unregistered\" />; }",
      ledger,
    }).join("\n"),
    /NoticeBar is frozen to registered surfaces/u,
  );
  assert.deepEqual(
    noticePolicyViolations({
      file: "app/workbench.tsx",
      source: "setToast(null);",
      ledger,
    }),
    [],
  );
});

test("retired production modules and imports stay outside the graph", () => {
  assert.match(
    retiredArtifactViolations({
      file: "app/example.js",
      source: 'import Controller from "./NativeEditingController";',
    }).join("\n"),
    /retired module/u,
  );
  assert.match(
    retiredArtifactViolations({ file: "app/lib/format-skeleton.js", source: "" }).join("\n"),
    /retired production modules/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/version-audit-records.js",
      source: "",
    }).join("\n"),
    /retired production modules/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/example.js",
      source: "export function commitPendingEdit() {}",
    }).join("\n"),
    /retired compatibility identifier commitPendingEdit/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/example.tsx",
      source: 'import ReviewAnalysisPrewarm from "./workbench/ReviewAnalysisPrewarm";',
    }).join("\n"),
    /retired module/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/example.tsx",
      source: 'import Pool from "./workbench/WorkbenchDocumentCanvasPool";',
    }).join("\n"),
    /retired module/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/application/example.js",
      source: 'export const endpoint = "/source-history/action";',
    }).join("\n"),
    /source-history compatibility literal/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "bridge/example.mjs",
      source: 'export const schema = "source-history.v1";',
    }).join("\n"),
    /source-history compatibility literal/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/page-view-context.js",
      source: 'const name = "data-p";',
    }).join("\n"),
    /retired page-view tab adapters/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/workbench/review-document.ts",
      source: 'export const attr = "data-stemmio-review-source-node-id";',
    }).join("\n"),
    /Review cannot write parseKey identity/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/review-comment-source-map.js",
      source: "export function instrumentPreviewHtml() {}",
    }).join("\n"),
    /instrumentPreviewHtml cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/source-patch-core.js",
      source: "export function resolveFromPreview() {}",
    }).join("\n"),
    /resolveFromPreview cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/source-patch-engine.js",
      source: "export function liveExactCommandTarget() {}",
    }).join("\n"),
    /liveExactCommandTarget cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/lib/source-patch-engine.js",
      source: "export function planDirectTextNodePatch() {}",
    }).join("\n"),
    /planDirectTextNodePatch cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/components/html-canvas-preview-sync.ts",
      source: 'createElement("stemmio-text-fragment");',
    }).join("\n"),
    /disposable text-fragment hosts cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/application/document-workflow.js",
      source: 'this.#recoveryStore.write("stemmio-recovery:doc", {});',
    }).join("\n"),
    /document HTML recovery is Main journal only/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/workbench.tsx",
      source: "export function Surface() { return HtmlDisplaySurface({}); }",
    }).join("\n"),
    /cannot replace the live editor with HtmlDisplaySurface/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/workbench/WorkbenchActiveDocumentCanvas.tsx",
      source: "export function Host() { return cloneElement(child); }",
    }).join("\n"),
    /cloneElement canvas host cannot return/u,
  );
  assert.match(
    retiredArtifactViolations({
      file: "app/workbench/review/runtime-projection.ts",
      source: "const pattern = /^element:\\d+:\\d+:[a-z]/iu;",
    }).join("\n"),
    /parseKey cannot leave source-index/u,
  );
});

test("the architecture checker contains no implementation-shape assertions", async () => {
  const source = await readFile(new URL("../scripts/check-architecture.mjs", import.meta.url), "utf8");
  const privatePrefix = "#";
  const privateNames = ["drainCoordinator", "navigationPort"];
  const receiptName = ["application", "Receipt"].join("");
  const controllerReference = ["workspace", "Controller", "Ref"].join("");
  assert.doesNotMatch(source, new RegExp(`${privatePrefix}(?:${privateNames.join("|")})`, "u"));
  assert.doesNotMatch(source, new RegExp(`${receiptName}|${controllerReference}`, "u"));
  assert.doesNotMatch(source, /\.includes\(.*(?:drain|freeze|receipt)/su);
});
