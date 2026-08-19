# Git Blame Auto Reviewer

A GitHub Action that automatically suggests reviewers by commenting on pull requests based on git blame analysis.

## Features

- 🔍 **Git Blame Analysis**: Only analyzes lines that were actually changed in the PR
- 👤 **Automatic Author Resolution**: Uses GitHub API to map commits to GitHub users
- 📊 **Threshold-based Suggestions**: Only suggests reviewers who authored a significant portion
- 💬 **Comment-based Notifications**: Creates a PR comment to suggest reviewers instead of directly assigning them
- 🤖 **Bot Filtering**: Automatically excludes bot accounts

## Usage

```yaml
name: Auto Suggest Reviewers

# `pull_request_target` runs the workflow from the base branch with a writable
# token, which is what lets the action comment on pull requests opened from a
# fork. On a plain `pull_request` event GITHUB_TOKEN is read-only for fork PRs,
# so the comment is skipped with a warning.
on:
  pull_request_target:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  assign-reviewers:
    runs-on: ubuntu-latest
    steps:
      # Check out the base branch, never the pull request's code: this job holds
      # a writable token and must not run anything the PR author controls.
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          fetch-depth: 0 # Required for git blame
          persist-credentials: false

      - uses: cachix/git-blame-auto-reviewer@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max-reviewers: 3
          threshold: 20 # Minimal percentage of changes
```

Pin the action to a commit rather than `@main` when the job holds a writable
token, otherwise push access to this repository is push access to yours.

## Security

The action is meant to be safe to run under `pull_request_target`:

- Git is invoked with an explicit argument list, never through a shell, so a
  pull request that adds a file named `harmless$(...)x.txt` cannot turn a
  filename into a command. There is a regression test for this.
- Nothing from the pull request is fetched, checked out, or executed. Changed
  line numbers come from the patch in the pull request files API, and only base
  branch history is read from disk.
- A failure to post the comment is a warning, not a failed check.

Keep the checkout pinned to the base ref as shown above. Checking out
`github.event.pull_request.head.sha` in a `pull_request_target` job would hand
the writable token to code from the pull request.
