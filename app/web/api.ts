import type { State, StreamEvent } from "../shared/types";
let token = "";
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { signal }
      : {
          method,
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-glashaus-token": token,
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || `Request failed (${response.status}).`);
  if (path === "/state") token = (value as State).csrfToken;
  return value as T;
}
export async function stream(
  path: string,
  body: unknown,
  signal: AbortSignal,
  emit: (event: StreamEvent) => void,
) {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-glashaus-token": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const value = await response.json();
    throw new Error(value.error || "Request failed.");
  }
  if (!response.body) throw new Error("No response stream. Please retry.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let done = false;
  const line = (value: string) => {
    if (!value.trim()) return;
    const e = JSON.parse(value) as StreamEvent;
    if (e.type === "error") throw new Error(e.text);
    if (e.type === "done") done = true;
    emit(e);
  };
  try {
    while (true) {
      const result = await reader.read();
      pending += decoder.decode(result.value, { stream: !result.done });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      lines.forEach(line);
      if (result.done) break;
    }
    line(pending);
    if (!done)
      throw new Error(
        "The connection ended. Your progress is saved; you can retry.",
      );
  } finally {
    reader.releaseLock();
  }
}
