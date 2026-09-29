import type { Settings, Source } from "../shared/types.ts";
import { AppError, record, text } from "./validation.ts";
export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_name?: string;
}
export interface ChatOptions {
  messages: Message[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  json?: boolean;
  utility?: boolean;
  maxTokens?: number;
  tools?: ToolDefinition[];
  onToolCalls?: (calls: ToolCall[]) => void;
}
export interface ModelProvider {
  supportsTools?: boolean;
  search?(query: string, signal: AbortSignal): Promise<Source[]>;
  readPage?(url: string, signal: AbortSignal): Promise<Source[]>;
  models(signal?: AbortSignal): Promise<{ name: string; size: number }[]>;
  chat(options: ChatOptions): Promise<string>;
  research(
    name: string,
    work: string,
    scope: string,
    signal: AbortSignal,
    status: (text: string) => void,
  ): Promise<Source[]>;
}
export class Ollama implements ModelProvider {
  supportsTools = true;
  settings: () => Settings;
  fetcher: typeof fetch;
  constructor(settings: () => Settings, fetcher = fetch) {
    this.settings = settings;
    this.fetcher = fetcher;
  }
  async models(signal?: AbortSignal) {
    try {
      const r = await this.fetcher(`${this.settings().ollamaUrl}/api/tags`, {
        signal: combine(signal, 6000),
      });
      if (!r.ok) throw new Error();
      const body = (await r.json()) as {
        models?: { name: string; size: number }[];
      };
      return (body.models ?? [])
        .filter((m) => typeof m.name === "string")
        .map((m) => ({ name: m.name, size: Number(m.size) || 0 }));
    } catch {
      throw new AppError(
        "Ollama is not reachable. Start Ollama and check the server address in Settings.",
        503,
      );
    }
  }
  async chat({
    messages,
    signal,
    onToken,
    json,
    utility,
    maxTokens = 1400,
    tools,
    onToolCalls,
  }: ChatOptions): Promise<string> {
    const s = this.settings();
    const model = utility ? s.utilityModel || s.model : s.model;
    if (!model) throw new AppError("Choose a model in Settings first.");
    let response: Response;
    try {
      response = await this.fetcher(`${s.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: combine(signal, 300000),
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          think: false,
          ...(tools?.length ? { tools } : {}),
          ...(json ? { format: "json" } : {}),
          options: {
            num_ctx: s.contextSize,
            num_predict: maxTokens,
            temperature: json ? 0.2 : 0.75,
          },
        }),
      });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new AppError(
        "Ollama did not respond. Check that it is running and your model is available.",
        503,
      );
    }
    if (!response.ok) {
      if (response.status === 404)
        throw new AppError(
          `The selected model is unavailable. Choose an installed model in Settings.`,
          503,
        );
      throw new AppError(
        `Ollama could not complete the request (HTTP ${response.status}).`,
        502,
      );
    }
    if (!response.body)
      throw new AppError("Ollama returned an empty response.", 502);
    let result = "",
      buffer = "",
      completed = false;
    const decoder = new TextDecoder();
    const toolCalls: ToolCall[] = [];
    const consume = (line: string) => {
      if (!line.trim()) return;
      let event: {
        error?: string;
        message?: { content?: string; tool_calls?: unknown[] };
        done?: boolean;
      };
      try {
        event = JSON.parse(line);
      } catch {
        throw new AppError(
          "Ollama sent a malformed response. You can retry this message.",
          502,
        );
      }
      if (event.error)
        throw new AppError(
          "The model stopped unexpectedly. Check Ollama and retry.",
          502,
        );
      const token = event.message?.content;
      if (typeof token === "string") {
        result += token;
        onToken?.(token);
      }
      if (event.message?.tool_calls) {
        if (!tools?.length || !Array.isArray(event.message.tool_calls))
          throw new AppError("The model returned unexpected tool calls.", 502);
        for (const raw of event.message.tool_calls) {
          const fn = record(record(raw).function);
          toolCalls.push({
            function: {
              name: text(fn.name, "Tool name", 100, true),
              arguments: record(fn.arguments),
            },
          });
        }
        if (toolCalls.length > 6 || JSON.stringify(toolCalls).length > 16000)
          throw new AppError("The model requested too many actions.", 502);
      }
      if (event.done) completed = true;
    };
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 2_000_000 || result.length > 100_000)
        throw new AppError("The model response exceeded the size limit.", 502);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!completed)
      throw new AppError(
        "The model connection ended before the reply finished. Retry to continue.",
        502,
      );
    if (!result.trim() && !toolCalls.length)
      throw new AppError(
        "The model returned no reply. Try another model or retry.",
        502,
      );
    if (toolCalls.length) onToolCalls?.(toolCalls);
    return result.trim();
  }
  private async webCall(
    route: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const key = this.settings().ollamaApiKey;
    if (!key)
      throw new AppError(
        "Add your Ollama web search key in Settings to search the web.",
      );
    let response: Response;
    try {
      response = await this.fetcher(`https://ollama.com/api/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: combine(signal, 25000),
      });
    } catch {
      signal.throwIfAborted();
      throw new AppError(
        "Web search could not connect. Try again shortly.",
        502,
      );
    }
    if ([401, 403].includes(response.status))
      throw new AppError(
        "Ollama rejected the search key. Check Settings.",
        400,
      );
    if (response.status === 429)
      throw new AppError(
        "Ollama search is rate limited. Try again later.",
        429,
      );
    if (!response.ok)
      throw new AppError("Web search is unavailable. Try again later.", 502);
    try {
      return record(await response.json());
    } catch {
      throw new AppError("Web search returned an unreadable result.", 502);
    }
  }
  async search(query: string, signal: AbortSignal): Promise<Source[]> {
    const data = await this.webCall(
      "web_search",
      { query: text(query, "Search query", 500, true), max_results: 5 },
      signal,
    );
    const sources: Source[] = [];
    for (const item of (Array.isArray(data.results) ? data.results : []).slice(
      0,
      5,
    )) {
      if (!item || typeof item !== "object") continue;
      const raw = record(item);
      try {
        const url = publicWebUrl(raw.url);
        sources.push({
          id: `source-${sources.length + 1}`,
          title: String(raw.title ?? new URL(url).hostname).slice(0, 300),
          url,
          excerpt: String(raw.content ?? "").slice(0, 2500),
          fetchedAt: new Date().toISOString(),
        });
      } catch {
        /* Ignore unsafe or malformed URLs. */
      }
    }
    return sources;
  }
  async readPage(rawUrl: string, signal: AbortSignal): Promise<Source[]> {
    const url = publicWebUrl(rawUrl);
    const page = await this.webCall("web_fetch", { url }, signal);
    if (typeof page.content !== "string" || !page.content.trim())
      throw new AppError("This page contained no readable text.", 502);
    return [
      {
        id: "page-1",
        title: String(page.title ?? new URL(url).hostname).slice(0, 300),
        url,
        excerpt: page.content.slice(0, 6000),
        fetchedAt: new Date().toISOString(),
      },
    ];
  }
  async research(
    name: string,
    work: string,
    scope: string,
    signal: AbortSignal,
    status: (text: string) => void,
  ): Promise<Source[]> {
    const key = this.settings().ollamaApiKey;
    if (!key)
      throw new AppError(
        "Add your Ollama web search key in Settings to research a character.",
      );
    const call = async (route: string, body: unknown) => {
      let r: Response;
      try {
        r = await this.fetcher(`https://ollama.com/api/${route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal: combine(signal, 25000),
        });
      } catch (e) {
        if (signal.aborted) throw signal.reason;
        throw new AppError(
          "Web research timed out. Your saved setup is still here; try again.",
          502,
        );
      }
      if (r.status === 401 || r.status === 403)
        throw new AppError(
          "Ollama rejected the web search key. Check it in Settings.",
          400,
        );
      if (r.status === 429)
        throw new AppError(
          "Ollama web search is busy or its limit was reached. Try again later.",
          429,
        );
      if (!r.ok)
        throw new AppError(
          `Web research is unavailable (HTTP ${r.status}).`,
          502,
        );
      try {
        return (await r.json()) as Record<string, unknown>;
      } catch {
        throw new AppError(
          "Web research returned no usable results. Try again later.",
          502,
        );
      }
    };
    const hits = new Map<
      string,
      { title: string; url: string; content: string }
    >();
    const queries = [
      `${name} ${work} character personality background ${scope}`,
      `${name} ${work} character dialogue values relationships ${scope}`,
    ];
    for (const query of queries) {
      signal.throwIfAborted();
      status(`Searching public sources for ${name}…`);
      const data = await call("web_search", { query, max_results: 5 });
      for (const raw of Array.isArray(data.results) ? data.results : []) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.url !== "string") continue;
        let url: URL;
        try {
          url = new URL(r.url);
        } catch {
          continue;
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          continue;
        hits.set(url.href, {
          url: url.href,
          title: String(r.title ?? url.hostname).slice(0, 300),
          content: String(r.content ?? "").slice(0, 1200),
        });
      }
    }
    const pages: Source[] = [];
    const hosts = new Map<string, number>();
    for (const hit of hits.values()) {
      if (pages.length >= 5) break;
      signal.throwIfAborted();
      const host = new URL(hit.url).hostname;
      if ((hosts.get(host) ?? 0) >= 2) continue;
      status(`Reading ${host}…`);
      try {
        const page = await call("web_fetch", { url: hit.url });
        if (typeof page.content !== "string" || page.content.trim().length < 80)
          continue;
        pages.push({
          id: `source-${pages.length + 1}`,
          title: String(page.title ?? hit.title).slice(0, 300),
          url: hit.url,
          excerpt: page.content.slice(0, 6000),
          fetchedAt: new Date().toISOString(),
        });
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
      } catch (e) {
        if (signal.aborted) throw signal.reason;
        if (e instanceof AppError && [400, 429].includes(e.status)) throw e;
      }
    }
    if (!pages.length)
      throw new AppError(
        "I could not read enough source material. Try a more specific character and work, or create your own draft.",
      );
    return pages;
  }
}
export function publicWebUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(text(value, "Page URL", 2000, true));
  } catch {
    throw new AppError("Choose a public HTTP or HTTPS page.");
  }
  const host = url.hostname.toLowerCase();
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("[") ||
    /^\d+(?:\.\d+){3}$/.test(host)
  )
    throw new AppError(
      "Choose a public website without credentials or a custom port.",
    );
  url.hash = "";
  return url.href;
}
export function combine(signal: AbortSignal | undefined, timeout: number) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
}
export function parseJson(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const value: unknown = JSON.parse(cleaned);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  throw new AppError(
    "The model could not produce a usable draft. Try again, or choose another utility model.",
    502,
  );
}
