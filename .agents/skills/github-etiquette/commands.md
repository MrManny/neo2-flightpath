# gh CLI cheat sheet

```bash
# issues
gh issue list
gh issue view <n>
gh issue edit <n> --body-file /path/to/body.md

# pull requests
gh pr create --draft --base main --head <branch> --title "<title>" --body-file /path/to/body.md
gh pr edit <n> --body-file /path/to/body.md
gh pr ready <n>          # undraft
gh pr view <n>

# CI on a PR: snapshot vs. wait
gh pr checks <n>                    # one-shot status of all checks
gh pr checks <n> --watch            # block until every check finishes (exit != 0 on failure)
gh pr checks <n> --watch --fail-fast   # stop waiting at the first failed check

# CI as a workflow run (see live job/step progress)
gh run list --branch <branch>          # find the run id for the PR branch
gh run watch <run-id> --exit-status    # stream job/step status until done; non-zero on failure
gh run view <run-id> --log-failed      # fetch failing logs afterwards
```
