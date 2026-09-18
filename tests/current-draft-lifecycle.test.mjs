import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectFileRepository } from '../bridge/project-file-repository.mjs';
import { sha256 } from '../bridge/lifecycle-core.mjs';
import { fixture, html, importSource, json, promoteNextVersion } from './project-file-repository-harness.mjs';
const manifestPath = (t) => path.join(t.projectRootPath, '.stemmio/manifest.json');
const statePath = (t) => path.join(t.projectRootPath, '.stemmio/working-copies', t.workingCopyId + '.json');
const current = async (v, t) => (await v.repository.resolveRegisteredProjectOpenTarget({ projectId: t.projectId })).target;

async function replacementProofFixture(t, { attachment = false } = {}) {
  const value = await fixture(t);
  const { target: before } = await importSource(value);
  const original = await readFile(before.exactSourcePath, 'utf8');
  if (attachment) {
    const relativePath = 'draft/attachments/comment_proof/attachment_proof-file.txt';
    const bytes = Buffer.from('preserved proof attachment');
    await mkdir(path.dirname(path.join(before.projectRootPath, relativePath)), { recursive: true });
    await writeFile(path.join(before.projectRootPath, relativePath), bytes);
    await value.repository.saveDraft({ target: before, operationId: 'draftop_replacement_proof_01', expectedDraftRevision: 0,
      comments: [{ id: 'comment_proof', body: 'preserve', attachments: [{ attachmentId: 'attachment_proof',
        commentId: 'comment_proof', fileName: 'file.txt', relativePath, sha256: sha256(bytes), byteLength: bytes.length }] }],
      changeEvents: [], deletedCommentIds: [] });
  }
  const target = await promoteNextVersion(value.repository, before, 'replacement_proof_next');
  const version = (await json(manifestPath(target))).versions.at(-1);
  const transactionPath = path.join(target.projectRootPath, '.stemmio/transactions', `current_${version.sourceOperationId}`, 'transaction.json');
  const preserved = (await value.repository.listPreservedDrafts({ projectId: target.projectId }))[0];
  const preservedRoot = path.join(target.projectRootPath, '.stemmio/recovery/preserved-drafts', preserved.recoveryId);
  const journal = { projectId: before.projectId, documentId: before.documentId, workingCopyId: before.workingCopyId,
    sourcePath: before.exactSourcePath, expectedSourceSha256: before.sourceSha256, recoveryHtmlSha256: sha256(Buffer.from(original)),
    journalSha256: sha256(Buffer.from('verified Main journal')), revision: 0, html: original, changeEvents: [] };
  return { value, before, target, journal, transactionPath, preservedRoot, preserved, version };
}

test('replacement proof verifies completed preservation across later snapshots and rename without writes', async (t) => {
  const f = await replacementProofFixture(t, { attachment: true });
  const files = [manifestPath(f.target), f.target.exactSourcePath, f.transactionPath,
    path.join(f.preservedRoot, 'record.json'), path.join(f.value.projects, '.stemmio-registry.json')];
  const beforeBytes = await Promise.all(files.map((file) => readFile(file)));
  const result = await f.value.repository.verifyReplacedCurrentDraft({ target: f.target, journal: f.journal });
  assert.deepEqual(result, { verified: true, proof: { projectId: f.target.projectId, documentId: f.target.documentId,
    workingCopyId: f.target.workingCopyId, currentVersionId: 'ver_0002', currentSourcePath: f.target.exactSourcePath,
    currentSourceSha256: f.target.sourceSha256, replacementVersionId: 'ver_0002', operationId: f.version.sourceOperationId,
    preservedRecoveryId: f.preserved.recoveryId, replacedSourceSha256: f.journal.recoveryHtmlSha256,
    journalSha256: f.journal.journalSha256, journalRevision: f.journal.revision } });
  assert.deepEqual(await Promise.all(files.map((file) => readFile(file))), beforeBytes);
  await f.value.repository.saveWorkingCopy({ target: f.target, expectedSourceSha256: f.target.sourceSha256, html: html('later local edit'), editRevision: 1 });
  const edited = await current(f.value, f.target);
  await f.value.repository.createVersionFromCurrent({ target: edited, operationId: 'proof_later_snapshot_01', expectedSourceSha256: edited.sourceSha256 });
  const renamed = path.join(f.target.projectRootPath, 'renamed proof.html');
  await rename(f.target.exactSourcePath, renamed);
  const target = (await f.value.repository.workspace({ sourcePath: renamed })).target;
  const later = await f.value.repository.verifyReplacedCurrentDraft({ target, journal: f.journal });
  assert.equal(later.verified, true);
  assert.equal(later.proof.currentVersionId, 'ver_0003');
  assert.equal(later.proof.replacementVersionId, 'ver_0002');
  assert.equal(later.proof.currentSourcePath, renamed);
  assert.equal(await readFile(renamed, 'utf8'), html('later local edit'));
});

