import type { Settings, Source } from "../shared/types.ts";
import { AppError } from "./validation.ts";
import type { ChatOptions, Message, ModelProvider } from "./ollama.ts";
import { Ollama } from "./ollama.ts";

const ENDPOINT = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-4.5";

/** Conversation brain. Research and the model list stay on Ollama. */
export class XaiProvider implements ModelProvider {
  private readonly fallback: Ollama;
  constructor(
    private readonly settings: () => Settings,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.fallback = new Ollama(settings, fetcher);
  }
  models(signal?: AbortSignal) {
    return this.fallback.models(signal);
  }
  research(
    name: string,
    work: string,
    scope: string,
    signal: AbortSignal,
    status: (text: string) => void,
  ): Promise<Source[]> {
    return this.fallback.research(name, work, scope, signal, status);
  }
  async chat({
    messages,
    signal,
    onToken,
    json,
    utility,
    maxTokens = 1400,
  }: ChatOptions): Promise<string> {
    const key = process.env.XAI_API_KEY;
    if (!key)
      return this.fallback.chat({
        messages,
        signal,
        onToken,
        json,
        utility,
        maxTokens,
      });
    const model = utility
      ? process.env.XAI_UTILITY_MODEL || MODEL
      : process.env.XAI_MODEL || MODEL;
    let response: Response;
    try {
      response = await this.fetcher(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        signal,
        body: JSON.stringify({
          model,
          messages: messages.map((message: Message) => ({
            role: message.role,
            content: message.content,
          })),
          stream: true,
          temperature: json ? 0.2 : 0.8,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new AppError(
        "xAI did not respond. The companion on this machine is unchanged.",
        503,
      );
    }
    if (!response.ok || !response.body)
      throw new AppError(
        `xAI could not complete the request (HTTP ${response.status}).`,
        502,
      );
    return readSse(response.body, onToken);
  }
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onToken?: (token: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as {
      choices?: { delta?: { content?: string } }[];
    };
    const token = event.choices?.[0]?.delta?.content;
    if (typeof token !== "string" || !token) return;
    result += token;
    onToken?.(token);
    if (result.length > 100_000)
      throw new AppError("The model response exceeded the size limit.", 502);
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      consume(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  }
  if (buffer.trim()) consume(buffer);
  if (!result.trim()) throw new AppError("The model returned no reply.", 502);
  return result.trim();
}
