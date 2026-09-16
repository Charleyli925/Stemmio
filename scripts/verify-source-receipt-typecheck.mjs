import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(productRoot, "app/application/source-receipt.js");

const listed = await execFileAsync("tsc", [
  "--project",
  path.join(productRoot, "tsconfig.source-receipt.json"),
  "--listFilesOnly",
], { cwd: productRoot });
assert.ok(
  listed.stdout.split(/\r?\n/u).includes(sourcePath),
  "the SourceReceipt implementation must remain inside the checked program",
);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "stemmio-source-receipt-typecheck-"));
try {
  const applicationRoot = path.join(temporaryRoot, "app/application");
  await mkdir(applicationRoot, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(productRoot, "app/application/source-receipt-contract.d.ts"),
      path.join(applicationRoot, "source-receipt-contract.d.ts"),
    ),
    copyFile(
      path.join(productRoot, "app/application/project-session.d.ts"),
      path.join(applicationRoot, "project-session.d.ts"),
    ),
  ]);

  const source = await readFile(sourcePath, "utf8");
  const expectedLine = "sessionIncarnation: revision(input.sessionIncarnation),";
  assert.equal(
    source.split(expectedLine).length,
    2,
    "mutation proof expects exactly one SourceReceipt implementation assignment",
  );
  await writeFile(
    path.join(applicationRoot, "source-receipt.js"),
    source.replace(
      expectedLine,
      "sessionIncarnation: String(input.sessionIncarnation),",
    ),
  );

  await assert.rejects(
    execFileAsync("tsc", [
      "--noEmit",
      "--allowJs",
      "--checkJs",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      path.join(applicationRoot, "source-receipt.js"),
    ], { cwd: temporaryRoot }),
    (error) => {
      const output = `${error.stdout || ""}\n${error.stderr || ""}`;
      assert.match(output, /Type 'string' is not assignable to type 'number'/u);
      return true;
    },
    "a wrong implementation type must fail the real JavaScript check",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
