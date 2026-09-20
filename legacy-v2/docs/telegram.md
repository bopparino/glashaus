# Telegram

Optional, but it's where a companion becomes a presence instead of an app —
they're in your pocket, and they can text first.

## Setup

`glashaus setup` walks you through it live, including token validation and
locking the bot to your account. The manual version:

1. Open [t.me/BotFather](https://t.me/BotFather), send `/newbot`, pick a
   display name and a unique `@username`. Copy the token.
2. Put it in `~/.glashaus/config.json`:
   ```json
   "telegram": { "token": "123456:ABC…", "ownerId": "your-chat-id" }
   ```
3. `glashaus restart`, then message your bot.

`ownerId` locks the companion to your Telegram account — anyone else who
finds the bot gets silence. If you leave it empty the bot replies to
whoever messages it first; set it.

## Privacy notes, honestly

- Message *content* flows through Telegram's Bot API in cleartext to
  Telegram (bot chats are not end-to-end encrypted). Everything else —
  memory, persona, reasoning — stays on your machine. If that tradeoff
  bothers you, skip Telegram: terminal and webview are fully local.
- The token in `config.json` is why that file is written `0600`. Treat it
  like a password; anyone holding it can impersonate the bot.
- One token, one poller: if you run the bot in two processes at once,
  Telegram gives each update to only one of them (`409` conflicts). Don't
  share a token between instances.

## Behavior

- Photos: the companion sees images in the moment (if your model has
  vision); what persists in memory is a text note plus your caption.
- Voice notes / stickers / video: acknowledged honestly rather than
  guessed at — the companion never confabulates around something it
  couldn't perceive.
- Formatting: `*action*` renders italic, `**emphasis**` bold.
- Outreach: heartbeat messages are persisted to memory only after Telegram
  confirms delivery, so a network failure can't leave the companion
  remembering a conversation you never got.