test('replacement proof rejects other owners, stale current, new HTML and unpreserved events', async (t) => {
  const f = await replacementProofFixture(t);
  const mutations = [
    { journal: { ...f.journal, projectId: 'project_1111111111111111' } },
    { journal: { ...f.journal, documentId: 'doc_1111111111111111' } },
    { journal: { ...f.journal, workingCopyId: 'work_ver_0099' } },
    { journal: { ...f.journal, html: html('unsaved new'), recoveryHtmlSha256: sha256(Buffer.from(html('unsaved new'))) } },
    { journal: { ...f.journal, expectedSourceSha256: f.target.sourceSha256 } },
    { journal: { ...f.journal, changeEvents: [{ eventId: 'new_unsaved_event' }] } },
    { target: { ...f.target, workingCopyId: 'work_ver_0099' } },
    { target: { ...f.target, sourceSha256: f.before.sourceSha256 } },
    { target: { ...f.target, versionId: f.before.versionId } },
  ];
  for (const mutation of mutations) {
    assert.deepEqual(await f.value.repository.verifyReplacedCurrentDraft({ target: f.target, journal: f.journal, ...mutation }), { verified: false });
  }
});

for (const damage of ['missing-record', 'tampered-record', 'omitted-attachment-record', 'missing-attachment', 'tampered-attachment', 'tampered-html', 'uncompleted-transaction']) {
  test(`replacement proof never authorizes recovery retirement with ${damage}`, async (t) => {
    const f = await replacementProofFixture(t, { attachment: true });
    if (damage === 'missing-record') await rm(path.join(f.preservedRoot, 'record.json'));
    if (damage === 'tampered-record') {
      const file = path.join(f.preservedRoot, 'record.json'); const record = await json(file);
      record.originalWorkingCopyId = 'work_ver_0099'; await writeFile(file, JSON.stringify(record));
    }
    if (damage === 'omitted-attachment-record') {
      const file = path.join(f.preservedRoot, 'record.json'); const record = await json(file);
      record.attachments = []; await writeFile(file, JSON.stringify(record));
    }
    const attachmentPath = path.join(f.preservedRoot, 'draft/attachments/comment_proof/attachment_proof-file.txt');
    if (damage === 'missing-attachment') await rm(attachmentPath);
    if (damage === 'tampered-attachment') await writeFile(attachmentPath, 'changed');
    if (damage === 'tampered-html') await writeFile(path.join(f.preservedRoot, 'index.html'), html('changed'));
    if (damage === 'uncompleted-transaction') {
      const transaction = await json(f.transactionPath); transaction.state = 'prepared'; await writeFile(f.transactionPath, JSON.stringify(transaction));
    }
    const source = await readFile(f.target.exactSourcePath);
    const transaction = await readFile(f.transactionPath);
    const result = await f.value.repository.verifyReplacedCurrentDraft({ target: f.target, journal: f.journal }).catch(() => ({ verified: false }));
    assert.equal(result.verified, false);
    assert.deepEqual(await readFile(f.target.exactSourcePath), source);
    assert.deepEqual(await readFile(f.transactionPath), transaction);
  });
}

