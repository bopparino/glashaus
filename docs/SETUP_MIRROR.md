# Second remote: Codeberg mirror

Plan §12 mandates a second remote that is *not* on GitHub, in a different
jurisdiction, on independent infrastructure. We use Codeberg (Gitea-based,
EU-hosted, non-profit). Every `git push` automatically pushes to both.

If GitHub locks the account, has an outage, or shifts ToS in a way we
can't accept, the entire history (including signatures) survives intact
on Codeberg, ready to clone and continue from.

---

## One-time setup

### 1. Create the mirror repository

- Sign up at https://codeberg.org if you don't already have an account.
- Create a new empty repo named `GlasHaus` (or `glashaus`) — **do not**
  initialize with a README, license, or .gitignore.

### 2. Add a signing-capable SSH key to Codeberg

Same key you use for GitHub is fine. Add at:

- https://codeberg.org/user/settings/keys → "Add Key" (SSH key).

### 3. Configure the dual remote

From the repo root:

```bash
# Replace YOUR_GITHUB and YOUR_CODEBERG with your usernames.
git remote add origin git@github.com:YOUR_GITHUB/GlasHaus.git
git remote set-url --add --push origin git@github.com:YOUR_GITHUB/GlasHaus.git
git remote set-url --add --push origin git@codeberg.org:YOUR_CODEBERG/GlasHaus.git
```

Verify both push URLs are registered:

```bash
git remote -v
# origin  git@github.com:YOUR_GITHUB/GlasHaus.git (fetch)
# origin  git@github.com:YOUR_GITHUB/GlasHaus.git (push)
# origin  git@codeberg.org:YOUR_CODEBERG/GlasHaus.git (push)
```

`fetch` only points at GitHub — that's intentional, GitHub stays the
canonical source of truth, Codeberg is write-only insurance.

### 4. First push

```bash
git push -u origin main
```

This pushes to both remotes in one command. Confirm the commit appears
on both web UIs.

---

## Verifying the mirror stays current

Add this to your shell rc as a sanity check you can run anytime:

```bash
glashaus-mirror-check() {
    git rev-parse main > /tmp/.gh_main_local
    git ls-remote git@github.com:YOUR_GITHUB/GlasHaus.git refs/heads/main \
        | awk '{print $1}' > /tmp/.gh_main_github
    git ls-remote git@codeberg.org:YOUR_CODEBERG/GlasHaus.git refs/heads/main \
        | awk '{print $1}' > /tmp/.gh_main_codeberg

    echo "local:    $(cat /tmp/.gh_main_local)"
    echo "github:   $(cat /tmp/.gh_main_github)"
    echo "codeberg: $(cat /tmp/.gh_main_codeberg)"
}
```

A divergence between GitHub and Codeberg means a push partially failed.
Run `git push origin main` again to resync.
