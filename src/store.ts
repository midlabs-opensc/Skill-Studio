import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AssistantThread,
  ChatMessage,
  Project,
  ProviderProfile,
  ProviderSettings,
  RunRecord,
  Skill,
  TestAttempt,
  TestCase,
} from "./types";
import { executeTests } from "./services/tests";
import { appStorage } from "./lib/storage";
import type { InstalledSkill } from "./lib/tauri";

interface StudioState {
  theme: "dark" | "light";
  skills: Skill[];
  projects: Project[];
  tests: TestCase[];
  testAttempts: TestAttempt[];
  installed: string[];
  discoveredSkillNames: Record<string, string>;
  discoveredSkills: InstalledSkill[];
  installedInventoryRevision: number;
  editorMode: "code" | "form" | "blocks" | "preview";
  provider: ProviderSettings;
  providers: ProviderProfile[];
  activeProviderId: string;
  runs: RunRecord[];
  assistantWidth: number;
  assistantConversations: Record<string, ChatMessage[]>;
  assistantPending: Record<string, boolean>;
  assistantErrors: Record<string, string>;
  assistantThreads: Record<string, AssistantThread>;
  assistantThreadOrder: Record<string, string[]>;
  activeAssistantThreads: Record<string, string>;
  editorSessions: Record<
    string,
    { file: string; content: string; saved: boolean }
  >;
  assistantDrafts: Record<string, string>;
  toggleTheme: () => void;
  addSkill: (skill: Skill) => void;
  updateSkill: (id: string, value: Partial<Skill>) => void;
  removeSkill: (id: string) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, value: Partial<Project>) => void;
  removeProject: (id: string) => void;
  install: (name: string) => void;
  setDiscoveredSkillName: (targetPath: string, name: string) => void;
  setDiscoveredSkills: (skills: InstalledSkill[]) => void;
  setDiscoveredSkillsForProject: (
    projectPath: string,
    skills: InstalledSkill[],
  ) => void;
  requestInstalledRefresh: () => void;
  setEditorMode: (mode: "code" | "form" | "blocks" | "preview") => void;
  setProvider: (provider: Partial<ProviderSettings>) => void;
  addProvider: (provider: ProviderProfile) => void;
  updateProvider: (id: string, value: Partial<ProviderProfile>) => void;
  removeProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  addRun: (run: RunRecord) => void;
  clearRuns: () => void;
  setTests: (tests: TestCase[]) => void;
  addTest: (test: TestCase) => void;
  removeTest: (id: string) => void;
  addTestAttempts: (attempts: TestAttempt[]) => void;
  setAssistantWidth: (width: number) => void;
  setAssistantMessages: (key: string, messages: ChatMessage[]) => void;
  appendAssistantMessage: (key: string, message: ChatMessage) => void;
  setAssistantPending: (key: string, pending: boolean) => void;
  setAssistantError: (key: string, error: string) => void;
  createAssistantThread: (providerId: string) => string;
  setActiveAssistantThread: (providerId: string, threadId: string) => void;
  setAssistantThreadMessages: (
    threadId: string,
    messages: ChatMessage[],
  ) => void;
  appendAssistantThreadMessage: (
    threadId: string,
    message: ChatMessage,
  ) => void;
  deleteAssistantThread: (providerId: string, threadId: string) => void;
  setEditorSession: (
    key: string,
    session: { file: string; content: string; saved: boolean },
  ) => void;
  setAssistantDraft: (key: string, value: string) => void;
  runTests: () => Promise<void>;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      theme: "dark",
      skills: [],
      projects: [],
      tests: [],
      testAttempts: [],
      installed: [],
      discoveredSkillNames: {},
      discoveredSkills: [],
      installedInventoryRevision: 0,
      editorMode: "code",
      runs: [],
      assistantWidth: 400,
      assistantConversations: {},
      assistantThreads: {},
      assistantThreadOrder: {},
      activeAssistantThreads: {},
      assistantPending: {},
      assistantErrors: {},
      editorSessions: {},
      assistantDrafts: {},
      provider: {
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2:3b",
        timeoutMs: 60_000,
      },
      providers: [
        {
          id: "local-ollama",
          name: "Local Ollama",
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          model: "llama3.2:3b",
          timeoutMs: 60_000,
          assistantInstructions:
            "Help write clear, safe and reusable agent skills.",
        },
      ],
      activeProviderId: "local-ollama",
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      addSkill: (skill) => set((s) => ({ skills: [skill, ...s.skills] })),
      updateSkill: (id, value) =>
        set((s) => ({
          skills: s.skills.map((skill) =>
            skill.id === id ? { ...skill, ...value } : skill,
          ),
        })),
      removeSkill: (id) =>
        set((s) => {
          const removedTests = new Set(
            s.tests
              .filter((test) => test.skillId === id)
              .map((test) => test.id),
          );
          return {
            skills: s.skills.filter((skill) => skill.id !== id),
            editorSessions: Object.fromEntries(
              Object.entries(s.editorSessions).filter(([key]) => key !== id),
            ),
            assistantDrafts: Object.fromEntries(
              Object.entries(s.assistantDrafts).filter(([key]) => key !== id),
            ),
            assistantConversations: Object.fromEntries(
              Object.entries(s.assistantConversations).filter(
                ([key]) => !key.startsWith(`${id}:`),
              ),
            ),
            tests: s.tests.filter((test) => test.skillId !== id),
            testAttempts: s.testAttempts.filter(
              (attempt) => !removedTests.has(attempt.testId),
            ),
          };
        }),
      addProject: (project) =>
        set((s) => ({ projects: [...s.projects, project] })),
      updateProject: (id, value) =>
        set((s) => ({
          projects: s.projects.map((project) =>
            project.id === id ? { ...project, ...value } : project,
          ),
        })),
      removeProject: (id) =>
        set((s) => {
          const projectPath = s.projects.find(
            (project) => project.id === id,
          )?.path;
          return {
            projects: s.projects.filter((project) => project.id !== id),
            discoveredSkills: projectPath
              ? s.discoveredSkills.filter(
                  (skill) => skill.projectPath !== projectPath,
                )
              : s.discoveredSkills,
          };
        }),
      install: (name) =>
        set((s) => ({
          installed: s.installed.includes(name)
            ? s.installed
            : [...s.installed, name],
        })),
      setDiscoveredSkillName: (targetPath, name) =>
        set((s) => ({
          discoveredSkillNames: {
            ...s.discoveredSkillNames,
            [targetPath]: name.trim(),
          },
        })),
      setDiscoveredSkills: (discoveredSkills) => set({ discoveredSkills }),
      setDiscoveredSkillsForProject: (projectPath, skills) =>
        set((s) => ({
          discoveredSkills: [
            ...s.discoveredSkills.filter(
              (skill) => skill.projectPath !== projectPath,
            ),
            ...skills.map((skill) => ({ ...skill, projectPath })),
          ],
        })),
      requestInstalledRefresh: () =>
        set((s) => ({
          installedInventoryRevision: s.installedInventoryRevision + 1,
        })),
      setEditorMode: (editorMode) => set({ editorMode }),
      setProvider: (value) =>
        set((s) => ({ provider: { ...s.provider, ...value } })),
      addProvider: (provider) =>
        set((s) => ({ providers: [...s.providers, provider] })),
      updateProvider: (id, value) =>
        set((s) => ({
          providers: s.providers.map((provider) =>
            provider.id === id ? { ...provider, ...value } : provider,
          ),
          provider:
            s.activeProviderId === id
              ? ({ ...s.provider, ...value } as ProviderSettings)
              : s.provider,
        })),
      removeProvider: (id) =>
        set((s) => {
          const providers = s.providers.filter(
            (provider) => provider.id !== id,
          );
          if (s.activeProviderId !== id) return { providers };
          const next = providers[0];
          return {
            providers,
            activeProviderId: next?.id ?? "",
            provider: next
              ? {
                  kind: next.kind,
                  baseUrl: next.baseUrl,
                  model: next.model,
                  timeoutMs: next.timeoutMs,
                }
              : s.provider,
          };
        }),
      setActiveProvider: (id) =>
        set((s) => {
          const selected = s.providers.find((provider) => provider.id === id);
          return selected
            ? {
                activeProviderId: id,
                provider: {
                  kind: selected.kind,
                  baseUrl: selected.baseUrl,
                  model: selected.model,
                  timeoutMs: selected.timeoutMs,
                },
              }
            : {};
        }),
      addRun: (run) => set((s) => ({ runs: [run, ...s.runs].slice(0, 100) })),
      clearRuns: () => set({ runs: [] }),
      setTests: (next) => set({ tests: next }),
      addTest: (test) => set((s) => ({ tests: [test, ...s.tests] })),
      removeTest: (id) =>
        set((s) => ({
          tests: s.tests.filter((test) => test.id !== id),
          testAttempts: s.testAttempts.filter(
            (attempt) => attempt.testId !== id,
          ),
        })),
      addTestAttempts: (attempts) =>
        set((s) => ({
          testAttempts: [...attempts, ...s.testAttempts].slice(0, 1000),
        })),
      setAssistantWidth: (width) =>
        set({ assistantWidth: Math.min(640, Math.max(300, width)) }),
      setAssistantMessages: (key, messages) =>
        set((s) => ({
          assistantConversations: {
            ...s.assistantConversations,
            [key]: messages,
          },
        })),
      appendAssistantMessage: (key, message) =>
        set((s) => ({
          assistantConversations: {
            ...s.assistantConversations,
            [key]: [...(s.assistantConversations[key] ?? []), message],
          },
        })),
      setAssistantPending: (key, pending) =>
        set((s) => ({
          assistantPending: { ...s.assistantPending, [key]: pending },
        })),
      setAssistantError: (key, error) =>
        set((s) => ({
          assistantErrors: { ...s.assistantErrors, [key]: error },
        })),
      createAssistantThread: (providerId) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        set((s) => ({
          assistantThreads: {
            ...s.assistantThreads,
            [id]: {
              id,
              providerId,
              title: "New conversation",
              messages: [],
              createdAt: now,
              updatedAt: now,
            },
          },
          assistantThreadOrder: {
            ...s.assistantThreadOrder,
            [providerId]: [id, ...(s.assistantThreadOrder[providerId] ?? [])],
          },
          activeAssistantThreads: {
            ...s.activeAssistantThreads,
            [providerId]: id,
          },
        }));
        return id;
      },
      setActiveAssistantThread: (providerId, threadId) =>
        set((s) => ({
          activeAssistantThreads: {
            ...s.activeAssistantThreads,
            [providerId]: threadId,
          },
        })),
      setAssistantThreadMessages: (threadId, messages) =>
        set((s) => {
          const thread = s.assistantThreads[threadId];
          if (!thread) return {};
          const first = messages
            .find((message) => message.role === "user")
            ?.content.trim();
          return {
            assistantThreads: {
              ...s.assistantThreads,
              [threadId]: {
                ...thread,
                messages,
                title: first ? first.slice(0, 42) : thread.title,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      appendAssistantThreadMessage: (threadId, message) =>
        set((s) => {
          const thread = s.assistantThreads[threadId];
          if (!thread) return {};
          const messages = [...thread.messages, message];
          const first = messages
            .find((item) => item.role === "user")
            ?.content.trim();
          return {
            assistantThreads: {
              ...s.assistantThreads,
              [threadId]: {
                ...thread,
                messages,
                title: first ? first.slice(0, 42) : thread.title,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),
      deleteAssistantThread: (providerId, threadId) =>
        set((s) => {
          const threads = { ...s.assistantThreads };
          delete threads[threadId];
          const order = (s.assistantThreadOrder[providerId] ?? []).filter(
            (id) => id !== threadId,
          );
          const next = order[0] ?? "";
          return {
            assistantThreads: threads,
            assistantThreadOrder: {
              ...s.assistantThreadOrder,
              [providerId]: order,
            },
            activeAssistantThreads: {
              ...s.activeAssistantThreads,
              [providerId]: next,
            },
            assistantDrafts: Object.fromEntries(
              Object.entries(s.assistantDrafts).filter(
                ([key]) => key !== threadId,
              ),
            ),
          };
        }),
      setEditorSession: (key, session) =>
        set((s) => ({
          editorSessions: { ...s.editorSessions, [key]: session },
        })),
      setAssistantDraft: (key, value) =>
        set((s) => ({
          assistantDrafts: { ...s.assistantDrafts, [key]: value },
        })),
      runTests: async () => {
        let current: TestCase[] = [];
        let provider!: ProviderSettings;
        let apiKey: string | undefined;
        let skills: Skill[] = [];
        set((s) => {
          const profile = s.providers.find(
            (item) => item.id === s.activeProviderId,
          );
          current = s.tests;
          provider = profile ?? s.provider;
          apiKey = profile?.apiKey;
          skills = s.skills;
          return {
            tests: s.tests.map((test) => ({
              ...test,
              status: "running" as const,
            })),
          };
        });
        set({ tests: await executeTests(current, provider, skills, apiKey) });
      },
    }),
    {
      name: "skill-studio-v3",
      version: 1,
      storage: createJSONStorage(() => appStorage),
      partialize: ({
        theme,
        skills,
        projects,
        tests,
        testAttempts,
        installed,
        discoveredSkillNames,
        discoveredSkills,
        editorMode,
        provider,
        providers,
        activeProviderId,
        runs,
        assistantWidth,
        assistantConversations,
        assistantThreads,
        assistantThreadOrder,
        activeAssistantThreads,
        editorSessions,
        assistantDrafts,
      }) => ({
        theme,
        skills,
        projects,
        tests,
        testAttempts,
        installed,
        discoveredSkillNames,
        discoveredSkills,
        editorMode,
        provider,
        providers,
        activeProviderId,
        runs,
        assistantWidth,
        assistantConversations,
        assistantThreads,
        assistantThreadOrder,
        activeAssistantThreads,
        editorSessions,
        assistantDrafts,
      }),
    },
  ),
);