test('replacement proof does not commit or trust an unfinished preserved transaction', async (t) => {
  const value = await fixture(t); const { target } = await importSource(value);
  const writer = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: (name) => name === 'current-version-prepared' });
  await assert.rejects(writer.createVersionFromHistory({ target, versionId: 'ver_0001', operationId: 'proof_uncommitted_history_01',
    expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 }));
  const journal = { projectId: target.projectId, documentId: target.documentId, workingCopyId: target.workingCopyId,
    sourcePath: target.exactSourcePath, expectedSourceSha256: target.sourceSha256, recoveryHtmlSha256: target.sourceSha256,
    journalSha256: sha256(Buffer.from('verified Main journal')), revision: 0, html: await readFile(target.exactSourcePath, 'utf8') };
  assert.deepEqual(await value.repository.verifyReplacedCurrentDraft({ target, journal }), { verified: false });
  assert.equal((await json(manifestPath(target))).versions.length, 1);
  assert.equal((await json(path.join(target.projectRootPath, '.stemmio/transactions/current_proof_uncommitted_history_01/transaction.json'))).state, 'prepared');
});

test('import has stable current filename; identity materialization alone creates no Version', async (t) => {
  const v = await fixture(t); const {target, buffer} = await importSource(v, 'page.htm', html('V1').replace(/ data-stemmio-id="[^"]*"/g, ''));
  assert.equal(path.basename(target.exactSourcePath), 'page.htm');
  const input = {target, operationId:'snapshot_no_user_edit', expectedSourceSha256:target.sourceSha256};
  const result = await v.repository.createVersionFromCurrent(input);
  assert.equal(result.status, 'unchanged'); assert.equal((await json(manifestPath(target))).versions.length, 1);
  assert.deepEqual(await readFile(path.join(target.projectRootPath,'.stemmio/versions/ver_0001/index.html')),buffer);
  assert.deepEqual(await v.repository.queryCurrentVersionCreation(input),result);
});

test('manual snapshot retains current bytes, identity, comments and revisions; retries create once',async(t)=>{
  const v=await fixture(t);const {target}=await importSource(v);
  await v.repository.saveWorkingCopy({target,html:html('edited'),expectedSourceSha256:target.sourceSha256,editRevision:3});
  const edited=await current(v,target);
  await v.repository.saveDraft({target:edited,operationId:'draftop_current_comment_01',expectedDraftRevision:0,comments:[{id:'comment_current',body:'keep'}],changeEvents:[],deletedCommentIds:[]});
  const before=await json(statePath(target));
  const input={target:edited,operationId:'snapshot_current_01',expectedSourceSha256:edited.sourceSha256};
  const result=await v.repository.createVersionFromCurrent(input);
  assert.equal(result.status,'created');assert.equal(result.versionId,'ver_0002');assert.equal(result.workingCopyId,target.workingCopyId);assert.equal(result.sourcePath,target.exactSourcePath);
  const state=await json(statePath(target));assert.equal(state.lastPersistedRevision,before.lastPersistedRevision);assert.equal(state.currentSha256,edited.sourceSha256);
  const draft=await json(path.join(target.projectRootPath,'.stemmio',state.draftRelativePath));assert.equal(draft.comments[0].body,'keep');assert.equal(draft.draftRevision,before.draftRevision);
  assert.equal((await v.repository.createVersionFromCurrent(input)).versionId,result.versionId);
  const manifest=await json(manifestPath(target));assert.equal(manifest.workingCopies.length,1);assert.equal(manifest.versions.length,2);
});

test('history replaces current; recovery restores HTML plus comments and attachments',async(t)=>{
  const v=await fixture(t);const {target}=await importSource(v);
  await v.repository.saveWorkingCopy({target,html:html('local-only'),expectedSourceSha256:target.sourceSha256,editRevision:1});const edited=await current(v,target);
  const relativePath='draft/attachments/comment_preserve/attachment_preserve-image.txt';const bytes=Buffer.from('preserved attachment');
  await mkdir(path.dirname(path.join(target.projectRootPath,relativePath)),{recursive:true});await writeFile(path.join(target.projectRootPath,relativePath),bytes);
  await v.repository.saveDraft({target:edited,operationId:'draftop_preserve_comment_01',expectedDraftRevision:0,comments:[{id:'comment_preserve',body:'unsent',attachments:[{attachmentId:'attachment_preserve',commentId:'comment_preserve',fileName:'image.txt',relativePath,sha256:sha256(bytes),byteLength:bytes.length}]}],changeEvents:[],deletedCommentIds:[]});
  const result=await v.repository.createVersionFromHistory({target:edited,operationId:'history_current_01',versionId:'ver_0001',expectedSourceSha256:edited.sourceSha256,expectedSnapshotSha256:target.sourceSha256});
  assert.equal(result.versionId,'ver_0002');assert.equal(result.workingCopyId,target.workingCopyId);assert.equal(await readFile(target.exactSourcePath,'utf8'),html('V1'));
  const records=await v.repository.listPreservedDrafts({projectId:target.projectId});assert.equal(records.length,1);assert.equal(records[0].attachmentCount,1);
  await rm(path.join(target.projectRootPath,relativePath));const now=await current(v,target);
  const beforeRestoreState=await json(statePath(target));
  await v.repository.saveDraft({target:now,operationId:'draftop_restore_newer_0001',expectedDraftRevision:beforeRestoreState.draftRevision,comments:[{id:'comment_newer',body:'newer current'}],changeEvents:[],deletedCommentIds:[]});
  const revisionBeforeRestore=(await json(statePath(target))).draftRevision;
  const restored=await v.repository.restorePreservedDraft({target:now,operationId:'restore_current_01',recoveryId:records[0].recoveryId,expectedSourceSha256:now.sourceSha256});
  assert.equal(restored.versionId,'ver_0003');assert.equal(await readFile(target.exactSourcePath,'utf8'),html('local-only'));assert.deepEqual(await readFile(path.join(target.projectRootPath,relativePath)),bytes);
  const state=await json(statePath(target));const draft=await json(path.join(target.projectRootPath,'.stemmio',state.draftRelativePath));assert.equal(draft.comments[0].body,'unsent');assert.ok(draft.draftRevision>revisionBeforeRestore);
  assert.equal((await json(manifestPath(target))).workingCopies.length,1);
});

test('AI adoption preserves replaced current and advances the same editable identity',async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);const next=await promoteNextVersion(v.repository,target,'second_version');
 assert.equal(next.workingCopyId,target.workingCopyId);assert.equal(next.exactSourcePath,target.exactSourcePath);assert.equal((await json(manifestPath(target))).workingCopies.length,1);
 assert.equal((await v.repository.listPreservedDrafts({projectId:target.projectId})).length,1);assert.equal(await readFile(target.exactSourcePath,'utf8'),html('second_version'));
});
for(const stage of ['current-version-prepared','current-version-snapshot-written','current-version-source-displaced','current-version-source-written','current-version-state-written','current-version-manifest-written','current-version-completed']){
 test('history recovers '+stage+' without duplicate Versions',async(t)=>{
  const v=await fixture(t);const {target}=await importSource(v);await v.repository.saveWorkingCopy({target,html:html('replaced'),expectedSourceSha256:target.sourceSha256,editRevision:1});const edited=await current(v,target);
  const writer=new ProjectFileRepository({projectsRoot:v.projects,failpoint:(name)=>name===stage});
  await assert.rejects(writer.createVersionFromHistory({target:edited,versionId:'ver_0001',operationId:'history_crash_recover',expectedSourceSha256:edited.sourceSha256,expectedSnapshotSha256:target.sourceSha256}));
  const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();
  const result=await restarted.queryHistoryCreation({target:edited,operationId:'history_crash_recover'});assert.equal(result.status,'created');assert.equal(result.versionId,'ver_0002');
  const manifest=await json(manifestPath(target));assert.equal(manifest.versions.length,2);assert.equal(manifest.workingCopies.length,1);assert.equal(await readFile(target.exactSourcePath,'utf8'),html('V1'));
 });
}
test('migration preserves actual older active draft and removes inactive write authority',async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);const first=await json(manifestPath(target));delete first.currentDraftSchemaVersion;await writeFile(manifestPath(target),JSON.stringify(first));
 const second=await promoteNextVersion(v.repository,target,'V2-legacy');const runtimePath=path.join(target.projectRootPath,'.stemmio/runtime-state.json');const runtime=await json(runtimePath);runtime.activeWorkingCopyId=target.workingCopyId;await writeFile(runtimePath,JSON.stringify(runtime));
 await v.repository.saveWorkingCopy({target,html:html('active-old-local'),expectedSourceSha256:target.sourceSha256,editRevision:1});
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();const opened=await restarted.resolveRegisteredProjectOpenTarget({projectId:target.projectId});
 assert.equal(opened.target.workingCopyId,target.workingCopyId);assert.equal(opened.html,html('active-old-local'));assert.equal((await json(manifestPath(target))).workingCopies.length,1);
 const records=await restarted.listPreservedDrafts({projectId:target.projectId});assert.equal(records.length,1);assert.equal((await restarted.readPreservedDraft({projectId:target.projectId,recoveryId:records[0].recoveryId})).html,html('V2-legacy'));
 await assert.rejects(restarted.saveWorkingCopy({target:second,html:html('denied'),expectedSourceSha256:second.sourceSha256}));
});
test('only confirmed absent folder is hidden; returning folder preserves identity and duplicates remain visible',async(t)=>{
 const v=await fixture(t);const a=await importSource(v,'A.html');const b=await importSource(v,'B.html');const away=path.join(v.root,'away');await rename(a.target.projectRootPath,away);
 assert.deepEqual((await v.repository.listRegisteredProjects()).map((r)=>r.projectId),[b.target.projectId]);await rename(away,a.target.projectRootPath);assert.equal((await v.repository.listRegisteredProjects()).length,2);
 await cp(a.target.projectRootPath,path.join(v.projects,'duplicate'),{recursive:true});const rows=await v.repository.listRegisteredProjects();assert.equal(rows.length,2);assert.equal(rows.find((r)=>r.projectId===a.target.projectId).sourceStatus,'duplicate');
});

