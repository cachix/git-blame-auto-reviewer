import './sourcemap-register.cjs';/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
var __webpack_exports__ = {};

var __createBinding = (undefined && undefined.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (undefined && undefined.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (undefined && undefined.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const github_api_1 = require("./github-api");
const git_blame_1 = require("./git-blame");
async function getInputs() {
    return {
        token: core.getInput("token", { required: true }),
        maxReviewers: parseInt(core.getInput("max-reviewers") || "3"),
        threshold: parseInt(core.getInput("threshold") || "20"),
        ignoreAuthors: core
            .getInput("ignore-authors")
            .split(",")
            .map((a) => a.trim())
            .filter((a) => a.length > 0),
        lookbackDays: parseInt(core.getInput("lookback-days") || "0"),
    };
}
async function run() {
    try {
        const inputs = await getInputs();
        const context = github.context;
        // Only run on pull requests
        if (!context.payload.pull_request) {
            core.warning("This action only works on pull request events");
            return;
        }
        const pullRequest = context.payload.pull_request;
        const prAuthor = pullRequest.user.login;
        const octokit = github.getOctokit(inputs.token);
        // Get changed files
        core.info("🔍 Getting changed files...");
        const changedFiles = await (0, github_api_1.getChangedFiles)(octokit, context);
        core.info(`📁 Found ${changedFiles.length} changed files`);
        // Analyze blame for each file
        core.info("🔬 Analyzing git blame for changed lines...");
        const authorCommitMap = new Map();
        const authorStatsMap = new Map();
        for (const file of changedFiles) {
            try {
                const blameData = await (0, git_blame_1.analyzeFileBlame)(file, {
                    baseRef: pullRequest.base.sha,
                    headRef: pullRequest.head.sha,
                    lookbackDays: inputs.lookbackDays,
                });
                // Aggregate stats by commit (we'll resolve to users later)
                for (const [commit, lineCount] of blameData.entries()) {
                    // Store commit -> author mapping for later resolution
                    const author = `commit:${commit}`;
                    if (!authorCommitMap.has(author)) {
                        authorCommitMap.set(author, new Set());
                    }
                    authorCommitMap.get(author).add(commit);
                    if (!authorStatsMap.has(author)) {
                        authorStatsMap.set(author, {
                            linesChanged: 0,
                            filesAffected: 0,
                            percentageOfChanges: 0,
                            commits: new Set(),
                        });
                    }
                    const stats = authorStatsMap.get(author);
                    stats.linesChanged += lineCount;
                    stats.filesAffected += 1;
                    stats.commits.add(commit);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to analyze ${file.filename}: ${errorMessage}`);
            }
        }
        // Resolve commits to GitHub users
        core.info("👤 Resolving commit authors to GitHub users...");
        const resolvedAuthors = new Map();
        const unresolvedCommits = [];
        for (const [authorKey, commits] of authorCommitMap.entries()) {
            const stats = authorStatsMap.get(authorKey);
            // Try to resolve using the first commit
            const firstCommit = Array.from(commits)[0];
            const githubUser = await (0, github_api_1.resolveCommitAuthor)(octokit, context, firstCommit);
            if (githubUser) {
                // Skip if it's the PR author
                if (githubUser === prAuthor) {
                    core.debug(`Skipping PR author: ${githubUser}`);
                    continue;
                }
                // Skip if in ignore list
                if (inputs.ignoreAuthors.includes(githubUser)) {
                    core.debug(`Skipping ignored author: ${githubUser}`);
                    continue;
                }
                // Merge stats if we already have this user
                if (resolvedAuthors.has(githubUser)) {
                    const existingStats = resolvedAuthors.get(githubUser);
                    existingStats.linesChanged += stats.linesChanged;
                    existingStats.filesAffected += stats.filesAffected;
                    stats.commits.forEach((c) => existingStats.commits.add(c));
                }
                else {
                    resolvedAuthors.set(githubUser, stats);
                }
                core.info(`✅ Resolved ${commits.size} commits to @${githubUser}`);
            }
            else {
                unresolvedCommits.push(...Array.from(commits));
            }
        }
        if (unresolvedCommits.length > 0) {
            core.warning(`⚠️  Could not resolve ${unresolvedCommits.length} commits to GitHub users`);
        }
        // Calculate percentages and filter reviewers
        const totalLinesChanged = Array.from(resolvedAuthors.values()).reduce((sum, stats) => sum + stats.linesChanged, 0);
        if (totalLinesChanged === 0) {
            core.info("No lines changed by resolved authors");
            return;
        }
        const potentialReviewers = [];
        for (const [username, stats] of resolvedAuthors.entries()) {
            stats.percentageOfChanges =
                (stats.linesChanged / totalLinesChanged) * 100;
            if (stats.percentageOfChanges >= inputs.threshold) {
                potentialReviewers.push({ username, stats });
            }
        }
        // Sort by percentage of changes (descending)
        potentialReviewers.sort((a, b) => b.stats.percentageOfChanges - a.stats.percentageOfChanges);
        // Apply max reviewers limit
        const reviewersToSuggest = potentialReviewers.slice(0, inputs.maxReviewers);
        if (reviewersToSuggest.length === 0) {
            core.info("📭 No reviewers meet the threshold criteria");
            return;
        }
        // Create comment with review suggestions
        core.info(`📬 Creating comment to suggest reviewers: ${reviewersToSuggest.map((r) => r.username).join(", ")}`);
        await (0, github_api_1.createReviewComment)(octokit, context, reviewersToSuggest.map((r) => ({
            username: r.username,
            percentage: r.stats.percentageOfChanges,
            linesChanged: r.stats.linesChanged,
        })));
        // Output summary
        core.info("\n📊 Review Suggestion Summary:");
        reviewersToSuggest.forEach((reviewer) => {
            core.info(`   👤 @${reviewer.username}: ${reviewer.stats.percentageOfChanges.toFixed(1)}% ` +
                `(${reviewer.stats.linesChanged} lines in ${reviewer.stats.filesAffected} files)`);
        });
        // Set outputs
        core.setOutput("reviewers", reviewersToSuggest.map((r) => r.username).join(","));
        core.setOutput("reviewer-count", reviewersToSuggest.length.toString());
    }
    catch (error) {
        core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Run the action
run();
//# sourceMappingURL=index.js.map

//# sourceMappingURL=index.js.map