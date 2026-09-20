import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, link, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { readHtmlFile } from "../bridge/project-file-repository/path-safety.mjs";
import { sourceBindingPath } from "../bridge/project-file-repository/source-binding.mjs";
import { fixture, importSource, html, json } from "./project-file-repository-harness.mjs";
import { createBridgeTestEnvironment } from "./helpers/bridge-test-environment.mjs";
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
async function restart(projectsRoot) {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", `
    import { ProjectFileRepository } from './bridge/project-file-repository.mjs';
    const repository = new ProjectFileRepository({projectsRoot:process.argv[1]});
    await repository.initialize();
    console.log(JSON.stringify(await repository.listRegisteredProjects()));
  `, projectsRoot], { cwd: root });
  return JSON.parse(stdout);
}
async function drift(target, fields = ["device", "inode", "birthtimeMs"]) {
  const manifestPath = path.join(target.projectRootPath, ".stemmio", "manifest.json");
  const manifest = await json(manifestPath);
  for (const member of manifest.workingCopies) for (const field of fields) {
    member.fileIdentity[field] = field === "birthtimeMs" ? 123 : "123";
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
}
for (const fields of [["device"], ["inode"], ["birthtimeMs"], ["device", "inode", "birthtimeMs"]]) {
  test(`new process recovers persisted ${fields.join("/")} drift without changing source or Version`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const before = await readFile(target.exactSourcePath);
    await drift(target, fields);
    const rows = await restart(value.projects);
    assert.equal(rows[0].availability, "ready");
    assert.deepEqual(await readFile(target.exactSourcePath), before);
    const manifest = await json(path.join(target.projectRootPath, ".stemmio", "manifest.json"));
    assert.equal(manifest.versions.length, 1);
    assert.equal(manifest.workingCopies[0].fileIdentity.device, String((await lstat(target.exactSourcePath)).dev));
    assert.equal((await lstat(sourceBindingPath(target.projectRootPath, target.workingCopyId))).ino, (await lstat(target.exactSourcePath)).ino);
  });
}
test("multiple current Versions retain one editable file and preserved drafts", async (t) => {
  const value = await fixture(t); const projects = [];
  for (let i = 0; i < 5; i += 1) {
    const { target } = await importSource(value, `project-${i}.html`);
    let active = target;
    for (let ordinal = 2; ordinal <= 3; ordinal += 1) {
      const candidateId = `candidate_binding_${i}_${ordinal}`;
      await value.repository.createCandidate({ target: active, requestId: `req_binding_${i}_${ordinal}`, candidateId,
        html: html(`v${ordinal}`), expectedSourceSha256: active.sourceSha256 });
      active = (await value.repository.promoteCandidate({ target: active, candidateId,
        decisionOperationId: `promote_${candidateId}` })).target;
    }
    await drift(active);
    projects.push(active);
  }
  const rows = await restart(value.projects);
  assert.equal(rows.length, 5); assert.ok(rows.every((row) => row.availability === "ready"));
  for (const active of projects) {
    const manifest = await json(path.join(active.projectRootPath, ".stemmio/manifest.json"));
    assert.equal(manifest.workingCopies.length, 1);
    assert.equal(manifest.workingCopies[0].workingCopyId, active.workingCopyId);
    assert.equal(await readFile(active.exactSourcePath, "utf8"), html("v3"));
    const preserved = await value.repository.listPreservedDrafts({ projectId: active.projectId });
    assert.equal(preserved.length, 2);
    const contents = await Promise.all(preserved.map((record) => value.repository.readPreservedDraft({ projectId: active.projectId, recoveryId: record.recoveryId })));
    assert.deepEqual(contents.map((record) => record.html).sort(), [html("V1"), html("v2")].sort());
  }
});

for (const removeBindings of [false, true]) {
  test(`startup refresh batches observations and bounds binding scans (missing anchors: ${removeBindings})`, async (t) => {
    const value = await fixture(t);
    const imported = await importSource(value);
    let target = imported.target;
    const count = 12;
    for (let ordinal = 2; ordinal <= count; ordinal += 1) {
      const candidateId = `candidate_startup_scale_${ordinal}`;
      await value.repository.createCandidate({ target, requestId: `req_startup_scale_${ordinal}`, candidateId,
        html: html(`version ${ordinal}`), expectedSourceSha256: target.sourceSha256 });
      target = (await value.repository.promoteCandidate({ target, candidateId, decisionOperationId: `promote_${candidateId}` })).target;
    }
    await drift(target);
    const manifestPath = path.join(target.projectRootPath, ".stemmio/manifest.json");
    const before = await json(manifestPath);
    if (removeBindings) for (const member of before.workingCopies) {
      await rm(sourceBindingPath(target.projectRootPath, member.workingCopyId));
    }
    const original = { readdir: filesystem.readdir, lstat: filesystem.lstat, rename: filesystem.rename };
    let sourceScans = 0; let bindingStats = 0; let manifestWrites = 0;
    filesystem.readdir = async (targetPath, ...options) => {
      if (String(targetPath) === target.projectRootPath) sourceScans += 1;
      return original.readdir(targetPath, ...options);
    };
    filesystem.lstat = async (targetPath, ...options) => {
      if (String(targetPath).endsWith(".ref")) bindingStats += 1;
      return original.lstat(targetPath, ...options);
    };
    filesystem.rename = async (source, destination, ...options) => {
      if (String(destination) === manifestPath) manifestWrites += 1;
      return original.rename(source, destination, ...options);
    };
    syncBuiltinESMExports();
    try { await new ProjectFileRepository({ projectsRoot: value.projects }).initialize(); }
    finally { Object.assign(filesystem, original); syncBuiltinESMExports(); }
    assert.equal(manifestWrites, 1, "all observation refreshes share one manifest publication");
    assert.ok(sourceScans <= 2, `unexpected repeated source scans: ${sourceScans}`);
    assert.ok(bindingStats <= count * 8, `binding checks must grow linearly: ${bindingStats}`);
    const after = await json(manifestPath);
    assert.deepEqual(after.versions, before.versions);
    for (const member of after.workingCopies) {
      const sourcePath = path.join(target.projectRootPath, member.sourceRelativePath);
      const source = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath: target.projectRootPath });
      const state = await json(path.join(target.projectRootPath, ".stemmio", member.stateRelativePath));
      assert.equal(source.sha256, state.currentSha256);
      assert.equal(member.fileIdentity.device, String(source.information.dev));
      assert.equal((await lstat(sourceBindingPath(target.projectRootPath, member.workingCopyId))).ino, source.information.ino);
    }
  });
}
test("Bridge startup refreshes current draft observations before serving the project catalog", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  const candidateId = "candidate_bridge_migration_0001";
  await value.repository.createCandidate({ target, requestId: "req_bridge_migration_0001", candidateId, html: html("next"), expectedSourceSha256: target.sourceSha256 });
  const promoted = await value.repository.promoteCandidate({ target, candidateId,
    decisionOperationId: `promote_${candidateId}` });
  await drift(target);
  const bridge = await createBridgeTestEnvironment(t);
  await bridge.start({ STEMMIO_PROJECT_FILES_ROOT: value.projects });
  const { response, body } = await bridge.requestJson("/registered-projects");
  assert.equal(response.status, 200);
  assert.equal(body.projects[0].availability, "ready");
  const manifest = await json(path.join(target.projectRootPath, ".stemmio/manifest.json"));
  assert.equal(manifest.workingCopies.length, 1);
  assert.equal(manifest.workingCopies[0].workingCopyId, promoted.target.workingCopyId);
  const preserved = await value.repository.listPreservedDrafts({ projectId: target.projectId });
  assert.equal((await value.repository.readPreservedDraft({ projectId: target.projectId, recoveryId: preserved[0].recoveryId })).html, html("V1"));
});

test("Finder HTML and folder rename survives stale observations and a new process", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value); await drift(target);
  const renamedHtml = path.join(target.projectRootPath,"renamed.html"); await rename(target.exactSourcePath,renamedHtml);
  const renamedRoot = path.join(value.projects,"renamed-project"); await rename(target.projectRootPath,renamedRoot);
  const rows = await restart(value.projects);
  assert.equal(rows[0].availability,"ready"); assert.equal(rows[0].activeSourcePath,path.join(renamedRoot,"renamed.html"));
});
test("copy-delete move with broken hard links rebinds exact member paths", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value);
  const destination = path.join(value.projects,"moved-to-new-volume"); await cp(target.projectRootPath,destination,{recursive:true}); await rm(target.projectRootPath,{recursive:true});
  const rows = await restart(value.projects); assert.equal(rows[0].availability,"ready");
  const memberPath = path.join(destination,path.basename(target.exactSourcePath));
  assert.equal((await lstat(sourceBindingPath(destination,target.workingCopyId))).ino,(await lstat(memberPath)).ino);
});
test("duplicate project quarantines only that identity, even at an existing registered path", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value); const healthy = await importSource(value,"healthy.html");
  await cp(target.projectRootPath,path.join(value.projects,"duplicate"),{recursive:true});
  const rows = await restart(value.projects);
  assert.equal(rows.find((row)=>row.projectId===target.projectId).sourceStatus,"duplicate");
  assert.equal(rows.find((row)=>row.projectId===healthy.target.projectId).availability,"ready");
  assert.ok(await value.repository.resolveOpenTarget({sourcePath:healthy.target.exactSourcePath}));
  await assert.rejects(value.repository.saveWorkingCopy({target,html:html("denied"),expectedSourceSha256:target.sourceSha256}),{code:"REGISTERED_PROJECT_AMBIGUOUS"});
});
test("incomplete copied project records do not quarantine a complete registered project", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  for (const missing of ["manifest.json", "runtime-state.json"]) {
    const partialRoot = path.join(value.projects, `partial-${missing}`);
    await cp(target.projectRootPath, partialRoot, { recursive: true });
    await rm(path.join(partialRoot, ".stemmio", missing));
  }
  const rows = await restart(value.projects);
  assert.equal(rows[0].availability, "ready");
  assert.equal(rows[0].sourceStatus, "unknown");
  const current = await value.repository.resolveOpenTarget({ sourcePath: target.exactSourcePath });
  assert.equal(current.projectId, target.projectId);
  await value.repository.saveWorkingCopy({ target: current, html: html("saved"), expectedSourceSha256: current.sourceSha256 });
  assert.equal(await readFile(target.exactSourcePath, "utf8"), html("saved"));
});
test("same-hash unregistered copies never become managed; duplicate hard links isolate the binding", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value);
  const copy = path.join(target.projectRootPath,"copy.html"); await cp(target.exactSourcePath,copy);
  assert.equal(await value.repository.resolveOpenTarget({sourcePath:copy}),null);
  await link(target.exactSourcePath,path.join(target.projectRootPath,"hardlink.html"));
  const rows = await restart(value.projects); assert.equal(rows[0].sourceStatus,"duplicate");
  await assert.rejects(value.repository.saveWorkingCopy({target,html:html("denied"),expectedSourceSha256:target.sourceSha256}),{code:"MANAGED_PATH_AMBIGUOUS"});
});
test("missing HTML retains version browsing and restores only verified anchor bytes without overwrite", async (t) => {
  const value = await fixture(t); const {target} = await importSource(value); const bytes=await readFile(target.exactSourcePath);
  await rm(target.exactSourcePath); const rows=await restart(value.projects);
  assert.equal(rows[0].sourceStatus,"missing"); assert.equal(rows[0].canRestoreWorkingCopy,true); assert.equal(rows[0].documentId,target.documentId);
  assert.equal((await value.repository.listRegisteredProjectVersionSummaries({projectId:target.projectId})).versions.length,1);
  await value.repository.restoreRegisteredWorkingCopy({projectId:target.projectId}); assert.deepEqual(await readFile(target.exactSourcePath),bytes);
  await assert.rejects(value.repository.restoreRegisteredWorkingCopy({projectId:target.projectId}),{code:"WORKING_COPY_CONFLICT"});
});
for (const atomic of [false,true]) test(`external ${atomic?"replacement":"in-place write"} stays an external-content state`,async(t)=>{
  const value=await fixture(t);const {target}=await importSource(value); const external=html("external");
  if(atomic){await writeFile(`${target.exactSourcePath}.tmp`,external);await rename(`${target.exactSourcePath}.tmp`,target.exactSourcePath);}else await writeFile(target.exactSourcePath,external);
  const rows=await restart(value.projects);assert.equal(rows[0].sourceStatus,"unknown");assert.equal((await value.repository.resolveRegisteredProjectOpenTarget({projectId:target.projectId})).html,external);assert.equal(await readFile(target.exactSourcePath,"utf8"),external);
});
test("a replaced path during descriptor read is rejected",async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value);const replacement=path.join(target.projectRootPath,"replacement.tmp");await writeFile(replacement,html("replacement"));
 await assert.rejects(readHtmlFile(target.exactSourcePath,"Working Copy",{beforeRead:()=>rename(replacement,target.exactSourcePath)}),{code:"SOURCE_HASH_CONFLICT"});
});
for (const stage of ["save-prepared","save-source-displaced","save-source-written","save-anchor-switched","save-state-written","save-manifest-written","save-committed"]) test(`new process resolves ${stage} crash plus device drift`,async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value);const before=await readFile(target.exactSourcePath,"utf8");const after=html("saved");
 const writer=new ProjectFileRepository({projectsRoot:value.projects,failpoint:(name)=>name===stage});
 await assert.rejects(writer.saveWorkingCopy({target,html:after,expectedSourceSha256:target.sourceSha256,editRevision:1}));await drift(target);
 assert.equal((await restart(value.projects))[0].availability,"ready");assert.equal(await readFile(target.exactSourcePath,"utf8"),stage==="save-prepared"?before:after);
});
test("save detects same-hash physical replacement at the commit boundary",async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value); const before=await readFile(target.exactSourcePath);
 const writer=new ProjectFileRepository({projectsRoot:value.projects,failpoint:async(name)=>{if(name==="save-before-commit"){await writeFile(`${target.exactSourcePath}.tmp`,before);await rename(`${target.exactSourcePath}.tmp`,target.exactSourcePath);}return false;}});
 await assert.rejects(writer.saveWorkingCopy({target,html:html("must not overwrite"),expectedSourceSha256:target.sourceSha256,editRevision:1}),{code:"WORKING_COPY_CONFLICT"});assert.deepEqual(await readFile(target.exactSourcePath),before);
});

test("architecture rejects persisted physical comparisons including local aliases", async () => {
  const { parseModule, persistentFileIdentityComparisons } = await import("../scripts/architecture-ast-query.mjs");
  for (const source of [
    "sameFileIdentity(member.fileIdentity, copyFileIdentity(stat))",
    "const stored = member.fileIdentity; const saved = stored; sameFileIdentity(saved, current)",
    "const { fileIdentity: old } = member; sameFileIdentity(old, current)",
    "import { sameFileIdentity as equal } from './path-safety.mjs'; equal(record['rootFileIdentity'], current)",
  ]) assert.ok(persistentFileIdentityComparisons(parseModule("example.mjs",source)).length);
  assert.equal(persistentFileIdentityComparisons(parseModule("example.mjs","sameFileIdentity(copyFileIdentity(anchor.information), copyFileIdentity(current))")).length,0);
});

test("replacement after the final Hash check is preserved instead of overwritten",async(t)=>{
 const value=await fixture(t);const {target}=await importSource(value);const external=html("late external replacement");
 const writer=new ProjectFileRepository({projectsRoot:value.projects,failpoint:async(name)=>{
   if(name==="save-before-publication"){await writeFile(`${target.exactSourcePath}.external`,external);await rename(`${target.exactSourcePath}.external`,target.exactSourcePath);}return false;
 }});
 await assert.rejects(writer.saveWorkingCopy({target,html:html("must not overwrite"),expectedSourceSha256:target.sourceSha256,editRevision:1}),{code:"WORKING_COPY_CONFLICT"});
 assert.equal(await readFile(target.exactSourcePath,"utf8"),external);
});


test("registered projection resolves the stable current identity after adoption", async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  await value.repository.createCandidate({ target, requestId: "req_binding_projection", candidateId: "candidate_binding_projection", html: html("v2"), expectedSourceSha256: target.sourceSha256 });
  const promoted = await value.repository.promoteCandidate({ target, candidateId: "candidate_binding_projection", decisionOperationId: "promote_candidate_binding_projection" });
  const exact = await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId, workingCopyId: target.workingCopyId });
  assert.equal(exact.target.workingCopyId, target.workingCopyId);
  assert.equal(exact.html, await readFile(target.exactSourcePath, "utf8"));
  assert.equal((await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId })).target.workingCopyId, promoted.target.workingCopyId);
  await assert.rejects(value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId, workingCopyId: "../escape" }));
});

for (const [readNumber, sameBytes] of [[1, true], [1, false], [2, true]]) {
  test(`renamed binding rejects replacement before read ${readNumber} with ${sameBytes ? "same" : "different"} bytes`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const manifestPath = path.join(target.projectRootPath, ".stemmio", "manifest.json");
    const manifestBefore = await readFile(manifestPath);
    const bindingPath = sourceBindingPath(target.projectRootPath, target.workingCopyId);
    const bindingBefore = await lstat(bindingPath);
    const renamed = path.join(target.projectRootPath, "renamed.html");
    await rename(target.exactSourcePath, renamed);
    const replacement = path.join(target.projectRootPath, "replacement.tmp");
    const bytes = sameBytes ? await readFile(renamed) : Buffer.from(html("unregistered replacement"));
    await writeFile(replacement, bytes);
    const original = { open: filesystem.open, lstat: filesystem.lstat };
    let replaced = false;
    filesystem.lstat = async (filePath, ...options) => {
      const information = await original.lstat(filePath, ...options);
      const stack = new Error().stack || "";
      if (readNumber === 1 && !replaced && String(filePath) === renamed
        && stack.includes("findBoundSource") && stack.split("\n")[2]?.includes("regularInformation")) {
        await rename(replacement, renamed); replaced = true;
      }
      return information;
    };
    filesystem.open = async (filePath, ...options) => {
      const handle = await original.open(filePath, ...options);
      if (readNumber === 2 && !replaced && String(filePath) === renamed) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          if (!replaced) { await rename(replacement, renamed); replaced = true; }
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId }),
        { code: "WORKING_COPY_CONFLICT" });
    } finally { Object.assign(filesystem, original); syncBuiltinESMExports(); }
    assert.equal(replaced, true);
    assert.deepEqual(await readFile(manifestPath), manifestBefore);
    assert.equal((await lstat(bindingPath)).ino, bindingBefore.ino);
    assert.deepEqual(await readFile(renamed), bytes);
  });
}

for (const collision of ["occupied-copy", "occupied-link", "replaced-link"]) {
  test(`restore rejects ${collision} without adopting the occupied file`, async (t) => {
    const value = await fixture(t); const { target } = await importSource(value);
    const bindingPath = sourceBindingPath(target.projectRootPath, target.workingCopyId);
    const bindingBefore = await lstat(bindingPath);
    const bytes = await readFile(target.exactSourcePath);
    const manifestPath = path.join(target.projectRootPath, ".stemmio", "manifest.json");
    const manifestBefore = await readFile(manifestPath);
    await rm(target.exactSourcePath);
    const originalLink = filesystem.link;
    let injected = false;
    filesystem.link = async (source, destination) => {
      if (!injected && String(source) === bindingPath && String(destination) === target.exactSourcePath) {
        injected = true;
        if (collision === "occupied-copy") await writeFile(destination, bytes);
        if (collision === "occupied-link") await originalLink(source, destination);
        if (collision === "replaced-link") {
          await originalLink(source, destination);
          const temporary = `${destination}.replacement`;
          await writeFile(temporary, bytes); await rename(temporary, destination);
          return;
        }
      }
      return originalLink(source, destination);
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(value.repository.restoreRegisteredWorkingCopy({ projectId: target.projectId }),
        { code: "WORKING_COPY_CONFLICT" });
    } finally { filesystem.link = originalLink; syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.deepEqual(await readFile(manifestPath), manifestBefore);
    assert.equal((await lstat(bindingPath)).ino, bindingBefore.ino);
    assert.deepEqual(await readFile(target.exactSourcePath), bytes);
  });
}