test('manual save rejects active Candidate and legacy migration waits without rebinding the frozen job', async (t) => {
 const v=await fixture(t);const {target}=await importSource(v);const file=manifestPath(target);const manifest=await json(file);delete manifest.currentDraftSchemaVersion;await writeFile(file,JSON.stringify(manifest));
 const candidateId='candidate_migration_pending_0001';await v.repository.createCandidate({target,requestId:'req_migration_pending_0001',candidateId,html:html('next'),expectedSourceSha256:target.sourceSha256});
 const runtimePath=path.join(target.projectRootPath,'.stemmio/runtime-state.json');const runtime=await json(runtimePath);
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();
 assert.equal((await json(file)).currentDraftSchemaVersion,undefined);assert.deepEqual((await json(runtimePath)).activeRequest,runtime.activeRequest);
 await assert.rejects(restarted.createVersionFromCurrent({target,operationId:'manual_pending_0001',expectedSourceSha256:target.sourceSha256}),{code:'HISTORY_CREATION_RUN_LOCKED'});
 const adopted=await restarted.promoteCandidate({target,candidateId,decisionOperationId:`promote_${candidateId}`});const current=await restarted.resolveRegisteredProjectOpenTarget({projectId:target.projectId});
 assert.equal(current.target.workingCopyId,adopted.target.workingCopyId);assert.equal((await json(file)).workingCopies.length,1);
});

