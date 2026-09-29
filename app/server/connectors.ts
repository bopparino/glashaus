import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Store } from "./store.ts";
import { integrationSettings, type ConnectorConfig } from "./integration-settings.ts";
import { AppError } from "./validation.ts";

export class Connectors {
  store: Store;
  constructor(store: Store) { this.store = store; }
  config(id: string) {
    const c = integrationSettings(this.store).connectors.find((c) => c.id === id);
    if (!c) throw new AppError("This connector is not connected.", 404);
    return c;
  }
  async session<T>(c: ConnectorConfig, signal: AbortSignal, run: (client: Client) => Promise<T>): Promise<T> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
    const url = new URL(c.url);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: c.token ? { Authorization: "Bearer " + c.token } : {} },
      fetch: (input, init) => {
        const target = new URL(input instanceof Request ? input.url : String(input));
        if (target.origin !== url.origin) throw new AppError("The connector tried to redirect to another server.");
        return fetch(input, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]), redirect: "error" });
      },
    });
    const client = new Client({ name: "glashaus", version: "3.0.0" }, { capabilities: {} });
    try { await client.connect(transport); return await run(client); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError("The tool server could not complete this request. Check its URL, access token, and status in Connections.", 502); }
    finally { await transport.terminateSession().catch(() => {}); await client.close().catch(() => {}); }
  }
  async discover(id: string, signal: AbortSignal) {
    return this.session(this.config(id), signal, async (client) => {
      const result = await client.listTools();
      return { tools: result.tools.slice(0, 100).map(({ name, description, inputSchema, annotations }) => ({ name, description: description?.slice(0, 1000) ?? "", inputSchema, readOnlyHint: annotations?.readOnlyHint === true })) };
    });
  }
  async call(id: string, name: string, args: Record<string, unknown>, signal: AbortSignal, requireRead = false) {
    const c = this.config(id);
    if (!c.tools.includes(name) || (requireRead && !c.readTools.includes(name))) throw new AppError("This tool needs your review before it can run. Enable a read tool explicitly or prepare an action for approval.");
    return this.session(c, signal, async (client) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 25_000 });
      const serialized = JSON.stringify(result);
      if (serialized.length > 30_000) return { truncated: true, content: serialized.slice(0, 29_000), isError: result.isError === true };
      return result;
    });
  }
}
