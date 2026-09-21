export type Mode = "character" | "authored" | "grow";
export interface Source {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  fetchedAt: string;
}
export interface Claim {
  text: string;
  sourceIds: string[];
  kind: "sourced" | "interpretation";
}
export interface Character {
  name: string;
  pronouns: string;
  mode: Mode;
  work: string;
  summary: string;
  personality: string;
  voice: string;
  backstory: string;
  values: string;
  uncertainties: string[];
  claims: Claim[];
  sources: Source[];
}
export interface Companion extends Character {
  id: string;
  userName: string;
  relationship: string;
  createdAt: string;
  revision: number;
}
export interface Settings {
  ollamaUrl: string;
  model: string;
  utilityModel: string;
  contextSize: number;
  ollamaApiKey: string;
  telegramToken: string;
  telegramOwnerId: string;
  reflectionEnabled: boolean;
  outreachEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  maxOutreachPerDay: number;
}
export type PublicSettings = Omit<
  Settings,
  "ollamaApiKey" | "telegramToken"
> & {
  hasSearchKey: boolean;
  hasTelegramToken: boolean;
};
export interface Turn {
  id: string;
  userText: string;
  reply: string;
  channel: "web" | "telegram";
  status: "running" | "complete" | "interrupted" | "failed";
  delivered: number;
  error: string;
  createdAt: string;
}
export interface Memory {
  id: string;
  kind: "fact" | "opinion";
  subject: "user" | "companion" | "relationship";
  text: string;
  evidence: string;
  turnId: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}
export interface Reflection {
  id: string;
  content: string;
  createdAt: string;
  sourceTurnIds: string[];
}
export interface Research {
  id: string;
  name: string;
  work: string;
  scope: string;
  status: "running" | "complete" | "failed" | "interrupted";
  stage: string;
  sources: Source[];
  draft: Character | null;
  error: string;
  createdAt: string;
}
export interface State {
  companion: Companion | null;
  settings: PublicSettings;
  turns: Turn[];
  memories: Memory[];
  reflections: Reflection[];
  research: Research[];
  csrfToken: string;
  version: string;
  background: string;
  telegram: {
    connected: boolean;
    pairingCode?: string;
    botName?: string;
    error?: string;
  };
}
export interface StartupStatus {
  id?: string;
  available: boolean;
  enabled: boolean;
  managed: boolean;
  platform: string;
  message: string;
}
export interface UpdateStatus {
  current: string;
  latest: { version: string; tag: string; url: string } | null;
  checkedAt: number | null;
  available: boolean;
  message: string;
  operation: {
    id: string;
    version: string;
    phase:
      | "preparing"
      | "stopping"
      | "backing-up"
      | "starting"
      | "complete"
      | "failed"
      | "recovery-needed";
    message: string;
    backup: string | null;
  } | null;
}
export interface StreamEvent {
  type: "status" | "token" | "sources" | "draft" | "done" | "error";
  text?: string;
  id?: string;
  sources?: Source[];
  draft?: Character;
  turn?: Turn;
}
export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: "http://127.0.0.1:11434",
  model: "",
  utilityModel: "",
  contextSize: 8192,
  ollamaApiKey: "",
  telegramToken: "",
  telegramOwnerId: "",
  reflectionEnabled: false,
  outreachEnabled: false,
  quietStart: 23,
  quietEnd: 8,
  maxOutreachPerDay: 2,
};