test('migration ignores initial Stable ID materialization when deciding whether a local Version is needed',async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v,'legacy.html',html('V1').replace(/ data-stemmio-id="[^"]*"/g,''));
 const manifest=await json(manifestPath(target));delete manifest.currentDraftSchemaVersion;await writeFile(manifestPath(target),JSON.stringify(manifest));
 const state=await json(statePath(target));delete state.snapshotBaselineSha256;await writeFile(statePath(target),JSON.stringify(state));
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();
 assert.equal((await restarted.createVersionFromCurrent({target,operationId:'legacy_no_user_edit',expectedSourceSha256:target.sourceSha256})).status,'unchanged');
});

for(const marker of ['2.0.0',null,'multiple'])test('unsupported or inconsistent current marker is rejected: '+marker,async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);const file=manifestPath(target);const manifest=await json(file);
 if(marker==='multiple')manifest.workingCopies.push({...manifest.workingCopies[0],workingCopyId:'work_ver_0002',sourceRelativePath:'another.html',stateRelativePath:'working-copies/work_ver_0002.json'});else manifest.currentDraftSchemaVersion=marker;
 const bytes=JSON.stringify(manifest);await writeFile(file,bytes);const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();
 await assert.rejects(restarted.resolveRegisteredProjectOpenTarget({projectId:target.projectId}));assert.equal(await readFile(file,'utf8'),bytes);
 assert.equal((await restarted.listRegisteredProjects()).length,1);
});

