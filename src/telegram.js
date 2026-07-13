import { Bot } from 'grammy';
import { config } from './config.js';
import { handleUserMessage } from './chat.js';

export function createBot() {
  if (!config.telegramToken) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');
  const bot = new Bot(config.telegramToken);

  let lastChatId = null;

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
    await respond(ctx, ctx.message.text);
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
