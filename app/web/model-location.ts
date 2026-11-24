import type { PublicSettings } from "../shared/types";

export function modelLocation(model: string, address: string): string {
  if (!model) return "Choose a model in Settings";
  if (/(?:[:\-])cloud(?:$|[:\-])/i.test(model))
    return "Cloud model · via Ollama";
  try {
    const host = new URL(address).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host)
      ? "Ollama · local server"
      : "Remote Ollama server";
  } catch {
    return "Ollama · check server address";
  }
}

export function inferenceLocation(settings: PublicSettings): string {
  if (settings.provider === "grok")
    return settings.grokModel
      ? "Grok · hosted by xAI"
      : "Choose a model in Settings";
  return modelLocation(settings.model, settings.ollamaUrl);
}
