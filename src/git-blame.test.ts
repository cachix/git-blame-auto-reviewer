import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { analyzeFileBlame } from "./git-blame";

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
    fs.writeFileSync(path.join(repo, "victim.txt"), "a\nb\nc\n");
    git("add", "victim.txt");
    git("commit", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();

    const payload = "harmless$(touch PWNED)x.txt";
    fs.writeFileSync(path.join(repo, payload), "");
    git("add", "--", payload);
    git("commit", "--quiet", "-m", "pr");
    const head = git("rev-parse", "HEAD").trim();

    const blame = await analyzeFileBlame(
      { filename: payload, status: "added" },
      { baseRef: base, headRef: head },
    );

    expect(fs.existsSync(path.join(repo, "PWNED"))).toBe(false);
    // A file that did not exist at the base ref has no blame to attribute.
    expect(blame.size).toBe(0);
  });

  it("attributes changed lines to the commit that wrote them", async () => {
    fs.writeFileSync(path.join(repo, "victim.txt"), "a\nb\nc\n");
    git("add", "victim.txt");
    git("commit", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();

    fs.writeFileSync(path.join(repo, "victim.txt"), "a\nB\nc\n");
    git("commit", "--quiet", "-am", "pr");
    const head = git("rev-parse", "HEAD").trim();

    const blame = await analyzeFileBlame(
      { filename: "victim.txt", status: "modified" },
      { baseRef: base, headRef: head },
    );

    expect([...blame.keys()]).toEqual([base]);
  });
});
