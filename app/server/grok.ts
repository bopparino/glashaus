import { combine, Ollama } from "./ollama.ts";
import type { ChatOptions, ModelConnection } from "./ollama.ts";
import { AppError, ModelUnavailable } from "./validation.ts";

export class CompanionModels extends Ollama {
  override async models(
    signal?: AbortSignal,
    connection: ModelConnection = this.settings(),
  ) {
    if (connection.provider === "ollama")
      return super.models(signal, connection);
    const key = connection.grokApiKey;
    if (!key) throw new AppError("Enter your xAI API key to load Grok models.");

    let response: Response;
    try {
      response = await this.fetcher("https://api.x.ai/v1/language-models", {
        headers: { Authorization: `Bearer ${key}` },
        redirect: "error",
        signal: combine(signal, 8000),
      });
    } catch {
      signal?.throwIfAborted();
      throw new ModelUnavailable(
        "xAI could not be reached. Check your connection and try again.",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        "xAI rejected this key or its model-list access. Check the key in your xAI console.",
      );
    if (response.status === 429)
      throw new AppError(
        "xAI is rate limiting this request. Give it a moment and try again.",
        429,
      );
    if (!response.ok)
      throw new AppError(
        `xAI could not list models (HTTP ${response.status}). Try again.`,
        502,
      );

    try {
      const data = (await response.json()) as {
        models?: Array<{ id?: string; output_modalities?: string[] } | null>;
      };
      if (!Array.isArray(data?.models)) throw new Error();
      const names = new Set<string>();
      for (const model of data.models) {
        if (typeof model?.id !== "string" || !model.id.trim()) continue;
        if (
          Array.isArray(model.output_modalities) &&
          !model.output_modalities.includes("text")
        )
          continue;
        names.add(model.id);
      }
      return [...names].map((name) => ({ name, size: 0 }));
    } catch {
      signal?.throwIfAborted();
      throw new AppError(
        "xAI returned an unreadable model list. Try loading models again.",
        502,
      );
    }
  }
  override async chat(options: ChatOptions): Promise<string> {
    const settings = this.settings();
    if (settings.provider === "ollama") return super.chat(options);

    const { grokApiKey, grokModel } = settings;
    if (!grokApiKey || !grokModel)
      throw new AppError("Add a Grok model and xAI API key in Settings.");

    const { messages, signal, onToken, json, maxTokens = 1400 } = options;
    const input = messages.map(({ role, content }) => ({ role, content }));
    if (json) {
      input.unshift({
        role: "system",
        content:
          "Return only a valid JSON object, with no surrounding text or markdown.",
      });
    }
    let response: Response;
    try {
      response = await this.fetcher("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokApiKey}`,
        },
        redirect: "error",
        signal: combine(signal, 120000),
        body: JSON.stringify({
          model: grokModel,
          input,
          store: false,
          // Reasoning models count hidden reasoning toward this limit.
          max_output_tokens: Math.max(2048, maxTokens),
        }),
      });
    } catch {
      signal?.throwIfAborted();
      throw new ModelUnavailable(
        "Grok could not be reached. Check your connection and try again.",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        "xAI rejected the saved key or its access to this model. Check Settings.",
      );
    if (response.status === 429 || response.status >= 500)
      throw new ModelUnavailable(
        `Grok is temporarily unavailable (HTTP ${response.status}).`,
      );
    if (!response.ok)
      throw new AppError(
        `Grok could not complete the request (HTTP ${response.status}). Check the model name in Settings.`,
      );

    let data: {
      status?: string;
      output?: Array<{
        type: string;
        content?: Array<{ type: string; text?: string }>;
      }>;
    };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      signal?.throwIfAborted();
      throw new ModelUnavailable(
        "The Grok connection ended before the reply finished.",
      );
    }
    const result = data?.output
      ?.filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter(
        (item) => item.type === "output_text" && typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("")
      .trim();
    if (data?.status !== "completed" || !result)
      throw new AppError(
        "Grok returned no complete reply. Check the model or try again.",
        502,
      );
    onToken?.(result);
    return result;
  }
}
