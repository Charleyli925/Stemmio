#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expectedBuildInfo, assertBuildInfo, buildInfoRelativePath } from "./release-provenance.mjs";
import { expectedArtifactLayout } from "./verify-packaged-artifact.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArchitecture(argv) {
  if (argv.length !== 2 || argv[0] !== "--arch" || !/^(?:arm64|x64)$/u.test(argv[1])) {
    throw new Error("Usage: node scripts/create-release-assets.mjs --arch <arm64|x64>");
  }
  return argv[1];
}

async function main() {
  const architecture = parseArchitecture(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(path.join(productRoot, "package.json"), "utf8"));
  const layout = expectedArtifactLayout({ productRoot, packageJson, arch: architecture });
  const expected = await expectedBuildInfo({ productRoot, architecture, requireClean: true });
  assertBuildInfo(
    JSON.parse(await readFile(path.join(productRoot, buildInfoRelativePath), "utf8")),
    expected,
  );
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${packageJson.version}`) {
    throw new Error(`Tag ${process.env.GITHUB_REF_NAME} does not match package version ${packageJson.version}.`);
  }

  await Promise.all([
    copyFile(
      path.join(productRoot, buildInfoRelativePath),
      path.join(layout.releaseDirectory, "build-info.json"),
    ),
  ]);
  const checksumPaths = [
    layout.dmgPath,
    layout.zipPath,
    layout.blockmapPath,
    layout.updateInfoPath,
    path.join(layout.releaseDirectory, "build-info.json"),
  ];
  const checksumEntries = await Promise.all(checksumPaths.map(async (filePath) => ({
    name: path.basename(filePath),
    checksum: createHash("sha256").update(await readFile(filePath)).digest("hex"),
  })));
  checksumEntries.sort((left, right) => left.name.localeCompare(right.name));
  await writeFile(
    path.join(layout.releaseDirectory, "SHA256SUMS.txt"),
    `${checksumEntries.map((entry) => `${entry.checksum}  ${entry.name}`).join("\n")}\n`,
    "utf8",
  );
  console.log(`Release assets created in ${layout.releaseDirectory}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
