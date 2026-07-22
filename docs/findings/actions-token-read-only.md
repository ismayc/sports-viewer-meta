# The Actions token is read-only by default — and a skipped step hides it

*Found 2026-07-22, debugging a failed `Refresh data` run in `premier-league`.*

## Symptom

The twice-daily refresh job fetched the new data and passed the full test suite, then
failed on its very last step:

```
remote: Permission to ismayc/premier-league.git denied to github-actions[bot].
fatal: unable to access 'https://github.com/ismayc/premier-league/': The requested URL returned error: 403
##[error]The process '/usr/bin/git' failed with exit code 128
```

## Root cause

Every repo in the family sets `default_workflow_permissions` to `read`:

```console
$ gh api repos/ismayc/premier-league/actions/permissions/workflow
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
```

`premier-league/.github/workflows/refresh-data.yml` was the only refresh workflow in the
family with no `permissions:` block of its own, so `peter-evans/create-pull-request` got a
read-only `GITHUB_TOKEN` and took a 403 the moment it pushed the branch. The fix is the
same three lines every sibling already carried:

```yaml
permissions:
  contents: write
  pull-requests: write
```

`contents: write` is the load-bearing scope — the 403 is on the **push**, not on the PR
API call. `can_approve_pull_request_reviews` (the "Allow GitHub Actions to create and
approve pull requests" checkbox) was already enabled, so it was never the blocker.

## The part worth remembering

The workflow gates its PR step on whether the fetch actually changed anything:

```yaml
- name: Open a pull request
  if: steps.diff.outputs.changed == 'true'
```

So a scheduled run that finds no new data **skips the push entirely and reports success.**
premier-league's history at the time of the fix:

| Run | Trigger | Result | `Open a pull request` |
|---|---|---|---|
| 2026-07-21 08:45 | schedule | success | skipped |
| 2026-07-21 19:50 | schedule | success | skipped |
| 2026-07-22 08:45 | schedule | **failure** | **failure** |
| 2026-07-22 13:48 | dispatch (post-fix) | success | success |

The workflow had never once completed a real refresh. It looked green purely because the
data hadn't moved yet. A green scheduled run is not evidence that the write path works.

## How to avoid it

1. When adding a viewer, copy a sibling's `permissions:` block along with the workflow.
   Never assume the default token can push.
2. To check whether a conditional step actually ran rather than being skipped:

   ```bash
   gh run view <id> --json jobs -q '.jobs[].steps[] | "\(.conclusion)\t\(.name)"'
   ```

3. For any `git failed with exit code 128` in Actions, check the token scope with
   `gh api repos/<owner>/<repo>/actions/permissions/workflow` before digging through logs.

Fixed in `premier-league` commit `a0719e8`; the manual re-dispatch went green and opened
the repo's first `data/refresh` pull request.
