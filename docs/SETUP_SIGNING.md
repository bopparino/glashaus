# Commit signing setup

Plan §12 requires signed commits. We default to **SSH signing** because it
reuses the SSH key you already use to push to GitHub — no extra keyserver,
no extra agent, no extra friction. GPG is documented at the bottom for
completeness.

This is a one-time setup on each machine you commit from.

---

## SSH signing (recommended)

### 1. Pick the key

Use the SSH key you already authenticate to GitHub with. List your keys:

```bash
ls -la ~/.ssh/*.pub
```

If you don't have one, generate one:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/id_ed25519
```

### 2. Tell git to sign with that key

From inside the GlasHaus repo (replace the path with your actual public
key):

```bash
git config --local gpg.format ssh
git config --local user.signingkey ~/.ssh/id_ed25519.pub
git config --local commit.gpgsign true
git config --local tag.gpgsign true
```

> Use `--local` (not `--global`) until you're sure you want to sign every
> commit on this machine in every repo. Switching to `--global` later is
> a one-line change.

### 3. Tell git which keys to trust (so `git log --show-signature` is meaningful locally)

Create an `allowed_signers` file. Replace `YOUR_EMAIL` and paste the
contents of `~/.ssh/id_ed25519.pub` after it.

```bash
mkdir -p ~/.ssh
echo "YOUR_EMAIL $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
git config --local gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
```

### 4. Register the same key with GitHub as a *signing* key

GitHub treats authentication keys and signing keys separately — the same
public key needs to be uploaded in both slots for commits to show up as
"Verified".

- https://github.com/settings/keys → **New SSH key** → key type **Signing Key**
- Paste the contents of `~/.ssh/id_ed25519.pub`.

### 5. Test

```bash
git commit --allow-empty -m "test: signed commit"
git log --show-signature -1
```

You should see `Good "git" signature for YOUR_EMAIL`. After pushing,
GitHub should show a green "Verified" badge.

---

## GPG signing (alternative)

Use this if you already maintain a GPG identity or if your institution
requires it.

```bash
brew install gnupg
gpg --full-generate-key   # follow prompts; ed25519 is fine
gpg --list-secret-keys --keyid-format=long
# copy the key ID from the `sec` line, e.g. ed25519/ABCDEF1234567890

git config --local user.signingkey ABCDEF1234567890
git config --local commit.gpgsign true
git config --local gpg.format openpgp   # the default; set explicitly to undo any prior `gpg.format ssh`

gpg --armor --export ABCDEF1234567890   # paste into https://github.com/settings/gpg/new
```

---

## Enforcing it

Local signing is half the story. The other half is GitHub branch
protection requiring signed commits on `main` — see
[`SETUP_BRANCH_PROTECTION.md`](SETUP_BRANCH_PROTECTION.md).
