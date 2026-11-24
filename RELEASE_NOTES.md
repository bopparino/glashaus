# GlasHaus v3.0.0-alpha.9

Choose a model in **Settings → Model connection**. GlasHaus can list the models on your Ollama server and the chat models available to your xAI API key. Pick one and click **Save model**. You can enter an exact model ID for a custom alias.

GlasHaus runs on Node 26.x and Node 24.14+ (24.x). This release also includes the companion update previously merged to main.

- Create a companion from one prompt of up to 4,000 characters, then choose Ollama or Grok in Settings.
- GlasHaus stores source quotes for lasting details and preferences. Search and edit them in Memory, or save a note verbatim in Telegram with `/note`.
- Telegram reconnects after wake and retries locally queued messages after temporary outages. Run GlasHaus and its model on an always-on host for Telegram access while your PC sleeps.
- GlasHaus prompts new and existing owners to confirm they are 18 or older. Replies can go into detail when asked.

## Install or update

Run the [installer for your platform](https://github.com/bopparino/glashaus#one-command-installation) or extract the portable ZIP and run `node bin/glashaus-v3.js` from the extracted folder. Existing background installations can also use **Settings → Updates**.

The updater makes a local SQLite recovery copy before upgrading an existing companion home. Alpha.9 adds a memory search index and a Telegram queue to existing v3 databases. To go back to alpha.7, use the pre-upgrade database copy. You can export your companion from Settings before proceeding.

See the [README](https://github.com/bopparino/glashaus#readme) for manual installs, custom homes, and recovery.