for(const stage of ['current-version-before-publication','current-version-state-written'])test('external change at '+stage+' is retained and leaves a reusable Version ordinal',async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);await v.repository.saveWorkingCopy({target,html:html('local'),expectedSourceSha256:target.sourceSha256});const active=await current(v,target);
 const writer=new ProjectFileRepository({projectsRoot:v.projects,failpoint:async(name)=>{if(name===stage)await writeFile(target.exactSourcePath,html('external'));return false;}});
 const input={target:active,operationId:'external_conflict_0001',versionId:'ver_0001',expectedSourceSha256:active.sourceSha256,expectedSnapshotSha256:target.sourceSha256};
 await assert.rejects(writer.createVersionFromHistory(input),{code:'WORKING_COPY_CONFLICT'});
 assert.equal(await readFile(target.exactSourcePath,'utf8'),html('external'));
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();assert.equal((await restarted.queryHistoryCreation(input)).status,'not-created');assert.equal((await json(manifestPath(target))).versions.length,1);
 await restarted.forceUnlockWorkingCopy({projectId:target.projectId,documentId:target.documentId,sourcePath:target.exactSourcePath,operationId:'force_unlock_external_conflict_01',expectedSourceSha256:sha256(Buffer.from(html('external')))});const recovered=(await restarted.resolveRegisteredProjectOpenTarget({projectId:target.projectId})).target;
 const saved=await restarted.createVersionFromCurrent({target:recovered,operationId:'after_external_conflict_01',expectedSourceSha256:recovered.sourceSha256});assert.equal(saved.versionId,'ver_0002');
});

for(const stage of ['before-operation','current-version-source-written'])test('missing current never recreates the old path: '+stage,async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);let repository=v.repository;
 const input={target,operationId:'missing_current_0001',versionId:'ver_0001',expectedSourceSha256:target.sourceSha256,expectedSnapshotSha256:target.sourceSha256};
 if(stage==='before-operation'){await rm(target.exactSourcePath);await assert.rejects(repository.createVersionFromHistory(input));}
 else{repository=new ProjectFileRepository({projectsRoot:v.projects,failpoint:(name)=>name===stage});await assert.rejects(repository.createVersionFromHistory(input));await rm(target.exactSourcePath);}
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();await assert.rejects(readFile(target.exactSourcePath),{code:'ENOENT'});assert.equal((await restarted.listRegisteredProjects())[0].sourceStatus,'missing');
});

