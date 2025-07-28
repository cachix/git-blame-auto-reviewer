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
on:
  pull_request:
    types: [opened, ready_for_review]

jobs:
  assign-reviewers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git blame

      - uses: cachix/git-blame-auto-reviewer@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max-reviewers: 3
          threshold: 20 # Minimal percentage of changes
