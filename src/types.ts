export type SkillStatus = "Draft" | "Published" | "Needs review";
export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: SkillStatus;
  version: string;
  updated: string;
  runs: number;
  passRate: number;
  tags: string[];
  content?: string;
  workspacePath?: string;
  projectId?: string;
  template?: string;
}

export type ProviderKind = "ollama" | "openai-compatible";
export interface ProviderSettings {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}
export interface ProviderProfile extends ProviderSettings {
  id: string;
  name: string;
  apiKey?: string;
  assistantInstructions?: string;
}
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface AssistantThread {
  id: string;
  providerId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
export interface ChatRequest {
  provider: ProviderSettings;
  messages: ChatMessage[];
  apiKey?: string;
  temperature?: number;
}
export interface ChatResult {
  content: string;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  demo: boolean;
}
export interface ProviderStatus {
  connected: boolean;
  provider: ProviderKind;
  message: string;
}
export interface ModelInfo {
  id: string;
  name: string;
}

export type RunStatus = "passed" | "failed";
export interface RunRecord {
  id: string;
  skillId: string;
  provider: ProviderKind;
  model: string;
  input: string;
  output: string;
  status: RunStatus;
  durationMs: number;
  error?: string;
  createdAt: string;
}
export type TestAssertion =
  | "contains"
  | "not-contains"
  | "equals"
  | "not-equals"
  | "starts-with"
  | "ends-with"
  | "regex"
  | "length-greater"
  | "length-less"
  | "word-count-greater"
  | "word-count-less"
  | "valid-json";
export interface TestCase {
  id: string;
  skillId: string;
  name: string;
  suite: string;
  input: string;
  expected: string;
  assertion?: TestAssertion;
  caseSensitive?: boolean;
  status: "passed" | "failed" | "running" | "queued";
  duration: string;
  score: number;
  error?: string;
  deterministic?: boolean;
  lastRunAt?: string;
}
export interface TestAttempt {
  id: string;
  testId: string;
  status: "passed" | "failed";
  score: number;
  durationMs: number;
  error?: string;
  createdAt: string;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  platform: "OpenCode" | "Generic";
  skills: number;
  updated: string;
  discoveredSkillPaths?: string[];
}

export interface SkillRepository {
  list(): Promise<Skill[]>;
  save(skill: Skill): Promise<void>;
}
export interface RunRepository {
  list(): Promise<RunRecord[]>;
  save(run: RunRecord): Promise<void>;
}
export interface ModelProvider {
  status(settings: ProviderSettings, apiKey?: string): Promise<ProviderStatus>;
  listModels(settings: ProviderSettings, apiKey?: string): Promise<ModelInfo[]>;
  chat(request: ChatRequest): Promise<ChatResult>;
}
