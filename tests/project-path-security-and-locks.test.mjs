import assert from "node:assert/strict";
import filesystem from "node:fs/promises";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  fixture,
  html,
  importSource,
  json,
  registryPath,
  currentRegistryWriteLockPath,
  seedCurrentRegistryWriteLock,
} from "./project-file-repository-harness.mjs";

function awaitSignal(signal, label, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} was not observed within ${timeoutMs}ms.`));
    }, timeoutMs);
    signal.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

test("nested and symlinked Working Copy mappings are rejected before a save can escape", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const outside = path.join(value.root, "outside");
  const externalDirectory = path.join(outside, "nested");
  const externalHtml = path.join(externalDirectory, "target.html");
  await mkdir(externalDirectory, { recursive: true });
  await writeFile(externalHtml, html("outside before"), "utf8");
  await symlink(outside, path.join(imported.target.projectRootPath, "escape"), "dir");

  const manifestPath = path.join(imported.target.projectRootPath, ".stemmio", "manifest.json");
  const manifest = await json(manifestPath);
  manifest.workingCopies[0].sourceRelativePath = "escape/nested/target.html";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: html("must stay in project"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INVALID_RELATIVE_PATH",
  );
  assert.equal(await readFile(externalHtml, "utf8"), html("outside before"));
  assert.equal(
    await readFile(imported.target.exactSourcePath, "utf8"),
    html("V1"),
  );
});

test("Registry and managed control paths reject symlinks", async (t) => {
  const rootLink = await fixture(t);
  const imported = await importSource(rootLink, "root-link.html");
  const alias = path.join(rootLink.projects, "symlinked-project");
  await symlink(imported.target.projectRootPath, alias, "dir");
  const registryPath = path.join(rootLink.projects, ".stemmio-registry.json");
  const registry = await json(registryPath);
  registry.projects[imported.target.projectId].registeredProjectRootPath = alias;
  await writeFile(registryPath, JSON.stringify(registry), "utf8");
  await assert.rejects(
    rootLink.repository.resolveOpenTarget({
      sourcePath: path.join(alias, path.basename(imported.target.exactSourcePath)),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "PATH_ESCAPES_PROJECT" || error.code === "UNSAFE_DIRECTORY"),
  );

  const controlLink = await fixture(t);
  const controlImported = await importSource(controlLink, "control-link.html");
  const controlRoot = path.join(controlImported.target.projectRootPath, ".stemmio");
  const relocatedControlRoot = path.join(controlLink.root, "relocated-control-root");
  await rename(controlRoot, relocatedControlRoot);
  await symlink(relocatedControlRoot, controlRoot, "dir");
  await assert.rejects(
    controlLink.repository.resolveOpenTarget({ sourcePath: controlImported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "PATH_ESCAPES_PROJECT" || error.code === "UNSAFE_DIRECTORY"),
  );
});

test("verified project roots are not reused across serial turns after a symlink swap", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "serial-root-cache.html");
  const first = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("after first save"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(first.versionCreated, false);

  const relocated = path.join(value.root, "relocated-serial-root");
  await rename(imported.target.projectRootPath, relocated);
  await symlink(relocated, imported.target.projectRootPath, "dir");
  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: first.target,
      html: html("after symlink swap"),
      expectedSourceSha256: first.target.sourceSha256,
      editRevision: 2,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "PATH_ESCAPES_PROJECT" || error.code === "UNSAFE_DIRECTORY"),
  );
});

test("a Registry lock released after lstat lets the waiting public acquire retry", async (t) => {
  const value = await fixture(t);
  await importSource(value, "交错基线.html");
  const firstSourcePath = path.join(value.sources, "交错持锁者.html");
  const firstBuffer = Buffer.from(html("first interleaving import"), "utf8");
  await writeFile(firstSourcePath, firstBuffer);
  const secondSourcePath = path.join(value.sources, "交错等待者.html");
  const secondBuffer = Buffer.from(html("second interleaving import"), "utf8");
  await writeFile(secondSourcePath, secondBuffer);

  let firstImportReady;
  const firstImportReadyPromise = new Promise((resolve) => {
    firstImportReady = resolve;
  });
  let releaseFirstImport;
  const releaseFirstImportPromise = new Promise((resolve) => {
    releaseFirstImport = resolve;
  });
  const firstRepository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "import-intent-recorded") {
        firstImportReady();
        await releaseFirstImportPromise;
      }
      return false;
    },
  });
  const firstImport = firstRepository.importExternal({
    sourcePath: firstSourcePath,
    expectedSourceSha256: sha256(firstBuffer),
  });
  let secondImport;
  let continueLockPathRealpath = () => {};
  let realpathPatched = false;
  const originalRealpath = filesystem.realpath;
  try {
    await awaitSignal(firstImportReadyPromise, "first import lock owner");

    const lockPath = currentRegistryWriteLockPath(value);
    let lockPathRealpathObserved;
    const lockPathRealpathObservedPromise = new Promise((resolve) => {
      lockPathRealpathObserved = resolve;
    });
    const continueLockPathRealpathPromise = new Promise((resolve) => {
      continueLockPathRealpath = resolve;
    });
    let paused = false;
    filesystem.realpath = async (target, ...options) => {
      if (!paused && String(target) === lockPath) {
        paused = true;
        lockPathRealpathObserved();
        await continueLockPathRealpathPromise;
      }
      return originalRealpath(target, ...options);
    };
    syncBuiltinESMExports();
    realpathPatched = true;

    secondImport = new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 2_000,
    }).importExternal({
      sourcePath: secondSourcePath,
      expectedSourceSha256: sha256(secondBuffer),
    });
    await awaitSignal(lockPathRealpathObservedPromise, "waiting lock realpath");
    releaseFirstImport();
    const firstResult = await firstImport;
    assert.equal(firstResult.imported, true);
    continueLockPathRealpath();
    const secondResult = await secondImport;
    assert.equal(secondResult.imported, true);
  } finally {
    releaseFirstImport();
    continueLockPathRealpath();
    await firstImport.catch(() => {});
    await secondImport?.catch(() => {});
    if (realpathPatched) {
      filesystem.realpath = originalRealpath;
      syncBuiltinESMExports();
    }
  }
});

test("a failed lock release never replaces a committed import result", async (t) => {
  const value = await fixture(t);
  const sourcePath = path.join(value.sources, "提交后释放失败.html");
  const buffer = Buffer.from(html("committed"), "utf8");
  await writeFile(sourcePath, buffer);

  let damaged = false;
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      // By this failpoint the project directory is renamed into place and the
      // Registry is published, so the import is fully committed.
      if (name === "import-registry-written" && !damaged) {
        const lockPath = currentRegistryWriteLockPath(value);
        const owner = (await readdir(lockPath)).find((entry) => entry.startsWith(".owner-"));
        if (owner) {
          await writeFile(path.join(lockPath, owner), "{ truncated", "utf8");
          damaged = true;
        }
      }
      return false;
    },
  });

  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(buffer),
  });

  assert.equal(damaged, true);
  assert.equal(imported.imported, true);
  assert.equal(
    Object.keys((await json(registryPath(value))).projects).length,
    1,
  );

  // The undamaged half of the contract: an unreleasable lock is inert, not
  // terminal, so the next import reclaims it on age instead of failing busy.
  const nextPath = path.join(value.sources, "后续导入.html");
  const nextBuffer = Buffer.from(html("next"), "utf8");
  await writeFile(nextPath, nextBuffer);
  const next = await new ProjectFileRepository({
    projectsRoot: value.projects,
    registryWriteLockTimeoutMs: 400,
    registryWriteLockGraceMs: 10_000,
    clock: () => Date.now() + 60_000,
  }).importExternal({
    sourcePath: nextPath,
    expectedSourceSha256: sha256(nextBuffer),
  });
  assert.equal(next.imported, true);
  assert.equal(
    (await readdir(value.projects)).includes(".stemmio-registry-write-lock"),
    false,
  );
});

test("a live Registry write lock fails busy; a dead lock can be retired by its exact token", async (t) => {
  const value = await fixture(t);
  await importSource(value, "锁基线.html");
  await seedCurrentRegistryWriteLock(value, process.pid);
  const busy = new ProjectFileRepository({
    projectsRoot: value.projects,
    registryWriteLockTimeoutMs: 80,
  });
  await assert.rejects(
    busy.importExternal({
      sourcePath: path.join(value.sources, "锁活进程.html"),
      expectedSourceSha256: sha256(Buffer.from(html("V1"), "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTRY_BUSY",
  );

  await rm(currentRegistryWriteLockPath(value), { recursive: true, force: true });
  await seedCurrentRegistryWriteLock(value, 2_147_483_647);
  const otherPath = path.join(value.sources, "锁死进程.html");
  const otherBuffer = Buffer.from(html("dead lock import"), "utf8");
  await writeFile(otherPath, otherBuffer);
  const imported = await new ProjectFileRepository({
    projectsRoot: value.projects,
  }).importExternal({
    sourcePath: otherPath,
    expectedSourceSha256: sha256(otherBuffer),
  });
  assert.equal(imported.imported, true);
  assert.equal(
    (await readdir(value.projects)).includes(".stemmio-registry-write-lock"),
    false,
  );
});

// An unresolvable lock directory is crash residue, not a held lock. Every shape
// below is reachable from a single interrupted process, and none of them can ever
// become resolvable again, so each must have a bounded automatic exit.
for (const shape of [
  {
    name: "an empty lock directory (crash between mkdir and the owner write)",
    seed: async () => {},
  },
  {
    name: "a doubled marker (crash between the two retire renames)",
    seed: async (lockPath) => {
      await writeFile(
        path.join(lockPath, ".owner-00000000-0000-4000-8000-00000000000a.json"),
        `${JSON.stringify({
          pid: 2_147_483_647,
          token: "00000000-0000-4000-8000-00000000000a",
          createdAt: "2026-08-16T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
      await writeFile(
        path.join(
          lockPath,
          ".retiring-00000000-0000-4000-8000-00000000000b-00000000-0000-4000-8000-00000000000b.json",
        ),
        `${JSON.stringify({
          pid: 2_147_483_647,
          token: "00000000-0000-4000-8000-00000000000b",
          createdAt: "2026-08-16T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
    },
  },
  {
    name: "a damaged owner file",
    seed: async (lockPath) => {
      await writeFile(
        path.join(lockPath, ".owner-00000000-0000-4000-8000-00000000000a.json"),
        "{ truncated",
        "utf8",
      );
    },
  },
]) {
  test(`an aged Registry write lock with ${shape.name} is reclaimed`, async (t) => {
    const value = await fixture(t);
    await importSource(value, "残留基线.html");
    const lockPath = currentRegistryWriteLockPath(value);
    await mkdir(lockPath);
    await shape.seed(lockPath);

    const sourcePath = path.join(value.sources, "残留回收.html");
    const buffer = Buffer.from(html("reclaimed"), "utf8");
    await writeFile(sourcePath, buffer);
    const imported = await new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 200,
      registryWriteLockGraceMs: 10_000,
      // The lock is inspected from a clock beyond its grace period, which is how
      // a user reaching a crashed lock minutes or days later observes it.
      clock: () => Date.now() + 60_000,
    }).importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    });

    assert.equal(imported.imported, true);
    assert.equal(
      (await readdir(value.projects)).includes(".stemmio-registry-write-lock"),
      false,
    );
    assert.equal(
      (await readdir(value.projects)).some(
        (entry) => entry.startsWith(".stemmio-lock-unresolvable-"),
      ),
      false,
    );
  });
}

test("an unresolvable Registry write lock inside its grace period still fails busy", async (t) => {
  const value = await fixture(t);
  await importSource(value, "宽限期基线.html");
  // A live owner that is mid-release or mid-retire reads back as unresolvable for
  // a moment. The grace period is what keeps that transient state from being
  // mistaken for crash residue.
  await mkdir(currentRegistryWriteLockPath(value));

  const sourcePath = path.join(value.sources, "宽限期内.html");
  const buffer = Buffer.from(html("within grace"), "utf8");
  await writeFile(sourcePath, buffer);
  await assert.rejects(
    new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 80,
      registryWriteLockGraceMs: 10_000,
    }).importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTRY_BUSY",
  );
  assert.equal(
    (await readdir(value.projects)).includes(".stemmio-registry-write-lock"),
    true,
  );
});

test("an aged lock owned by a live process is never reclaimed", async (t) => {
  const value = await fixture(t);
  await importSource(value, "活锁基线.html");
  await seedCurrentRegistryWriteLock(value, process.pid);

  const sourcePath = path.join(value.sources, "活锁不可回收.html");
  const buffer = Buffer.from(html("live owner"), "utf8");
  await writeFile(sourcePath, buffer);
  await assert.rejects(
    new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 80,
      registryWriteLockGraceMs: 0,
      clock: () => Date.now() + 86_400_000,
    }).importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTRY_BUSY",
  );
  assert.equal(
    (await readdir(value.projects)).includes(".stemmio-registry-write-lock"),
    true,
  );
});
