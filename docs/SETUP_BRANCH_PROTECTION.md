# GitHub branch protection

The pre-commit hooks and CI workflow only matter if `main` can't be
merged around them. This page is the GitHub-side setup that closes that
loop.

Configure once, per repo, on the GitHub web UI.

---

## Settings → Branches → "Add branch protection rule"

**Branch name pattern:** `main`

Enable:

- [x] **Require a pull request before merging**
  - [x] Require approvals: 1 (set to 0 if you're solo)
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Required checks (search and select):
    - `lint + typecheck + test`
    - `schema snapshot (placeholder until Phase 1)`
- [x] **Require signed commits**
- [x] **Require linear history** (no merge commits — keeps the timeline
      analyzable for the thesis)
- [x] **Require conversation resolution before merging**
- [x] **Do not allow bypassing the above settings**
- [x] **Restrict who can push to matching branches** → leave empty so
      *nobody* can direct-push, including admins. PR-only.
- [x] **Allow force pushes** → **Disabled**
- [x] **Allow deletions** → **Disabled**

Save.

---

## Re-verifying after CI job renames

The "Required checks" list pins the *job names* from `.github/workflows/ci.yml`.
If you rename a job, GitHub will silently stop requiring it. After any
rename:

1. Settings → Branches → Edit the rule.
2. Re-search and re-select the new job names.
3. Save.

A CI rename without this follow-up is exactly the kind of silent gap
that this whole phase exists to prevent.
