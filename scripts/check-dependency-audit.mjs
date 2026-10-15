#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePackagedSourceRuntimeClosure,
  managedRuntimeModules,
} from "./packaged-runtime-closure.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

export const acceptedAdvisories = Object.freeze({
  1122144: Object.freeze({
    url: "https://github.com/advisories/GHSA-fgmj-fm8m-jvvx",
    expiresOn: "2026-11-28",
  }),
  1240991: Object.freeze({
    url: "https://github.com/advisories/GHSA-ch52-4w7c-c8xp",
    expiresOn: "2026-10-29",
  }),
  1240992: Object.freeze({
    url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    expiresOn: "2026-10-29",
  }),
  1241202: Object.freeze({
    url: "https://github.com/advisories/GHSA-hp3w-g68c-fv3c",
    expiresOn: "2026-10-29",
  }),
});

export function evaluateAuditReport(report, {
  allowlist = acceptedAdvisories,
  now = new Date(),
} = {}) {
  if (!report || typeof report !== "object" || report.error) {
    throw new Error(`npm audit did not return a usable report${report?.error?.summary ? `: ${report.error.summary}` : "."}`);
  }
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (via && typeof via === "object" && Number.isInteger(via.source)) {
        advisories.set(String(via.source), via);
      }
    }
  }
  const unexpected = [...advisories.entries()]
    .filter(([source]) => !allowlist[source])
    .map(([, advisory]) => advisory);
  const expired = [...advisories.keys()]
    .filter((source) => allowlist[source])
    .filter((source) => now >= new Date(`${allowlist[source].expiresOn}T00:00:00.000Z`))
    .map((source) => ({ source, ...allowlist[source] }));
  return Object.freeze({
    advisories: [...advisories.values()],
    unexpected,
    expired,
    passed: unexpected.length === 0 && expired.length === 0,
  });
}

export function evaluatePackagedRuntimeClosure(packageJson, packageLock, options = {}) {
  if (
    !packageJson
    || typeof packageJson !== "object"
    || !packageLock
    || typeof packageLock !== "object"
    || !packageLock.packages
    || typeof packageLock.packages !== "object"
  ) {
    throw new Error("Package manifest and lockfile are required.");
  }
  const managedModules = managedRuntimeModules(packageJson, options);
  const missingPackages = [];
  const missingResources = [];
  const nestedPackages = [];
  for (const moduleName of managedModules) {
    const packagePath = `node_modules/${moduleName}`;
    const lockedPackage = packageLock.packages[packagePath];
    if (!lockedPackage) {
      missingPackages.push(packagePath);
      continue;
    }
    for (const dependencyName of Object.keys(lockedPackage.dependencies || {})) {
      const dependencyPath = `node_modules/${dependencyName}`;
      if (!packageLock.packages[dependencyPath]) {
        missingPackages.push(dependencyPath);
      } else if (!managedModules.has(dependencyName)) {
        missingResources.push(`${moduleName} -> ${dependencyName}`);
      }
    }
    const nestedPrefix = `${packagePath}/node_modules/`;
    for (const lockedPath of Object.keys(packageLock.packages)) {
      if (lockedPath.startsWith(nestedPrefix)) {
        nestedPackages.push(lockedPath);
      }
    }
  }
  return Object.freeze({
    managedModules: Object.freeze([...managedModules].sort()),
    missingPackages: Object.freeze([...new Set(missingPackages)].sort()),
    missingResources: Object.freeze([...new Set(missingResources)].sort()),
    nestedPackages: Object.freeze([...new Set(nestedPackages)].sort()),
    passed: (
      missingPackages.length === 0
      && missingResources.length === 0
      && nestedPackages.length === 0
    ),
  });
}

function runAudit() {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: productRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(`Unable to parse npm audit output: ${result.stderr.trim()}`, { cause });
  }
}

export function lockfileFingerprint(packageLockText) {
  return createHash("sha256").update(String(packageLockText || ""), "utf8").digest("hex");
}

export function createDependencyAuditSnapshot({
  packageLockText,
  packageJsonText,
  now = new Date(),
}) {
  return Object.freeze({
    schemaVersion: 1,
    lockfileSha256: lockfileFingerprint(packageLockText),
    packageJsonSha256: lockfileFingerprint(packageJsonText),
    createdAt: now instanceof Date ? now.toISOString() : String(now),
  });
}

