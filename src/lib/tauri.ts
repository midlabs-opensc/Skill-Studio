import { invoke } from "@tauri-apps/api/core";

export type InstallScope = "project" | "global";
export interface OpenCodeDetection {
  detected: boolean;
  configPath: string | null;
  skillsPath: string;
  skillsCount: number;
  version: string | null;
}
export interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  platform: string;
  scope: InstallScope;
  targetPath: string;
  installedAt: string;
  managed: boolean;
  available: boolean;
  pathError?: string;
  identityKnown: boolean;
  projectPath?: string;
}
export interface CatalogSkill {
  id: string;
  source: string;
  slug: string;
  name: string;
  installs: string;
  url: string;
}
export interface CatalogSkillDetail {
  id: string;
  source: string;
  slug: string;
  name: string;
  description: string;
  content: string;
}
export interface WorkspaceEntry {
  path: string;
  name: string;
  isDir: boolean;
}
export interface WorkspaceSkill {
  id: string;
  path: string;
  content: string;
}
export interface PythonStatus {
  available: boolean;
  version: string | null;
}
export interface PythonRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}
export interface GithubAuthStatus {
  installed: boolean;
  authenticated: boolean;
  username: string | null;
}
export interface GithubAuthStart {
  code: string;
  verificationUrl: string;
}
export interface GithubPublishResult {
  repositoryUrl: string;
  installCommand: string;
}
export interface DeployedRepository {
  repository: string;
  repositoryUrl: string;
  skillId: string;
  workspacePath: string;
  createdAt: string;
  publishedAt: string;
  available: boolean;
  pushedAt: string | null;
  defaultBranch: string | null;
  visibility: string | null;
}

export function selectProjectDirectory(): Promise<string | null> {
  return invoke<string | null>("select_project_directory");
}

export function detectOpenCode(
  projectPath: string,
): Promise<OpenCodeDetection> {
  return invoke<OpenCodeDetection>("detect_open_code", { projectPath });
}

export function scanProjectSkills(
  projectPath: string,
  authoredWorkspacePaths: string[] = [],
): Promise<InstalledSkill[]> {
  return invoke<InstalledSkill[]>("scan_project_skills", {
    projectPath,
    authoredWorkspacePaths,
  });
}

export function deleteDiscoveredSkill(
  projectPath: string,
  targetPath: string,
  authoredWorkspacePaths: string[],
): Promise<void> {
  return invoke<void>("delete_discovered_skill", {
    projectPath,
    targetPath,
    authoredWorkspacePaths,
  });
}

export function installSkill(
  skillId: string,
  projectPath: string,
  scope: InstallScope,
  content?: string,
): Promise<InstalledSkill> {
  return invoke<InstalledSkill>("install_skill", {
    skillId,
    projectPath,
    scope,
    content,
  });
}

export function installLocalSkill(
  skillId: string,
  workspacePath: string,
  projectPath: string,
  scope: InstallScope,
  agent: string,
): Promise<InstalledSkill> {
  return invoke<InstalledSkill>("install_local_skill", {
    skillId,
    workspacePath,
    projectPath,
    scope,
    agent,
  });
}

export function uninstallSkill(
  skillId: string,
  targetPath: string,
): Promise<void> {
  return invoke<void>("uninstall_skill", { skillId, targetPath });
}

export function listInstalledSkills(): Promise<InstalledSkill[]> {
  return invoke<InstalledSkill[]>("list_installed_skills");
}

export const searchSkillCatalog = (query: string) =>
  invoke<CatalogSkill[]>("search_skill_catalog", { query });
export const popularSkillCatalog = (limit: number) =>
  invoke<CatalogSkill[]>("popular_skill_catalog", { limit });
export const getCatalogSkill = (source: string, slug: string) =>
  invoke<CatalogSkillDetail>("get_catalog_skill", { source, slug });
export const installCatalogSkill = (
  source: string,
  slug: string,
  projectPath: string,
  scope: InstallScope,
  agent: string,
) =>
  invoke<string>("install_catalog_skill", {
    source,
    slug,
    projectPath,
    scope,
    agent,
  });
export const removeCatalogSkill = (targetPath: string) =>
  invoke<string>("remove_catalog_skill", { targetPath });
export const updateCatalogSkill = (targetPath: string) =>
  invoke<string>("update_catalog_skill", { targetPath });
export const forgetCatalogSkill = (targetPath: string) =>
  invoke<void>("forget_catalog_skill", { targetPath });
export const loadAppState = () => invoke<string | null>("load_app_state");
export const saveAppState = (value: string) =>
  invoke<void>("save_app_state", { value });
export const createSkillWorkspace = (
  projectPath: string,
  skillId: string,
  template: string,
) =>
  invoke<string>("create_skill_workspace", { projectPath, skillId, template });
export const discoverSkillWorkspaces = (projectPath: string) =>
  invoke<WorkspaceSkill[]>("discover_skill_workspaces", { projectPath });
export const listWorkspace = (root: string) =>
  invoke<WorkspaceEntry[]>("list_workspace", { root });
export const readWorkspaceFile = (root: string, path: string) =>
  invoke<string>("read_workspace_file", { root, path });
export const writeWorkspaceFile = (
  root: string,
  path: string,
  content: string,
) => invoke<void>("write_workspace_file", { root, path, content });
export const createWorkspaceEntry = (
  root: string,
  path: string,
  isDir: boolean,
) => invoke<void>("create_workspace_entry", { root, path, isDir });
export const moveWorkspaceEntry = (root: string, from: string, to: string) =>
  invoke<void>("move_workspace_entry", { root, from, to });
export const deleteWorkspaceEntry = (root: string, path: string) =>
  invoke<void>("delete_workspace_entry", { root, path });
export const deleteSkillWorkspace = (root: string) =>
  invoke<void>("delete_skill_workspace", { root });
export const getPythonStatus = () => invoke<PythonStatus>("python_status");
export const runPythonFile = (root: string, path: string, timeoutMs = 10_000) =>
  invoke<PythonRunResult>("run_python_file", { root, path, timeoutMs });
export const githubAuthStatus = () =>
  invoke<GithubAuthStatus>("github_auth_status");
export const githubAuthLogin = () =>
  invoke<GithubAuthStart>("github_auth_login");
export const githubAuthLogout = () =>
  invoke<GithubAuthStatus>("github_auth_logout");
export const listDeployedRepositories = (refresh = false) =>
  invoke<DeployedRepository[]>("list_deployed_repositories", { refresh });
export const publishSkillToGithub = (
  skillId: string,
  workspacePath: string,
  repository: string,
  description: string,
) =>
  invoke<GithubPublishResult>("publish_skill_to_github", {
    skillId,
    workspacePath,
    repository,
    description,
  });
export const updateDeployedRepository = (
  repository: string,
  workspacePath: string,
) =>
  invoke<DeployedRepository>("update_deployed_repository", {
    repository,
    workspacePath,
  });
export const forgetDeployedRepository = (repository: string) =>
  invoke<void>("forget_deployed_repository", { repository });
export const openExternalUrl = (url: string) =>
  invoke<void>("open_external_url", { url });