test('readonly classification discovers Finder rename without rewriting Registry, manifest or source binding',async(t)=>{
 const v=await fixture(t);const imported=await importSource(v);const target=imported.target;
 const renamedHtml=path.join(target.projectRootPath,'renamed.html');await rename(target.exactSourcePath,renamedHtml);
 const renamedRoot=path.join(v.projects,'renamed-project');await rename(target.projectRootPath,renamedRoot);
 const registryFile=path.join(v.projects,'.stemmio-registry.json');const manifestFile=path.join(renamedRoot,'.stemmio/manifest.json');const bindingFile=path.join(renamedRoot,'.stemmio/source-bindings',target.workingCopyId+'.ref');
 const before=await Promise.all([registryFile,manifestFile,bindingFile].map((file)=>readFile(file)));
 const known=await v.repository.classifyOpenPath({sourcePath:imported.sourcePath});assert.equal(known.kind,'known-external');assert.equal(known.projectFacts.openTarget.exactSourcePath,path.join(renamedRoot,'renamed.html'));
 const managed=await v.repository.classifyOpenPath({sourcePath:path.join(renamedRoot,'renamed.html')});assert.equal(managed.kind,'managed-project');
 assert.deepEqual(await Promise.all([registryFile,manifestFile,bindingFile].map((file)=>readFile(file))),before);
});

test('a renamed project with a corrupt manifest stays visible instead of becoming a deletion',async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);const moved=path.join(v.projects,'corrupt-renamed');await rename(target.projectRootPath,moved);await writeFile(path.join(moved,'.stemmio/manifest.json'),'{broken');
 const rows=await v.repository.listRegisteredProjects();assert.equal(rows.length,1);assert.equal(rows[0].projectId,target.projectId);assert.equal(rows[0].availability,'invalid');
});

for(const stage of ['current-draft-migration-preserved','current-draft-migration-committed'])test('migration resumes '+stage+' with all inactive HTML and comment drafts intact',async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);const before=await json(manifestPath(target));delete before.currentDraftSchemaVersion;await writeFile(manifestPath(target),JSON.stringify(before));
 await v.repository.saveDraft({target,operationId:'draftop_legacy_inactive_01',expectedDraftRevision:0,comments:[{id:'comment_inactive',body:'inactive local requirements'}],changeEvents:[],deletedCommentIds:[]});
 const active=await promoteNextVersion(v.repository,target,'legacy_migration_next');
 const interrupted=new ProjectFileRepository({projectsRoot:v.projects,failpoint:(name)=>name===stage});await interrupted.initialize();
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await restarted.initialize();
 const manifest=await json(manifestPath(target));assert.equal(manifest.workingCopies.length,1);assert.equal(manifest.workingCopies[0].workingCopyId,active.workingCopyId);assert.equal(await readFile(active.exactSourcePath,'utf8'),html('legacy_migration_next'));
 const records=await restarted.listPreservedDrafts({projectId:target.projectId});assert.equal(records.length,1);const record=await restarted.readPreservedDraft({projectId:target.projectId,recoveryId:records[0].recoveryId});assert.equal(record.html,html('V1'));assert.equal(record.draft.comments[0].body,'inactive local requirements');
 await assert.rejects(readFile(target.exactSourcePath),{code:'ENOENT'});
});

for(const [field,mutate] of [
 ['current path',(transaction)=>{transaction.afterMember.sourceRelativePath='unrelated.html';}],
 ['Candidate digest',(transaction)=>{transaction.version.contentSha256='sha256:'+'f'.repeat(64);transaction.afterState.baseSha256=transaction.version.contentSha256;}],
 ['source request',(transaction)=>{transaction.version.sourceRequestId='req_unrelated';}],
 ['prior current identity',(transaction)=>{transaction.beforeMember.workingCopyId='work_ver_0999';transaction.afterMember.workingCopyId='work_ver_0999';}],
])test('current adoption recovery revalidates sealed '+field,async(t)=>{
 const v=await fixture(t);const {target}=await importSource(v);const candidateId='candidate_current_authority_0001';await v.repository.createCandidate({target,requestId:'req_current_authority_01',candidateId,html:html('next'),expectedSourceSha256:target.sourceSha256});
 const writer=new ProjectFileRepository({projectsRoot:v.projects,failpoint:(name)=>name==='current-version-prepared'});await assert.rejects(writer.promoteCandidate({target,candidateId,decisionOperationId:`promote_${candidateId}`}));
 const transactionFile=path.join(target.projectRootPath,'.stemmio/transactions','current_promote_'+candidateId,'transaction.json');const transaction=await json(transactionFile);mutate(transaction);await writeFile(transactionFile,JSON.stringify(transaction));
 const restarted=new ProjectFileRepository({projectsRoot:v.projects});await assert.rejects(restarted.recoverProject({projectRootPath:target.projectRootPath}));assert.equal(await readFile(target.exactSourcePath,'utf8'),html('V1'));assert.equal((await json(manifestPath(target))).versions.length,1);
});

