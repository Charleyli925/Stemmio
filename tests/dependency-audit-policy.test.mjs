import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acceptedAdvisories,
  createDependencyAuditSnapshot,
  evaluateAuditReport,
  evaluatePackagedRuntimeClosure,
  verifyDependencyAuditSnapshot,
} from "../scripts/check-dependency-audit.mjs";
import {
  bareRuntimeModuleName,
  evaluatePackagedSourceRuntimeClosure,
  importedRuntimeModules,
  requiredRuntimeModuleClosure,
} from "../scripts/packaged-runtime-closure.mjs";

const dependabotConfig = await readFile(
  new URL("../.github/dependabot.yml", import.meta.url),
  "utf8",
);

function report(...advisories) {
  return {
    vulnerabilities: {
      fixture: {
        via: advisories,
      },
    },
  };
}

test("dependency audit policy accepts reviewed advisories before expiry", () => {
  const result = evaluateAuditReport(report({
    source: 1,
    url: "https://example.test/advisory-1",
    severity: "high",
  }), {
    allowlist: {
      1: { url: "https://example.test/advisory-1", expiresOn: "2026-08-31" },
    },
    now: new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(result.passed, true);
});

test("dependency audit policy rejects new and expired advisories", () => {
  const allowlist = {
    1: { url: "https://example.test/advisory-1", expiresOn: "2026-07-01" },
  };
  const result = evaluateAuditReport(report(
    { source: 1, url: "https://example.test/advisory-1", severity: "high" },
    { source: 2, url: "https://example.test/advisory-2", severity: "moderate" },
  ), {
    allowlist,
    now: new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.unexpected.map((item) => item.source), [2]);
  assert.deepEqual(result.expired.map((item) => item.source), ["1"]);
});

test("reviewed dependency exceptions retain their exact scope and expiry", () => {
  assert.deepEqual(acceptedAdvisories, {
    1122144: {
      url: "https://github.com/advisories/GHSA-fgmj-fm8m-jvvx",
      expiresOn: "2026-11-28",
    },
    1240991: {
      url: "https://github.com/advisories/GHSA-ch52-4w7c-c8xp",
      expiresOn: "2026-10-29",
    },
    1240992: {
      url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
      expiresOn: "2026-10-29",
    },
    1241202: {
      url: "https://github.com/advisories/GHSA-hp3w-g68c-fv3c",
      expiresOn: "2026-10-29",
    },
  });
});

test("the October build-tool exceptions fail closed at their review deadline", () => {
  const advisories = [1240991, 1240992, 1241202].map((source) => ({
    source,
    url: acceptedAdvisories[source].url,
    severity: "high",
  }));
  assert.equal(evaluateAuditReport(report(...advisories), {
    now: new Date("2026-10-28T23:59:59.999Z"),
  }).passed, true);
  const expired = evaluateAuditReport(report(...advisories), {
    now: new Date("2026-10-29T00:00:00.000Z"),
  });
  assert.equal(expired.passed, false);
  assert.deepEqual(expired.expired.map(({ source }) => source), [
    "1240991", "1240992", "1241202",
  ]);
});

test("temporarily excepted build tools remain development-only and outside packaged imports", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const closure = evaluatePackagedSourceRuntimeClosure(root, packageJson, packageLock);
  assert.equal(closure.passed, true);
  const resources = evaluatePackagedRuntimeClosure(packageJson, packageLock);
  for (const name of ["braces", "http-cache-semantics", "sprintf-js"]) {
    const entries = Object.entries(packageLock.packages).filter(([entry]) => (
      entry === `node_modules/${name}` || entry.endsWith(`/node_modules/${name}`)
    ));
    assert.ok(entries.length > 0, `Reassess the exception when ${name} is removed.`);
    for (const [entry, metadata] of entries) {
      assert.equal(metadata.dev, true, `${entry} must remain development-only.`);
    }
    assert.equal(closure.requiredModules.includes(name), false, `${name} must not enter packaged imports.`);
    assert.equal(resources.managedModules.includes(name), false, `${name} must not enter packaged resources.`);
  }
});

test("Dependabot keeps coupled React updates together and defers automatic majors", () => {
  assert.match(
    dependabotConfig,
    /react-stack:[\s\S]*patterns:[\s\S]*- react\n[\s\S]*- react-dom\n[\s\S]*- react-server-dom-webpack/,
  );
  assert.match(
    dependabotConfig,
    /dependency-name: "\*"[\s\S]*update-types:[\s\S]*- version-update:semver-major/,
  );
});

test("packaged runtime dependencies form one explicit hoisted closure", () => {
  const packageJson = {
    build: {
      extraResources: [
        { from: "node_modules/parse5", to: "node_modules/parse5" },
        { from: "node_modules/entities", to: "node_modules/entities" },
      ],
    },
  };
  const alignedLock = {
    packages: {
      "": {},
      "node_modules/parse5": {
        dependencies: { entities: "^8.0.0" },
      },
      "node_modules/entities": {},
    },
  };
  assert.deepEqual(
    evaluatePackagedRuntimeClosure(packageJson, alignedLock),
    {
      managedModules: ["entities", "parse5"],
      missingPackages: [],
      missingResources: [],
      nestedPackages: [],
      passed: true,
    },
  );

  const splitLock = structuredClone(alignedLock);
  splitLock.packages["node_modules/parse5/node_modules/entities"] = {};
  const split = evaluatePackagedRuntimeClosure(packageJson, splitLock);
  assert.equal(split.passed, false);
  assert.deepEqual(split.nestedPackages, [
    "node_modules/parse5/node_modules/entities",
  ]);

  const incompletePackage = structuredClone(packageJson);
  incompletePackage.build.extraResources.pop();
  const incomplete = evaluatePackagedRuntimeClosure(
    incompletePackage,
    alignedLock,
  );
  assert.equal(incomplete.passed, false);
  assert.deepEqual(incomplete.missingResources, ["parse5 -> entities"]);

  const missingLock = structuredClone(alignedLock);
  delete missingLock.packages["node_modules/entities"];
  const missing = evaluatePackagedRuntimeClosure(packageJson, missingLock);
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missingPackages, ["node_modules/entities"]);
});

test("packaged source imports derive package names and transitive peer closure", () => {
  assert.equal(bareRuntimeModuleName("@scope/parser/subpath"), "@scope/parser");
  assert.equal(bareRuntimeModuleName("node:fs/promises"), null);
  assert.equal(bareRuntimeModuleName("./local-module.mjs"), null);
  assert.deepEqual(
    importedRuntimeModules(`
      import { parse } from "acorn";
      export { value } from "parse5";
      const updater = await import("electron-updater");
      const electron = require("electron");
      const local = await import("./local-module.mjs");
    `),
    ["acorn", "electron-updater", "parse5"],
  );
  assert.deepEqual(
    requiredRuntimeModuleClosure(["@scope/runtime"], {
      packages: {
        "node_modules/@scope/runtime": {
          dependencies: { helper: "1.0.0" },
          peerDependencies: { validator: "1.0.0" },
        },
        "node_modules/helper": {},
        "node_modules/validator": {},
      },
    }),
    {
      requiredModules: ["@scope/runtime", "helper", "validator"],
      missingPackages: [],
    },
  );
});

test("packaged runtime closure resolves the selected platform and architecture macros", () => {
  const packageJson = {
    build: {
      extraResources: [{
        from: "node_modules/@openai/codex-darwin-${arch}",
        to: "node_modules/@openai/codex-darwin-${arch}",
      }],
    },
  };
  const packageLock = {
    packages: {
      "": {},
      "node_modules/@openai/codex-darwin-arm64": {},
    },
  };
  assert.deepEqual(
    evaluatePackagedRuntimeClosure(packageJson, packageLock, {
      platform: "darwin",
      arch: "arm64",
    }),
    {
      managedModules: ["@openai/codex-darwin-arm64"],
      missingPackages: [],
      missingResources: [],
      nestedPackages: [],
      passed: true,
    },
  );
});

test("a later attestation only rechecks the lockfile snapshot instead of auditing twice", () => {
  const snapshot = createDependencyAuditSnapshot({
    packageLockText: '{"lockfileVersion":3}',
    packageJsonText: '{"name":"stemmio"}',
    now: new Date("2026-09-05T00:00:00.000Z"),
  });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(
    verifyDependencyAuditSnapshot(snapshot, {
      packageLockText: '{"lockfileVersion":3}',
      packageJsonText: '{"name":"stemmio"}',
    }),
    true,
  );
  assert.throws(
    () => verifyDependencyAuditSnapshot(snapshot, {
      packageLockText: '{"lockfileVersion":2}',
      packageJsonText: '{"name":"stemmio"}',
    }),
    /package-lock\.json changed/u,
  );
});
