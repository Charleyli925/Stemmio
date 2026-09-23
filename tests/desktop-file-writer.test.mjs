import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ensureManagedWelcomeHtml,
  htmlSha256,
  managedWelcomeSourcePath,
  persistHtmlFile,
  readHtmlFile,
  resetProjectFileQueuesForTests,
  writeHtmlCopy,
} from "../desktop/project-files.mjs";
import {
  DEFAULT_PROJECT_HTML,
  WELCOME_LOGO_RELATIVE_PATH,
  WELCOME_PROJECT_NAME,
} from "../desktop/welcome-project-content.mjs";

function page(title) {
  return `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`;
}

test("managed welcome HTML is a normal source file and is never reset after editing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stemmio-welcome-"));
  const workspaceRoot = join(directory, "Stemmio", "项目记录");
  const sourcePath = join(directory, "Stemmio", WELCOME_PROJECT_NAME);
  const logoPath = join(directory, "Stemmio", WELCOME_LOGO_RELATIVE_PATH);
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.equal(managedWelcomeSourcePath(workspaceRoot), sourcePath);
  const first = await ensureManagedWelcomeHtml({ workspaceRoot });
  assert.equal(first.created, true);
  assert.equal(first.managedWelcome, true);
  assert.equal(first.sourcePath, sourcePath);
  assert.equal(first.html, DEFAULT_PROJECT_HTML);
  assert.equal(first.sha256, htmlSha256(DEFAULT_PROJECT_HTML));
  assert.deepEqual(
    await readFile(logoPath),
    await readFile(new URL("../public/brand-logo.png", import.meta.url)),
  );

  const edited = page("用户已经修改欢迎页");
  await writeFile(sourcePath, edited, "utf8");
  const reopened = await ensureManagedWelcomeHtml({ workspaceRoot });
  assert.equal(reopened.created, false);
  assert.equal(reopened.html, edited);
  assert.equal(await readFile(sourcePath, "utf8"), edited);
});

test("welcome guidance names the current Agent review decisions", async () => {
  assert.match(DEFAULT_PROJECT_HTML, /在 AI 面板选择并连接你信任的 Agent/u);
  assert.match(DEFAULT_PROJECT_HTML, /查看修改/u);
  assert.match(DEFAULT_PROJECT_HTML, /采用修改/u);
  assert.match(DEFAULT_PROJECT_HTML, /不用这次/u);
  assert.match(DEFAULT_PROJECT_HTML, /变化 7 处/u);
  assert.match(DEFAULT_PROJECT_HTML, /适应画布/u);
  assert.doesNotMatch(DEFAULT_PROJECT_HTML, /全部变化/u);
  assert.doesNotMatch(DEFAULT_PROJECT_HTML, /审阅对比|打开 AI 修改后|回到修改前继续/u);

  const firstOpenGuide = await readFile(
    new URL("../desktop/resources/首次打开说明.txt", import.meta.url),
    "utf8",
  );
  assert.match(firstOpenGuide, /点击“查看修改”进入对照/u);
  assert.match(firstOpenGuide, /“采用修改”或“不用这次”/u);
  assert.doesNotMatch(firstOpenGuide, /审阅对比|打开 AI 修改后|返回 AI 修改前/u);
});

test("desktop writer serializes revisions and never lets an older write win", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "stemmio-writer-"));
  const sourcePath = join(directory, "source.html");
  const initial = page("initial");
  await writeFile(sourcePath, initial, "utf8");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = persistHtmlFile({
    projectId: "project_test",
    documentId: "doc_test",
    sourcePath,
    html: page("revision-1"),
    expectedSha256: htmlSha256(initial),
    editRevision: 1,
  });
  const second = persistHtmlFile({
    projectId: "project_test",
    documentId: "doc_test",
    sourcePath,
    html: page("revision-2"),
    expectedSha256: htmlSha256(initial),
    editRevision: 2,
  });
  const [savedOne, savedTwo] = await Promise.all([first, second]);
  assert.equal(savedOne.persistedRevision, 1);
  assert.equal(savedTwo.persistedRevision, 2);
  assert.equal(await readFile(sourcePath, "utf8"), page("revision-2"));

  const stale = await persistHtmlFile({
    projectId: "project_test",
    documentId: "doc_test",
    sourcePath,
    html: page("revision-1"),
    expectedSha256: savedTwo.sha256,
    editRevision: 1,
  });
  assert.equal(stale.skipped, true);
  assert.equal(await readFile(sourcePath, "utf8"), page("revision-2"));
});

test("desktop writer reports structured external conflicts without overwriting", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "stemmio-writer-conflict-"));
  const sourcePath = join(directory, "source.html");
  const initial = page("initial");
  const external = page("external");
  await writeFile(sourcePath, initial, "utf8");
  await writeFile(sourcePath, external, "utf8");
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    persistHtmlFile({
      projectId: "project_test",
      documentId: "doc_test",
      sourcePath,
      html: page("workbench"),
      expectedSha256: htmlSha256(initial),
      editRevision: 1,
    }),
    (error) => {
      assert.equal(error.code, "SOURCE_CHANGED");
      assert.equal(error.details.expectedSha256, htmlSha256(initial));
      assert.equal(error.details.actualSha256, htmlSha256(external));
      return true;
    },
  );
  assert.equal(await readFile(sourcePath, "utf8"), external);
});

test("export creates an independent copy and readback reports exact hash", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "stemmio-export-"));
  const destinationPath = join(directory, "copy.html");
  const html = page("export");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const exported = await writeHtmlCopy({ destinationPath, html });
  const inspected = await readHtmlFile({ sourcePath: destinationPath });
  assert.equal(exported.sha256, htmlSha256(html));
  assert.equal(inspected.sha256, exported.sha256);
  assert.equal(inspected.html, html);
});

test("export preserves the complete Working Copy bytes with embedded HTML payloads", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "stemmio-export-rich-"));
  const destinationPath = join(directory, "rich-copy.html");
  const html = [
    '<!doctype html><html data-stemmio-id="sm1_root"><head>',
    '<style>.marker::before{content:"data-stemmio-id"}</style>',
    '</head><body data-stemmio-id="sm1_body">',
    '<script>window.echarts = { init() { return "data-stemmio-id"; } };</script>',
    '<svg viewBox="0 0 10 10"><text>data-stemmio-id</text></svg>',
    '<canvas width="10" height="10"></canvas>',
    '<p>data-stemmio-id</p></body></html>',
  ].join("");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const exported = await writeHtmlCopy({ destinationPath, html });
  const inspected = await readHtmlFile({ sourcePath: destinationPath });

  assert.equal(exported.sha256, htmlSha256(html));
  assert.equal(inspected.sha256, exported.sha256);
  assert.equal(inspected.html, html);
  assert.equal((inspected.html.match(/data-stemmio-id/gu) ?? []).length, 6);
});

test("desktop reader fails closed on non-UTF-8 HTML without rewriting bytes", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "stemmio-encoding-"));
  const sourcePath = join(directory, "legacy-encoding.html");
  const original = Buffer.concat([
    Buffer.from("<!doctype html><html><body>", "utf8"),
    Buffer.from([0xff, 0xfe]),
    Buffer.from("</body></html>", "utf8"),
  ]);
  await writeFile(sourcePath, original);
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    readHtmlFile({ sourcePath }),
    (error) => {
      assert.equal(error.code, "UNSUPPORTED_HTML_ENCODING");
      assert.match(error.message, /UTF-8/u);
      return true;
    },
  );
  assert.deepEqual(await readFile(sourcePath), original);
});
