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
