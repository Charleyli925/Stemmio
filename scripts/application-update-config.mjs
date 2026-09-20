import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { load as parseYaml } from "js-yaml";

export const APPLICATION_UPDATE_CONFIG_FILE = "app-update.yml";
export const APPLICATION_UPDATE_CONFIG_SOURCE =
  "output/release-metadata/app-update.yml";

const CONFIG_KEYS = [
  "owner",
  "repo",
  "provider",
  "releaseType",
  "updaterCacheDirName",
];
const REPOSITORY_COMPONENT_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const PUBLIC_RELEASES_OWNER = "Charleyli925";
const PUBLIC_RELEASES_REPOSITORY = "Stemmio-Releases";

function assertRepositoryComponent(value, label) {
  assert.match(
    value ?? "",
    REPOSITORY_COMPONENT_PATTERN,
    `${label} must be a GitHub repository component`,
  );
  return value;
}

export function expectedApplicationUpdateConfig(packageJson) {
  assert.match(
    packageJson?.name ?? "",
    PACKAGE_NAME_PATTERN,
    "package name must already be a safe lowercase updater cache name",
  );
  const publish = packageJson?.build?.publish;
  assert.ok(Array.isArray(publish), "build.publish must be an array");
  assert.equal(
    publish.length,
    1,
    "build.publish must contain exactly one stable update provider",
  );
  const [provider] = publish;
  assert.deepEqual(
    Object.keys(provider ?? {}).sort(),
    ["owner", "provider", "releaseType", "repo"],
    "build.publish must contain only the reviewed stable GitHub provider fields",
  );
  assert.equal(provider.provider, "github", "stable updates must use the GitHub provider");
  assert.equal(provider.releaseType, "release", "stable updates must use GitHub releases");
  const owner = assertRepositoryComponent(provider.owner, "build.publish owner");
  const repo = assertRepositoryComponent(provider.repo, "build.publish repo");
  assert.equal(
    owner,
    PUBLIC_RELEASES_OWNER,
    "stable updates must use the reviewed public release owner",
  );
  assert.equal(
    repo,
    PUBLIC_RELEASES_REPOSITORY,
    "stable updates must use the reviewed public release repository",
  );
  return Object.freeze({
    owner,
    repo,
    provider: "github",
    releaseType: "release",
    updaterCacheDirName: `${packageJson.name}-updater`,
  });
}

export function serializeApplicationUpdateConfig(packageJson) {
  const config = expectedApplicationUpdateConfig(packageJson);
  return `${CONFIG_KEYS.map((key) => `${key}: ${config[key]}`).join("\n")}\n`;
}

export function parseApplicationUpdateConfig(contents, packageJson) {
  const parsed = parseYaml(String(contents));
  assert.ok(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "application update config must be a YAML object",
  );
  assert.deepEqual(
    Object.keys(parsed).sort(),
    [...CONFIG_KEYS].sort(),
    "application update config fields changed",
  );
  const expected = expectedApplicationUpdateConfig(packageJson);
  assert.deepEqual(
    parsed,
    expected,
    "application update config does not match the stable GitHub channel",
  );
  return expected;
}

export async function writeApplicationUpdateConfig({ productRoot, packageJson }) {
  const destination = path.resolve(productRoot, APPLICATION_UPDATE_CONFIG_SOURCE);
  const contents = serializeApplicationUpdateConfig(packageJson);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, { encoding: "utf8", mode: 0o644 });
  return {
    config: expectedApplicationUpdateConfig(packageJson),
    destination,
  };
}
