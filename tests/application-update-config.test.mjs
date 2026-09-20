import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPLICATION_UPDATE_CONFIG_SOURCE,
  expectedApplicationUpdateConfig,
  parseApplicationUpdateConfig,
  serializeApplicationUpdateConfig,
  writeApplicationUpdateConfig,
} from "../scripts/application-update-config.mjs";

function packageJson(overrides = {}) {
  return {
    name: "stemmio",
    build: {
      publish: [
        {
          provider: "github",
          owner: "Charleyli925",
          repo: "Stemmio-Releases",
          releaseType: "release",
        },
      ],
    },
    ...overrides,
  };
}

test("formal packaging generates one deterministic stable update config", async (t) => {
  const manifest = packageJson();
  const expected = {
    owner: "Charleyli925",
    repo: "Stemmio-Releases",
    provider: "github",
    releaseType: "release",
    updaterCacheDirName: "stemmio-updater",
  };
  assert.deepEqual(expectedApplicationUpdateConfig(manifest), expected);
  assert.equal(
    serializeApplicationUpdateConfig(manifest),
    [
      "owner: Charleyli925",
      "repo: Stemmio-Releases",
      "provider: github",
      "releaseType: release",
      "updaterCacheDirName: stemmio-updater",
      "",
    ].join("\n"),
  );

  const productRoot = await mkdtemp(path.join(os.tmpdir(), "stemmio-update-config-"));
  t.after(() => rm(productRoot, { recursive: true, force: true }));
  const result = await writeApplicationUpdateConfig({ productRoot, packageJson: manifest });
  assert.equal(
    result.destination,
    path.join(productRoot, APPLICATION_UPDATE_CONFIG_SOURCE),
  );
  assert.deepEqual(result.config, expected);
  assert.deepEqual(
    parseApplicationUpdateConfig(await readFile(result.destination, "utf8"), manifest),
    expected,
  );
});

test("update config fails closed when provider or embedded channel drifts", () => {
  assert.throws(
    () => expectedApplicationUpdateConfig(packageJson({
      build: { publish: [] },
    })),
    /exactly one stable update provider/u,
  );
  assert.throws(
    () => expectedApplicationUpdateConfig(packageJson({
      build: {
        publish: [{
          provider: "generic",
          owner: "Charleyli925",
          repo: "Stemmio-Releases",
          releaseType: "release",
        }],
      },
    })),
    /GitHub provider/u,
  );
  assert.throws(
    () => expectedApplicationUpdateConfig(packageJson({
      build: {
        publish: [{
          provider: "github",
          owner: "Charleyli925",
          repo: "Stemmio",
          releaseType: "release",
        }],
      },
    })),
    /reviewed public release repository/u,
  );
  assert.throws(
    () => parseApplicationUpdateConfig(
      [
        "owner: Charleyli925",
        "repo: OtherRepo",
        "provider: github",
        "releaseType: release",
        "updaterCacheDirName: stemmio-updater",
        "",
      ].join("\n"),
      packageJson(),
    ),
    /does not match the stable GitHub channel/u,
  );
  assert.throws(
    () => parseApplicationUpdateConfig(
      `${serializeApplicationUpdateConfig(packageJson())}token: secret\n`,
      packageJson(),
    ),
    /fields changed/u,
  );
});
