---
name: github-etiquette
description: GitHub working conventions for the neo2-flightpath repository - issue templates, gh CLI usage, branch and commit style, PR etiquette. Load when a session interacts with GitHub (filing or refining issues, creating branches, opening or updating pull requests, releases)
---

# GitHub etiquette

## When to use

Load before any GitHub interaction: issues, branches, pull requests, releases.

## Hard rules

- Issue bodies **must** follow templates where possible
- Write issue and PR bodies to a file first, pass it via `--body-file`; never inline long bodies into shell arguments
- GitHub Flavored Markdown needs blank lines between paragraphs; a single newline is not a line break
- Commit messages **must** follow Conventional Commits
- PR titles **should** have a Conventional Commits style in the title
- An agent may **never** merge a PR, only a human may
- An agent **should** wait for human approval before opening a PR

## Repository facts

- Branch naming: `<type>/<issue-number>-<slug>`, e.g. `docs/3-agent-instructions`
- Commit messages follow Conventional Commits style, e.g. `docs: GitHub issue templates`, `refactor: restructure code base along Fowler/Clean Code lines (#7)`

## Recommendations

- Use the `gh` CLI tool if available to interact with the repository

## Deep dives

Read on demand, only the part you need:

- [issues.md](issues.md): templates, description structure, refinement workflow
- [pull-requests.md](pull-requests.md): draft/undraft etiquette, titles, reviews, merging
- [commands.md](commands.md): `gh` CLI cheat sheet (issues, pull requests, CI)
