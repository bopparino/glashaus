// Terminal chat with the companion. Messages persist to memory like any
// other channel.
//   glashaus chat                normal chat
//   glashaus chat --ephemeral    test mode: nothing is saved to memory
import readline from 'node:readline/promises';
import { handleUserMessage } from './chat.js';
import { config } from './config.js';

const persist = !process.argv.includes('--ephemeral');
if (!persist) console.log('(ephemeral mode — nothing will be remembered)\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const who = config.companionName.toLowerCase();

for (;;) {
  let text;
  try {
    text = (await rl.question('you > ')).trim();
  } catch {
    break; // stdin closed (piped input ran out, or ctrl-d)
  }
  if (!text) continue;
  if (text === '/quit' || text === '/exit') break;
  try {
    const reply = await handleUserMessage(text, { persist });
    console.log(`\n${who} > ${reply}\n`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
  }
}
rl.close();
