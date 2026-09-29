export interface WorkspaceFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
  kind: "image" | "artifact";
}
export interface WorkspaceTask {
  id: string;
  turnId: string | null;
  title: string;
  instruction: string;
  kind: "document" | "python";
  status:
    "queued" | "running" | "complete" | "failed" | "cancelled" | "interrupted";
  stage: string;
  error: string;
  inputIds: string[];
  outputIds: string[];
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
