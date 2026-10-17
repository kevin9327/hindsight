import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitsSince } from "./git";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function run(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

describe("commitsSince in a partial clone (#5606)", () => {
  it.skipIf(process.platform === "win32")("does not lazily fetch a commit missing from the local clone", () => {
    dir = mkdtempSync(join(tmpdir(), "hs-partial-"));
    const origin = join(dir, "origin");
    run(dir, "init", "-q", origin);
    run(origin, "config", "uploadpack.allowFilter", "true");
    run(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    run(origin, "commit", "-q", "--allow-empty", "-m", "base");
    const clone = join(dir, "clone");
    run(dir, "clone", "-q", "--filter=blob:none", `file://${origin}`, clone);
    // A commit that exists only on the promisor remote, never fetched into the clone.
    run(origin, "commit", "-q", "--allow-empty", "-m", "unfetched");
    const missing = run(origin, "rev-parse", "HEAD");

    // Record any upload-pack the clone starts against its promisor remote.
    const marker = join(dir, "lazy-fetch-happened");
    const uploadPack = join(dir, "upload-pack.sh");
    writeFileSync(uploadPack, `#!/bin/sh\ntouch '${marker}'\nexec git-upload-pack "$@"\n`);
    chmodSync(uploadPack, 0o755);
    run(clone, "config", "remote.origin.uploadpack", uploadPack);

    expect(commitsSince(clone, missing)).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it("still counts commits for a baseline the clone has", () => {
    dir = mkdtempSync(join(tmpdir(), "hs-partial-"));
    run(dir, "init", "-q", "repo");
    const repo = join(dir, "repo");
    run(repo, "commit", "-q", "--allow-empty", "-m", "a");
    const base = run(repo, "rev-parse", "HEAD");
    run(repo, "commit", "-q", "--allow-empty", "-m", "b");
    expect(commitsSince(repo, base)).toBe(1);
  });
});