test('completed adoption replay preserves a newer real Request and Candidate through restart', async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const prepare = async (active, requestId) => value.repository.prepareRequest({
    target: active, requestId, attemptId: 'attempt_001', expectedSourceSha256: active.sourceSha256,
    request: { comments: [{ commentId: 'comment_replay', text: 'Revise heading', target: { targetId: 'target_replay' }, attachments: [] }],
      targets: [{ targetId: 'target_replay' }], agentDelivery: { mode: 'clipboard' } }, prompt: 'Frozen request',
  });
  await prepare(target, 'req_adoption_replay_a');
  const first = await value.repository.completeRequest({ target, requestId: 'req_adoption_replay_a',
    attemptId: 'attempt_001', html: html('first adopted') });
  const firstInput = { target, candidateId: first.candidate.candidateId,
    expectedSourceSha256: target.sourceSha256, decisionOperationId: `promote_${first.candidate.candidateId}` };
  const adopted = await value.repository.promoteCandidate(firstInput);
  assert.equal(adopted.version.versionId, 'ver_0002');
  await prepare(adopted.target, 'req_adoption_replay_b');
  const runtimeFile = path.join(target.projectRootPath, '.stemmio/runtime-state.json');
  const processing = await readFile(runtimeFile);
  assert.equal((await value.repository.promoteCandidate(firstInput)).version.versionId, 'ver_0002');
  assert.deepEqual(await readFile(runtimeFile), processing);
  const second = await value.repository.completeRequest({ target: adopted.target, requestId: 'req_adoption_replay_b',
    attemptId: 'attempt_001', html: html('second candidate') });
  const pending = await readFile(runtimeFile);
  const sourceBefore = await readFile(adopted.target.exactSourcePath);
  const requestFile = path.join(target.projectRootPath, '.stemmio/requests/req_adoption_replay_b/request.json');
  const requestBefore = await readFile(requestFile);
  const replay = await value.repository.promoteCandidate(firstInput);
  assert.equal(replay.version.versionId, 'ver_0002');
  assert.deepEqual(await readFile(runtimeFile), pending);
  assert.deepEqual(await readFile(requestFile), requestBefore);
  assert.deepEqual(await readFile(adopted.target.exactSourcePath), sourceBefore);
  await assert.rejects(value.repository.createVersionFromCurrent({ target: adopted.target,
    operationId: 'snapshot_locked_after_replay', expectedSourceSha256: adopted.target.sourceSha256 }), { code: 'HISTORY_CREATION_RUN_LOCKED' });
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  assert.equal((await json(runtimeFile)).activeCandidateId, second.candidate.candidateId);
  await restarted.promoteCandidate(firstInput);
  assert.deepEqual(await readFile(runtimeFile), pending);
  const next = await restarted.promoteCandidate({ target: adopted.target, candidateId: second.candidate.candidateId,
    expectedSourceSha256: adopted.target.sourceSha256,
    decisionOperationId: `promote_${second.candidate.candidateId}` });
  assert.equal(next.version.versionId, 'ver_0003');
  const completed = await readFile(runtimeFile);
  const older = await restarted.promoteCandidate(firstInput);
  assert.equal(older.version.versionId, 'ver_0002');
  assert.equal(older.target.versionId, 'ver_0003');
  assert.deepEqual(await readFile(runtimeFile), completed);
  assert.equal(await readFile(next.target.exactSourcePath, 'utf8'), html('second candidate'));
});