export function verifyDependencyAuditSnapshot(snapshot, { packageLockText, packageJsonText }) {
  if (!snapshot || snapshot.schemaVersion !== 1) {
    throw new Error("Dependency audit snapshot schema is unsupported.");
  }
  const expected = createDependencyAuditSnapshot({ packageLockText, packageJsonText });
  if (snapshot.lockfileSha256 !== expected.lockfileSha256) {
    throw new Error("package-lock.json changed after the baseline dependency audit.");
  }
  if (snapshot.packageJsonSha256 !== expected.packageJsonSha256) {
    throw new Error("package.json changed after the baseline dependency audit.");
  }
  return true;
}

function parseAuditArgs(argv) {
  const options = { writeSnapshot: "", verifySnapshot: "" };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--write-snapshot") options.writeSnapshot = value;
    else if (argument === "--verify-snapshot") options.verifySnapshot = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseAuditArgs(argv);
  const packageJsonPath = path.join(productRoot, "package.json");
  const packageLockPath = path.join(productRoot, "package-lock.json");
  const packageJsonText = readFileSync(packageJsonPath, "utf8");
  const packageLockText = readFileSync(packageLockPath, "utf8");
  if (options.verifySnapshot) {
    const snapshot = JSON.parse(readFileSync(path.resolve(productRoot, options.verifySnapshot), "utf8"));
    verifyDependencyAuditSnapshot(snapshot, { packageLockText, packageJsonText });
    console.log("Dependency audit snapshot matches the current lockfile and package.json.");
    return;
  }
  const packageJson = JSON.parse(packageJsonText);
  const packageLock = JSON.parse(packageLockText);
  const runtimeClosure = evaluatePackagedRuntimeClosure(
    packageJson,
    packageLock,
  );
  const sourceRuntimeClosure = evaluatePackagedSourceRuntimeClosure(
    productRoot,
    packageJson,
    packageLock,
  );
  if (!runtimeClosure.passed) {
    throw new Error(
      [
        runtimeClosure.missingPackages.length > 0
          && `Packaged runtime modules missing from lockfile: ${runtimeClosure.missingPackages.join(", ")}.`,
        runtimeClosure.missingResources.length > 0
          && `Packaged runtime dependencies missing from extraResources: ${runtimeClosure.missingResources.join(", ")}.`,
        runtimeClosure.nestedPackages.length > 0
          && `Packaged runtime dependencies must be hoisted: ${runtimeClosure.nestedPackages.join(", ")}.`,
      ].filter(Boolean).join("\n"),
    );
  }
  if (!sourceRuntimeClosure.passed) {
    throw new Error(
      [
        sourceRuntimeClosure.undeclaredDirectModules.length > 0
          && `Packaged application imports undeclared runtime modules: ${sourceRuntimeClosure.undeclaredDirectModules.join(", ")}.`,
        sourceRuntimeClosure.missingPackages.length > 0
          && `Imported packaged runtime modules are missing from the lockfile: ${sourceRuntimeClosure.missingPackages.join(", ")}.`,
        sourceRuntimeClosure.missingResources.length > 0
          && `Imported packaged runtime modules are missing from extraResources: ${sourceRuntimeClosure.missingResources.join(", ")}.`,
        sourceRuntimeClosure.unexpectedResources.length > 0
          && `Packaged runtime modules are not reachable from application imports: ${sourceRuntimeClosure.unexpectedResources.join(", ")}.`,
      ].filter(Boolean).join("\n"),
    );
  }
  const evaluation = evaluateAuditReport(runAudit());
  for (const advisory of evaluation.advisories) {
    const accepted = acceptedAdvisories[String(advisory.source)];
    console.log(
      `Known advisory ${advisory.url} (${advisory.severity}); review by ${accepted?.expiresOn || "now"}.`,
    );
  }
  if (!evaluation.passed) {
    const unexpected = evaluation.unexpected.map((item) => item.url || item.source).join(", ");
    const expired = evaluation.expired.map((item) => `${item.url} expired ${item.expiresOn}`).join(", ");
    throw new Error(
      [
        unexpected && `Unreviewed dependency advisories: ${unexpected}`,
        expired && `Dependency exceptions require review: ${expired}`,
      ].filter(Boolean).join("\n"),
    );
  }
  if (options.writeSnapshot) {
    const destination = path.resolve(productRoot, options.writeSnapshot);
    if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
      throw new Error("--write-snapshot must remain inside the repository.");
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(
      destination,
      `${JSON.stringify(createDependencyAuditSnapshot({ packageLockText, packageJsonText }), null, 2)}\n`,
      "utf8",
    );
    console.log(`Dependency audit snapshot: ${destination}`);
  }
  console.log(
    `Dependency audit policy passed; ${sourceRuntimeClosure.directModules.length} direct application module(s) expand to ${runtimeClosure.managedModules.length} packaged runtime module(s) in one source-derived hoisted closure, with no unreviewed advisory present.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
