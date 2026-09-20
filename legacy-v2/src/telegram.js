import { Bot } from 'grammy';
import { config } from './config.js';
import { handleUserMessage } from './chat.js';
import { runCommand, isCommand, commandList } from './commands.js';

// The passes that take a while on a local model get an ack first — a minute
// of silence after /dream reads as a dead bot.
const SLOW = new Set(['/dream', '/grow', '/wander', '/tidy', '/backup', '/heartbeat']);
const commandName = text => String(text).trim().split(/\s+/)[0].replace(/@[\w_]+$/, '').toLowerCase();

export function createBot() {
  if (!config.telegramToken) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');
  const bot = new Bot(config.telegramToken);

  let lastChatId = null;

  // Slash commands, from the registry the terminal and webview share.
  // Telegram is owner-gated (ownerOnly, below), so the destructive half is
  // available here too — it still wants the literal word "confirm", because a
  // fat-fingered tap on a phone should never be able to revert a soul.
  async function command(ctx, text) {
    lastChatId = ctx.chat.id;
    const name = commandName(text);
    if (SLOW.has(name)) await ctx.reply(`(${name.slice(1)}…)`).catch(() => {});
    const result = await runCommand(text, { surface: 'telegram', allowActions: true });
    const body = (result.lines ?? [])
      .map(l => (typeof l === 'string' ? l : l.t))
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    for (const part of splitMessage(body || '(nothing)')) {
      await sendFormatted(t => ctx.reply(t.text, t.opts), part);
    }
  }

  async function respond(ctx, text, images = []) {
    lastChatId = ctx.chat.id;
    await ctx.replyWithChatAction('typing');
    const keepTyping = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 5000);
    try {
      const reply = await handleUserMessage(text, { images });
      for (const part of splitMessage(reply)) await sendFormatted(t => ctx.reply(t.text, t.opts), part);
    } catch (err) {
      console.error('[telegram]', err);
      // Honest but not a stack trace in the middle of their conversation.
      // Not saved to memory — outages must not be remembered as things said.
      await ctx.reply("(brain's not connecting right now — probably the model backend or the internet. i'm still here, try me again in a minute. 🖤)").catch(() => {});
    } finally {
      clearInterval(keepTyping);
    }
  }

  const ownerOnly = ctx => !config.ownerId || String(ctx.from?.id) === String(config.ownerId);

  bot.on('message:text', async ctx => {
    if (!ownerOnly(ctx)) return; // the companion talks only to its person
    const text = ctx.message.text;
    // A slash command is an instruction to the ENGINE, not something said to
    // her — it must never reach the model or enter memory as a thing spoken.
    if (isCommand(text)) {
      try { await command(ctx, text); }
      catch (err) {
        console.error('[telegram:command]', err);
        await ctx.reply(`(that command fell over: ${err.message})`).catch(() => {});
      }
      return;
    }
    await respond(ctx, text);
  });

  // Photos: the companion sees the image this turn (if the model accepts
  // images); what persists in memory is a text note + caption, so history
  // stays text.
  bot.on('message:photo', async ctx => {
    if (!ownerOnly(ctx)) return;
    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      const caption = ctx.message.caption?.trim();
      const text = `[${config.userName} sent a photo${caption ? ` — caption: "${caption}"` : ''}. I can see it in this moment; describe/react to what's actually in it.]${caption ? `\n${caption}` : ''}`;
      await respond(ctx, text, [bytes.toString('base64')]);
    } catch (err) {
      console.error('[telegram:photo]', err);
      await ctx.reply("(couldn't load that photo, send it again?)").catch(() => {});
    }
  });

  // Telegram's own command menu (the "/" button), so the commands are
  // discoverable on a phone instead of remembered. Best-effort: a failure
  // here must never stop the bot from starting.
  bot.api.setMyCommands(
    commandList().slice(0, 100).map(c => ({
      command: c.command.replace(/[^a-z0-9_]/g, ''),
      description: c.desc ?? c.description ?? '',
    })).filter(c => c.command && c.description)
  ).catch(err => console.error('[telegram] command menu:', err.message));

  // Anything else (voice, stickers, video): acknowledge instead of silence,
  // so the companion never confabulates around a message it couldn't perceive.
  bot.on('message', async ctx => {
    if (!ownerOnly(ctx) || ctx.message.text || ctx.message.photo) return;
    const kind = ctx.message.voice ? 'voice message' : ctx.message.sticker ? 'sticker' : ctx.message.video ? 'video' : 'attachment';
    await respond(ctx, `[${config.userName} sent a ${kind}, but I can't perceive ${kind}s yet — I should say that honestly rather than guessing what it was.]`);
  });

  // Unprompted outreach — used by the heartbeat in index.js.
  bot.sendToOwner = async text => {
    const chatId = lastChatId ?? config.ownerId;
    if (!chatId) return;
    for (const part of splitMessage(text)) {
      await sendFormatted(t => bot.api.sendMessage(chatId, t.text, t.opts), part);
    }
  };

  return bot;
}

// Companion *actions* render as italics, **emphasis** as bold — via Telegram
// HTML mode (MarkdownV2 needs 18 chars escaped; one miss rejects the message).
// Falls back to plain text if the parser ever balks.
function htmlify(text) {
  return text
    .replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
}

async function sendFormatted(send, part) {
  try {
    await send({ text: htmlify(part), opts: { parse_mode: 'HTML' } });
  } catch {
    await send({ text: part, opts: {} });
  }
}

function splitMessage(text, max = 4000) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
