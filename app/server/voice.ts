import type { Store } from "./store.ts";
import { integrationSettings } from "./integration-settings.ts";
import { AppError, record, text } from "./validation.ts";

export class Voice {
  store: Store;
  fetch: typeof fetch;
  constructor(store: Store, request: typeof fetch = fetch) { this.store = store; this.fetch = request; }
  status() {
    const s = integrationSettings(this.store).voice;
    const month = new Date().toISOString().slice(0, 7);
    const used = Number(this.store.db.prepare("SELECT value FROM meta WHERE key=?").get("voiceUsage:" + month)?.value ?? 0);
    return { ready: !!s.apiKey && !!s.voiceId, month, used, limit: s.monthlyCharacters, voiceId: s.voiceId, model: s.model };
  }
  async request(path: string, signal: AbortSignal, body?: unknown) {
    const key = integrationSettings(this.store).voice.apiKey;
    if (!key) throw new AppError("Add your ElevenLabs API key in Voice settings.");
    const response = await this.fetch("https://api.elevenlabs.io" + path, { method: body ? "POST" : "GET", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(response.status === 401 ? "ElevenLabs rejected this API key. Update it in Voice settings." : response.status === 429 ? "ElevenLabs reached its usage or request limit. Try later or check your account." : "The voice service is unavailable. Your text conversation is still available.", 502);
    }
    return response;
  }
  async voices(signal: AbortSignal) {
    const voices: { id: string; name: string; description: string }[] = [];
    let next = "";
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ page_size: "100", include_custom_rates: "false", include_total_count: "false", sort: "created_at_unix", sort_direction: "desc" });
      if (next) query.set("next_page_token", next);
      const data = await (await this.request("/v2/voices?" + query, signal)).json() as { voices: { voice_id: string; name: string; labels?: Record<string, string>; category?: string }[]; has_more?: boolean; next_page_token?: string };
      voices.push(...data.voices.filter((v) => ["premade", "cloned", "generated", "professional"].includes(v.category ?? "")).map((v) => ({ id: v.voice_id, name: v.name, description: Object.values(v.labels ?? {}).join(" · ") })));
      if (!data.has_more) return { voices };
      if (!data.next_page_token || data.next_page_token === next) break;
      next = data.next_page_token;
    }
    throw new AppError("Your voice library is too large to load completely. Reduce the saved voices in ElevenLabs and refresh.");
  }
  async speak(value: unknown, signal: AbortSignal) {
    const input = record(value), config = integrationSettings(this.store), settings = config.voice;
    if (!settings.voiceId) throw new AppError("Choose Elle’s voice in Settings first.");
    let speech: string;
    if (input.preview === true) speech = "Hey. I’m here. What do you want to get into this evening?";
    else {
      const id = text(input.turnId, "Reply", 160, true);
      const row = this.store.db.prepare("SELECT reply FROM turns WHERE id=? AND status='complete'").get(id);
      if (!row) throw new AppError("Wait for the reply to finish before playing it.");
      speech = String(row.reply).replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1").replace(/[*_`#]/g, "");
    }
    if (speech.length > 5000) throw new AppError("This reply is too long for one voice turn. Ask for a shorter version.");
    const subscription = await (await this.request("/v1/user/subscription", signal)).json() as { character_count: number; character_limit: number };
    if (!Number.isFinite(subscription.character_limit) || subscription.character_count + speech.length > subscription.character_limit) throw new AppError("Your included ElevenLabs allowance is exhausted. Glashaus will not use paid overages.");
    const query = new URLSearchParams({ voice_ids: settings.voiceId, include_custom_rates: "false", include_total_count: "false" });
    const available = await (await this.request("/v2/voices?" + query, signal)).json() as { voices: { voice_id: string }[] };
    if (!available.voices.some(v => v.voice_id === settings.voiceId)) throw new AppError("This voice is unavailable or has a custom rate. Load voices in Settings and choose an included voice.");
    if (integrationSettings(this.store).revision !== config.revision) throw new AppError("Voice settings changed. Try your preview or voice reply again.", 409);
    // Reserve before the paid request. Failed/cancelled requests remain counted
    // because a disconnected provider may already have billed them.
    this.store.transaction(() => {
      const status = this.status();
      if (status.used + speech.length > status.limit) throw new AppError("Your monthly Glashaus voice limit is reached. Text chat remains available.");
      this.store.setMeta("voiceUsage:" + status.month, String(status.used + speech.length));
    });
    const response = await this.request("/v1/text-to-speech/" + encodeURIComponent(settings.voiceId) + "/stream?output_format=mp3_44100_128", signal, { text: speech, model_id: settings.model, voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } });
    const chunks: Uint8Array[] = []; let count = 0;
    if (!response.body) throw new AppError("The voice service returned no audio.", 502);
    for await (const chunk of response.body) { count += chunk.length; if (count > 12_000_000) { await response.body.cancel().catch(() => {}); throw new AppError("The voice reply exceeded its audio limit.", 502); } chunks.push(chunk); }
    if (!count) throw new AppError("The voice service returned empty audio.", 502);
    return Buffer.concat(chunks);
  }
}
