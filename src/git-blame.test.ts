import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { analyzeFileBlame, parseChangedLines } from "./git-blame";

describe("parseChangedLines", () => {
  it("reports the base side line numbers of a hunk", () => {
    const patch = ["@@ -10,4 +10,4 @@", " a", "-b", "+B", " c"].join("\n");

    expect(parseChangedLines(patch)).toEqual([11]);
  });

  it("walks past consecutive removals", () => {
    const patch = ["@@ -1,4 +1,2 @@", " a", "-b", "-c", " d"].join("\n");

    expect(parseChangedLines(patch)).toEqual([2, 3]);
  });

  it("ignores the no newline marker", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      " a",
      "-b",
      "\\ No newline at end of file",
      "+B",
    ].join("\n");

    expect(parseChangedLines(patch)).toEqual([2]);
  });
});

/**
 * Filenames come from the pull request, so they are attacker controlled. Under
 * `pull_request_target` the job holds a writable token, which makes shelling
 * out with an interpolated filename a remote code execution vector.
 */
describe("analyzeFileBlame", () => {
  const cwd = process.cwd();
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  const commitBase = () => {
    fs.writeFileSync(path.join(repo, "victim.txt"), "a\nb\nc\n");
    git("add", "victim.txt");
    git("commit", "--quiet", "-m", "base");
    return git("rev-parse", "HEAD").trim();
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "blame-test-"));
    git("init", "--quiet", "--initial-branch=main", ".");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("does not run commands hidden in a filename", async () => {
    const base = commitBase();

    const blame = await analyzeFileBlame(
      {
        filename: "harmless$(touch PWNED)x.txt",
        status: "added",
        patch: "@@ -0,0 +1 @@\n+payload",
      },
      { baseRef: base },
    );

    expect(fs.existsSync(path.join(repo, "PWNED"))).toBe(false);
    // A file that did not exist at the base ref has no blame to attribute.
    expect(blame.size).toBe(0);
  });

  it("attributes changed lines to the commit that wrote them", async () => {
    const base = commitBase();

    const blame = await analyzeFileBlame(
      {
        filename: "victim.txt",
        status: "modified",
        patch: ["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n"),
      },
      { baseRef: base },
    );

    expect([...blame.entries()]).toEqual([[base, 1]]);
  });

  it("skips files the API returned no patch for", async () => {
    const base = commitBase();

    const blame = await analyzeFileBlame(
      { filename: "victim.txt", status: "modified" },
      { baseRef: base },
    );

    expect(blame.size).toBe(0);
  });
});
