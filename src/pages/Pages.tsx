import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import MonacoEditor from "@monaco-editor/react";
import type { editor as Monaco } from "monaco-editor";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Blocks,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  CloudUpload,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File,
  FileJson,
  FileText,
  Filter,
  FolderKanban,
  GitBranch,
  GitCompare,
  GripVertical,
  Info,
  LogOut,
  MoreHorizontal,
  PackagePlus,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  TestTube2,
  Trash2,
  Wand2,
  Workflow as WorkflowIcon,
  XCircle,
  Zap,
} from "lucide-react";
import { useStudio } from "../store";
import { Modal } from "../components/Modal";
import { DismissibleMessage } from "../components/DismissibleMessage";
import {
  aiProvider,
  getSessionApiKey,
  isTauri,
  setSessionApiKey,
} from "../services/ai";
import { executeTests } from "../services/tests";
import { presentProviderError } from "../services/providerErrors";
import {
  GEMINI_DEFAULT_MODEL,
  chooseGeminiDefaultModel,
  isGeminiBaseUrl,
} from "../services/geminiModels";
import {
  detectOpenCode,
  createWorkspaceEntry,
  deleteDiscoveredSkill,
  deleteSkillWorkspace,
  deleteWorkspaceEntry,
  forgetDeployedRepository,
  forgetCatalogSkill,
  getCatalogSkill,
  getPythonStatus,
  githubAuthLogin,
  githubAuthLogout,
  githubAuthStatus,
  installCatalogSkill,
  installLocalSkill,
  installSkill,
  listInstalledSkills,
  listDeployedRepositories,
  listWorkspace,
  moveWorkspaceEntry,
  openExternalUrl,
  readWorkspaceFile,
  runPythonFile,
  removeCatalogSkill,
  popularSkillCatalog,
  publishSkillToGithub,
  scanProjectSkills,
  searchSkillCatalog,
  selectProjectDirectory,
  uninstallSkill,
  updateCatalogSkill,
  updateDeployedRepository,
  writeWorkspaceFile,
  type InstalledSkill,
  type CatalogSkill,
  type CatalogSkillDetail,
  type WorkspaceEntry,
  type GithubAuthStart,
  type GithubAuthStatus,
  type DeployedRepository,
  type PythonRunResult,
  type PythonStatus,
} from "../lib/tauri";
import { validateProjectPath, validateSlug } from "../lib/validation";
import type {
  ChatMessage,
  ModelInfo,
  ProviderKind,
  Skill,
  TestAssertion,
} from "../types";

const Header = ({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) => (
  <div className="page-header">
    <div>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    <div className="header-actions">{actions}</div>
  </div>
);
const Stat = ({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) => (
  <div className="stat">
    <span>{label}</span>
    <strong>{value}</strong>
    {delta && <small>{delta}</small>}
  </div>
);
const Status = ({ value }: { value: string }) => (
  <span className={`status ${value.toLowerCase().replace(" ", "-")}`}>
    <i />
    {value}
  </span>
);

const ProviderErrorMessage = ({
  error,
  provider,
  onDismiss,
}: {
  error: unknown;
  provider?: ProviderKind;
  onDismiss?: () => void;
}) => {
  const presented = presentProviderError(error, provider);
  return (
    <DismissibleMessage role="alert" onDismiss={onDismiss}>
      <span className="provider-error-summary">{presented.summary}</span>
      {presented.recognized && presented.detail !== presented.summary && (
        <details className="provider-error-details">
          <summary>Technical details</summary>
          <pre>{presented.detail}</pre>
        </details>
      )}
    </DismissibleMessage>
  );
};

const openWebsite = async (url: string) => {
  if (isTauri()) await openExternalUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
};

const editorLanguage = (path: string) => {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  const extension = name.split(".").at(-1);
  return (
    (
      {
        md: "markdown",
        mdx: "markdown",
        py: "python",
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        json: "json",
        jsonc: "json",
        yml: "yaml",
        yaml: "yaml",
        toml: "ini",
        rs: "rust",
        go: "go",
        java: "java",
        c: "c",
        h: "c",
        cpp: "cpp",
        hpp: "cpp",
        cs: "csharp",
        php: "php",
        rb: "ruby",
        sh: "shell",
        bash: "shell",
        zsh: "shell",
        ps1: "powershell",
        html: "html",
        htm: "html",
        css: "css",
        scss: "scss",
        less: "less",
        xml: "xml",
        sql: "sql",
      } as Record<string, string>
    )[extension ?? ""] ?? "plaintext"
  );
};

export function Deploy() {
  const skills = useStudio((state) => state.skills);
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  const [repositoryName, setRepositoryName] = useState("");
  const [notice, setNotice] = useState("");
  const [auth, setAuth] = useState<GithubAuthStatus | null>(null);
  const [authStart, setAuthStart] = useState<GithubAuthStart | null>(null);
  const [busy, setBusy] = useState("");
  const [deployments, setDeployments] = useState<DeployedRepository[]>([]);
  const skill = skills.find((item) => item.id === skillId);
  const validName = /^[A-Za-z0-9_.-]+$/.test(repositoryName.trim());
  const source =
    auth?.username && validName
      ? `${auth.username}/${repositoryName.trim()}`
      : "OWNER/REPOSITORY";
  const repository =
    source === "OWNER/REPOSITORY" ? "" : `https://github.com/${source}`;
  const installCommand = `npx skills add ${source}${skill ? ` --skill ${skill.id}` : ""}`;
  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all([githubAuthStatus(), listDeployedRepositories()])
      .then(([status, rows]) => {
        setAuth(status);
        setDeployments(rows);
      })
      .catch((error) =>
        setNotice(error instanceof Error ? error.message : String(error)),
      );
  }, []);
  useEffect(() => {
    if (busy !== "auth") return;
    let attempts = 0;
    const check = () => {
      attempts += 1;
      void githubAuthStatus().then((status) => {
        setAuth(status);
        if (status.authenticated) {
          window.clearInterval(poll);
          setBusy("");
          setAuthStart(null);
          setNotice(`Signed in securely as ${status.username}.`);
          void listDeployedRepositories(true).then(setDeployments);
        } else if (attempts >= 120) {
          window.clearInterval(poll);
          setBusy("");
          setAuthStart(null);
          setNotice("GitHub sign-in timed out. You can start it again.");
        }
      });
    };
    const poll = window.setInterval(check, 500);
    check();
    return () => window.clearInterval(poll);
  }, [busy]);
  const signIn = async () => {
    setBusy("auth");
    setNotice(
      "Complete the GitHub browser flow. The one-time code is copied to your clipboard.",
    );
    try {
      setAuthStart(await githubAuthLogin());
    } catch (error) {
      setBusy("");
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const publish = async () => {
    if (!skill?.workspacePath || !auth?.username || !validName) return;
    setBusy("publish");
    setNotice("Creating a public repository and pushing the skill...");
    try {
      const result = await publishSkillToGithub(
        skill.id,
        skill.workspacePath,
        `${auth.username}/${repositoryName.trim()}`,
        skill.description,
      );
      setNotice(`Published successfully. ${result.repositoryUrl}`);
      setDeployments(await listDeployedRepositories(true));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const refreshDeployments = async () => {
    setBusy("refresh");
    setNotice("");
    try {
      setDeployments(await listDeployedRepositories(true));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const logout = async () => {
    setBusy("logout");
    setNotice("");
    try {
      setAuth(await githubAuthLogout());
      setAuthStart(null);
      setNotice("Signed out from GitHub on this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const updateDeployment = async (deployment: DeployedRepository) => {
    const currentSkill = skills.find((item) => item.id === deployment.skillId);
    const workspacePath =
      currentSkill?.workspacePath ?? deployment.workspacePath;
    setBusy(`update:${deployment.repository}`);
    setNotice("");
    try {
      await updateDeployedRepository(deployment.repository, workspacePath);
      setDeployments(await listDeployedRepositories(true));
      setNotice(`${deployment.repository} updated successfully.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const forgetDeployment = async (deployment: DeployedRepository) => {
    setBusy(`forget:${deployment.repository}`);
    setNotice("");
    try {
      await forgetDeployedRepository(deployment.repository);
      setDeployments((rows) =>
        rows.filter((row) => row.repository !== deployment.repository),
      );
      setNotice(
        `Forgot ${deployment.repository}. The GitHub repository was not deleted.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const copyCommand = async () => {
    await navigator.clipboard.writeText(installCommand);
    setNotice("Install verification command copied.");
  };
  return (
    <div className="page deploy-page">
      <Header
        eyebrow="DISTRIBUTION / SKILLS.SH"
        title="Deploy a skill"
        description="Create a public GitHub repository, push your complete skill workspace, and prepare it for skills.sh discovery without leaving Skill Studio."
      />
      <div className="deploy-grid">
        <section className="panel deploy-config">
          <div className="panel-title">
            <div>
              <span className="eyebrow">PUBLISH TARGET</span>
              <h3>GitHub repository</h3>
            </div>
            <Status
              value={
                auth?.authenticated && validName && skill?.workspacePath
                  ? "Ready"
                  : "Draft"
              }
            />
          </div>
          <label>
            Skill
            <select
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
            >
              <option value="">Select a skill</option>
              {skills.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            New repository name
            <input
              value={repositoryName}
              onChange={(event) => {
                setRepositoryName(event.target.value);
                setNotice("");
              }}
              placeholder="my-skill"
            />
            <small>
              {auth?.username
                ? `The public repository will be created as ${auth.username}/${repositoryName || "repository"}.`
                : "Sign in to select your GitHub account."}
            </small>
          </label>
          <div className="deploy-auth">
            <ShieldCheck size={18} />
            <div>
              <b>
                {auth?.authenticated
                  ? `Connected as ${auth.username}`
                  : "Secure GitHub authentication"}
              </b>
              <p>
                Skill Studio delegates authentication and credential storage to
                its bundled GitHub CLI. No token is stored in application state.
              </p>
            </div>
            <div className="deploy-auth-actions">
              {!auth?.authenticated ? (
                <button
                  className="button"
                  disabled={busy === "auth"}
                  onClick={() => void signIn()}
                >
                  {busy === "auth"
                    ? "Waiting for GitHub..."
                    : "Sign in with GitHub"}
                </button>
              ) : (
                <button
                  className="button"
                  disabled={Boolean(busy)}
                  onClick={() => void logout()}
                >
                  <LogOut size={14} />
                  {busy === "logout" ? "Signing out..." : "Log out"}
                </button>
              )}
            </div>
          </div>
          {!isTauri() && (
            <DismissibleMessage role="alert">
              GitHub publishing is available in the Tauri desktop app.
            </DismissibleMessage>
          )}
          {auth && !auth.installed && (
            <DismissibleMessage role="alert">
              The bundled GitHub tools are unavailable. Reinstall Skill Studio.
            </DismissibleMessage>
          )}
          <button
            className="button primary deploy-publish"
            disabled={
              !isTauri() ||
              !auth?.authenticated ||
              !validName ||
              !skill?.workspacePath ||
              Boolean(busy)
            }
            onClick={() => void publish()}
          >
            <CloudUpload size={15} />
            {busy === "publish"
              ? "Creating repository and pushing..."
              : "Create repository and publish"}
          </button>
          {(busy === "publish" || busy.startsWith("update:")) && (
            <div className="deploy-progress" role="status">
              <div>
                <RefreshCw className="spin" size={15} />
                <b>
                  {busy === "publish"
                    ? "Creating repository and publishing"
                    : "Syncing workspace to GitHub"}
                </b>
                <span>Git operations can take a moment.</span>
              </div>
              <i>
                <b />
              </i>
            </div>
          )}
          <div className="deploy-command">
            <span>VERIFY AFTER PUSH</span>
            <code>{installCommand}</code>
            <button
              className="icon-btn"
              aria-label="Copy command"
              onClick={() => void copyCommand()}
            >
              <Copy size={14} />
            </button>
          </div>
          {notice && (
            <div className="manager-message deploy-notice" role="status">
              <span>{notice}</span>
              <button
                className="icon-btn"
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <XCircle size={14} />
              </button>
            </div>
          )}
        </section>
        <section className="panel deploy-steps">
          <span className="eyebrow">RELEASE CHECKLIST</span>
          <h3>Make it discoverable</h3>
          <ol>
            <li>
              <CheckCircle2 size={15} />
              <span>
                <b>Review the skill</b>
                <small>
                  Keep secrets out of SKILL.md and supporting files.
                </small>
              </span>
            </li>
            <li>
              <CheckCircle2 size={15} />
              <span>
                <b>Push to a public GitHub repository</b>
                <small>
                  Place the skill folder and SKILL.md in the repository.
                </small>
              </span>
            </li>
            <li>
              <CheckCircle2 size={15} />
              <span>
                <b>Install with the official CLI</b>
                <small>
                  Run the generated command so the public source can be
                  resolved.
                </small>
              </span>
            </li>
            <li>
              <CheckCircle2 size={15} />
              <span>
                <b>Wait for catalog indexing</b>
                <small>
                  Skills.sh discovers public GitHub skills; indexing is not
                  necessarily immediate.
                </small>
              </span>
            </li>
          </ol>
          <div className="deploy-links">
            <button
              className="button primary"
              disabled={!repository || !skill}
              onClick={() => void openWebsite(repository)}
            >
              <CloudUpload size={15} />
              Open repository
            </button>
            <button
              className="button"
              onClick={() => void openWebsite("https://skills.sh")}
            >
              <ExternalLink size={14} />
              Open skills.sh
            </button>
          </div>
        </section>
      </div>
      <section className="panel deployed-repositories">
        <div className="deployed-head">
          <div>
            <span className="eyebrow">GITHUB / MANAGED SOURCES</span>
            <h2>Deployed repositories</h2>
            <p>
              Refresh remote status, publish workspace updates, or remove stale
              local records.
            </p>
          </div>
          <button
            className="button"
            disabled={!auth?.authenticated || Boolean(busy)}
            onClick={() => void refreshDeployments()}
          >
            <RefreshCw className={busy === "refresh" ? "spin" : ""} size={14} />
            {busy === "refresh" ? "Checking GitHub..." : "Refresh repositories"}
          </button>
        </div>
        <div className="deployed-summary">
          <div>
            <span>Tracked</span>
            <b>{deployments.length}</b>
          </div>
          <div>
            <span>Available</span>
            <b>{deployments.filter((item) => item.available).length}</b>
          </div>
          <div>
            <span>Missing</span>
            <b>{deployments.filter((item) => !item.available).length}</b>
          </div>
          <div>
            <span>Account</span>
            <b>{auth?.username ?? "Not connected"}</b>
          </div>
        </div>
        {busy === "refresh" && (
          <div className="deploy-progress compact" role="status">
            <div>
              <RefreshCw className="spin" size={15} />
              <b>Checking every tracked repository</b>
              <span>Manual GitHub deletions will be marked missing.</span>
            </div>
            <i>
              <b />
            </i>
          </div>
        )}
        <div className="deployed-list">
          {deployments.map((deployment) => {
            const deployedSkill = skills.find(
              (item) => item.id === deployment.skillId,
            );
            const updating = busy === `update:${deployment.repository}`;
            const forgetting = busy === `forget:${deployment.repository}`;
            const command = `npx skills add ${deployment.repository} --skill ${deployment.skillId}`;
            return (
              <article
                className={`deployed-card ${deployment.available ? "" : "missing"}`}
                key={deployment.repository}
              >
                <div className="deployed-repo-icon">
                  <GitBranch size={18} />
                </div>
                <div className="deployed-copy">
                  <div>
                    <h3>{deployment.repository}</h3>
                    <Status
                      value={deployment.available ? "Active" : "Missing"}
                    />
                  </div>
                  <p>
                    {deployedSkill?.description ||
                      `Published skill: ${deployment.skillId}`}
                  </p>
                  <code title={command}>{command}</code>
                  <div className="deployed-meta">
                    <span>
                      <b>Skill</b>
                      {deployedSkill?.name ?? deployment.skillId}
                    </span>
                    <span>
                      <b>Visibility</b>
                      {deployment.visibility?.toLowerCase() ?? "unknown"}
                    </span>
                    <span>
                      <b>Branch</b>
                      {deployment.defaultBranch ?? "unknown"}
                    </span>
                    <span>
                      <b>Last Studio publish</b>
                      {new Date(deployment.publishedAt).toLocaleString()}
                    </span>
                    <span>
                      <b>Last GitHub push</b>
                      {deployment.pushedAt
                        ? new Date(deployment.pushedAt).toLocaleString()
                        : "Refresh to check"}
                    </span>
                  </div>
                  {!deployment.available && (
                    <p className="deployed-warning">
                      The repository may have been deleted, renamed, made
                      inaccessible, or the current account may lack permission.
                    </p>
                  )}
                </div>
                <div className="deployed-actions">
                  <button
                    className="button"
                    disabled={
                      !deployment.available ||
                      !auth?.authenticated ||
                      Boolean(busy)
                    }
                    onClick={() => void updateDeployment(deployment)}
                  >
                    <RefreshCw className={updating ? "spin" : ""} size={14} />
                    {updating ? "Updating..." : "Update from workspace"}
                  </button>
                  <button
                    className="button"
                    disabled={!deployment.available}
                    onClick={() => void openWebsite(deployment.repositoryUrl)}
                  >
                    <ExternalLink size={14} />
                    Open repository
                  </button>
                  <button
                    className="button"
                    onClick={() => void navigator.clipboard.writeText(command)}
                  >
                    <Copy size={14} />
                    Copy install command
                  </button>
                  <button
                    className="button danger"
                    disabled={Boolean(busy)}
                    title="Remove only the Skill Studio record"
                    onClick={() => void forgetDeployment(deployment)}
                  >
                    <Trash2 size={14} />
                    {forgetting ? "Forgetting..." : "Forget record"}
                  </button>
                </div>
              </article>
            );
          })}
          {!deployments.length && (
            <div className="deployed-empty">
              <CloudUpload size={24} />
              <b>No deployed repositories yet</b>
              <p>
                Publish a skill above. The repository will appear here for
                future updates and status checks.
              </p>
            </div>
          )}
        </div>
      </section>
      {authStart && (
        <Modal
          title="Complete GitHub sign-in"
          onClose={() => setAuthStart(null)}
        >
          <p>
            Enter this one-time code on the GitHub device page. Never share it
            with anyone.
          </p>
          <div className="github-device-code">
            <span>ONE-TIME CODE</span>
            <strong>{authStart.code}</strong>
            <button
              className="icon-btn"
              aria-label="Copy GitHub device code"
              onClick={() => void navigator.clipboard.writeText(authStart.code)}
            >
              <Copy size={15} />
            </button>
          </div>
          <p className="muted">
            The browser page is already open. Paste the code, authorize Skill
            Studio, then return here.
          </p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => void openWebsite(authStart.verificationUrl)}
            >
              <ExternalLink size={14} /> Open GitHub device page
            </button>
            <button
              className="button primary"
              onClick={() => setAuthStart(null)}
            >
              Continue in background
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const cliCatalog = [
  {
    name: "OpenCode",
    price: "Free · Open source",
    kind: "General coding agent",
    url: "https://opencode.ai",
    description: "Terminal-first open source coding agent with skill support.",
  },
  {
    name: "Claude Code",
    price: "Paid plan / API",
    kind: "Anthropic",
    url: "https://www.anthropic.com/claude-code",
    description: "Agentic coding CLI from Anthropic for repository-scale work.",
  },
  {
    name: "Codex CLI",
    price: "ChatGPT plan / API",
    kind: "OpenAI",
    url: "https://openai.com/codex",
    description: "OpenAI's local coding agent for terminal workflows.",
  },
  {
    name: "Gemini CLI",
    price: "Free tier · Paid usage",
    kind: "Google",
    url: "https://github.com/google-gemini/gemini-cli",
    description: "Open source terminal agent with a Gemini free allowance.",
  },
  {
    name: "GitHub Copilot CLI",
    price: "Paid · Limited free plan",
    kind: "GitHub",
    url: "https://github.com/features/copilot/cli",
    description: "GitHub-native terminal coding and repository assistance.",
  },
  {
    name: "Cursor",
    price: "Free · Paid plans",
    kind: "Desktop + CLI",
    url: "https://cursor.com",
    description: "AI code editor with agent workflows and command-line tools.",
  },
  {
    name: "Cline",
    price: "Free · API usage costs",
    kind: "Open source",
    url: "https://cline.bot",
    description: "Autonomous coding agent using your selected model provider.",
  },
  {
    name: "Roo Code",
    price: "Free · API usage costs",
    kind: "Open source",
    url: "https://roo.ai",
    description: "Extensible coding agent with modes and provider choice.",
  },
  {
    name: "Aider",
    price: "Free · API usage costs",
    kind: "Open source CLI",
    url: "https://aider.chat",
    description: "Git-aware pair programming directly from the terminal.",
  },
  {
    name: "Continue",
    price: "Free · Team plans",
    kind: "Open source",
    url: "https://continue.dev",
    description: "Open source coding agents and model workflows.",
  },
  {
    name: "Windsurf",
    price: "Free · Paid plans",
    kind: "Editor + CLI",
    url: "https://windsurf.com",
    description: "Agentic development environment and terminal workflow.",
  },
  {
    name: "Amp",
    price: "Free credits · Paid usage",
    kind: "Coding agent",
    url: "https://ampcode.com",
    description: "A focused agent for complex software engineering tasks.",
  },
  {
    name: "Sourcegraph Cody",
    price: "Free · Enterprise",
    kind: "Code intelligence",
    url: "https://www.sourcegraph.com/cody",
    description: "Codebase-aware assistant backed by Sourcegraph context.",
  },
  {
    name: "Tabnine",
    price: "Free · Paid plans",
    kind: "Enterprise AI",
    url: "https://www.tabnine.com",
    description: "Private and enterprise-focused AI coding assistance.",
  },
  {
    name: "JetBrains AI",
    price: "Paid · Trial available",
    kind: "IDE + terminal",
    url: "https://www.jetbrains.com/ai",
    description: "AI Assistant and Junie inside JetBrains development tools.",
  },
  {
    name: "Warp",
    price: "Free · Paid plans",
    kind: "Agentic terminal",
    url: "https://www.warp.dev",
    description: "Modern terminal with integrated coding agents.",
  },
] as const;

export function CliCatalog() {
  const [filter, setFilter] = useState("");
  const shown = cliCatalog.filter((item) =>
    `${item.name} ${item.kind} ${item.price}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <div className="page cli-page">
      <Header
        eyebrow="TOOLS / ECOSYSTEM"
        title="AI coding CLIs"
        description="Compare free, open-source, and commercial coding agents. Pricing and free tiers can change; verify them on each provider's site."
      />
      <div className="cli-search">
        <Search size={17} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search CLIs, providers, or pricing..."
        />
      </div>
      <div className="cli-grid">
        {shown.map((item) => (
          <article className="cli-card" key={item.name}>
            <div>
              <span className="cli-terminal">
                <Terminal size={18} />
              </span>
              <Status
                value={item.price.startsWith("Free") ? "Free option" : "Paid"}
              />
            </div>
            <h3>{item.name}</h3>
            <span className="eyebrow">{item.kind}</span>
            <p>{item.description}</p>
            <b>{item.price}</b>
            <button
              className="button"
              onClick={() => void openWebsite(item.url)}
            >
              Visit website <ExternalLink size={13} />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function SkillActionControls({
  skill,
  onOpen,
  card = false,
}: {
  skill: Skill;
  onOpen?: () => void;
  card?: boolean;
}) {
  const { projects, removeSkill, requestInstalledRefresh } = useStudio();
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [removalError, setRemovalError] = useState("");
  const [installScope, setInstallScope] = useState<"project" | "global">(
    "project",
  );
  const [installProjectPath, setInstallProjectPath] = useState(
    projects[0]?.path ?? "",
  );
  const [installAgent, setInstallAgent] = useState("universal");
  const [installBusy, setInstallBusy] = useState(false);
  const [installNotice, setInstallNotice] = useState("");

  const action = (
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    options?: { danger?: boolean; disabled?: boolean },
  ) => (
    <button
      className={
        card ? `button ${options?.danger ? "danger" : ""}` : "icon-btn"
      }
      title={title}
      disabled={options?.disabled}
      onClick={onClick}
    >
      {icon}
      {card && title}
    </button>
  );

  return (
    <div
      className={card ? "dashboard-skill-actions" : "skill-row-actions"}
      onClick={(event) => event.stopPropagation()}
    >
      {action(
        "Install",
        <PackagePlus size={14} />,
        () => {
          setInstalling(true);
          setInstallNotice("");
          if (!installProjectPath && projects[0])
            setInstallProjectPath(projects[0].path);
        },
        { disabled: !skill.workspacePath },
      )}
      {action(
        "Remove",
        <Trash2 size={14} />,
        () => {
          setRemoving(true);
          setDeleteFiles(false);
          setRemovalError("");
        },
        { danger: card },
      )}
      {onOpen && action("Open", <ChevronRight size={15} />, onOpen)}

      {installing && (
        <Modal
          title={`Install ${skill.name}`}
          onClose={() => !installBusy && setInstalling(false)}
          wide
        >
          <p>
            Copy the complete authored workspace into a project or global
            assistant skill directory.
          </p>
          <div className="install-options">
            <label>
              Target assistant
              <select
                value={installAgent}
                disabled={installBusy}
                onChange={(event) => setInstallAgent(event.target.value)}
              >
                <option value="universal">Default / General</option>
                <option value="opencode">OpenCode</option>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="github-copilot">GitHub Copilot</option>
                <option value="antigravity">Antigravity</option>
                <option value="cursor">Cursor</option>
                <option value="gemini-cli">Gemini CLI</option>
              </select>
            </label>
            <label>
              Install scope
              <select
                value={installScope}
                disabled={installBusy}
                onChange={(event) =>
                  setInstallScope(event.target.value as "project" | "global")
                }
              >
                <option value="project">Project</option>
                <option value="global">Global</option>
              </select>
            </label>
            {installScope === "project" && (
              <label className="span2">
                Saved project
                <select
                  value={installProjectPath}
                  disabled={installBusy}
                  onChange={(event) =>
                    setInstallProjectPath(event.target.value)
                  }
                >
                  <option value="">Select a project or browse below</option>
                  {projects.map((project) => (
                    <option value={project.path} key={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <span className="install-path-picker">
                  <input
                    value={installProjectPath}
                    disabled={installBusy}
                    onChange={(event) =>
                      setInstallProjectPath(event.target.value)
                    }
                    placeholder="Project directory"
                  />
                  <button
                    className="button"
                    disabled={installBusy}
                    onClick={async () => {
                      try {
                        const path = await selectProjectDirectory();
                        if (path) setInstallProjectPath(path);
                      } catch (error) {
                        setInstallNotice(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }}
                  >
                    Browse
                  </button>
                </span>
              </label>
            )}
          </div>
          {installNotice && (
            <DismissibleMessage onDismiss={() => setInstallNotice("")}>
              {installNotice}
            </DismissibleMessage>
          )}
          {installBusy && (
            <div className="operation-bar modal-operation" role="status">
              <RefreshCw className="spin" size={15} />
              <span>Installing {skill.name}...</span>
              <i>
                <b />
              </i>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={installBusy}
              onClick={() => setInstalling(false)}
            >
              Close
            </button>
            <button
              className="button primary"
              disabled={
                installBusy ||
                !skill.workspacePath ||
                (installScope === "project" && !installProjectPath.trim()) ||
                !isTauri()
              }
              onClick={async () => {
                if (!skill.workspacePath) return;
                setInstallBusy(true);
                setInstallNotice("");
                try {
                  const installed = await installLocalSkill(
                    skill.id,
                    skill.workspacePath,
                    installProjectPath,
                    installScope,
                    installAgent,
                  );
                  setInstallNotice(`Installed to ${installed.targetPath}.`);
                  requestInstalledRefresh();
                } catch (error) {
                  setInstallNotice(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  setInstallBusy(false);
                }
              }}
            >
              <PackagePlus size={14} />
              {installBusy ? "Installing..." : "Install skill"}
            </button>
          </div>
        </Modal>
      )}

      {removing && (
        <Modal
          title="Remove skill"
          onClose={() => !removalBusy && setRemoving(false)}
        >
          <p>
            Remove <b>{skill.name}</b> from Skill Studio?
          </p>
          {skill.workspacePath && (
            <label className="delete-files-option">
              <input
                type="checkbox"
                checked={deleteFiles}
                disabled={removalBusy}
                onChange={(event) => setDeleteFiles(event.target.checked)}
              />
              <span>
                <b>Also delete workspace files</b>
                <small>
                  This permanently deletes the skill folder from disk.
                </small>
              </span>
            </label>
          )}
          {removalError && (
            <DismissibleMessage
              role="alert"
              onDismiss={() => setRemovalError("")}
            >
              {removalError}
            </DismissibleMessage>
          )}
          {removalBusy && (
            <div className="operation-bar modal-operation" role="status">
              <RefreshCw className="spin" size={15} />
              <span>
                {deleteFiles
                  ? `Deleting ${skill.name} files...`
                  : `Removing ${skill.name} from Studio...`}
              </span>
              <i>
                <b />
              </i>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={removalBusy}
              onClick={() => setRemoving(false)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={removalBusy}
              onClick={async () => {
                setRemovalBusy(true);
                setRemovalError("");
                try {
                  if (deleteFiles && skill.workspacePath)
                    await deleteSkillWorkspace(skill.workspacePath);
                  removeSkill(skill.id);
                  setRemoving(false);
                } catch (error) {
                  setRemovalError(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  setRemovalBusy(false);
                }
              }}
            >
              {removalBusy
                ? "Removing..."
                : deleteFiles
                  ? "Delete files and remove"
                  : "Remove from Studio"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Dashboard() {
  const { skills, runs } = useStudio();
  const navigate = useNavigate();
  const passed = runs.filter((run) => run.status === "passed").length;
  const successRate = runs.length
    ? Math.round((passed / runs.length) * 100)
    : 0;
  const averageLatency = runs.length
    ? Math.round(
        runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length,
      )
    : 0;
  const chart = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = date.toDateString();
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      runs: runs.filter((run) => new Date(run.createdAt).toDateString() === key)
        .length,
    };
  });
  return (
    <div className="page">
      <Header
        eyebrow="WORKSPACE / OVERVIEW"
        title="Build skills that do real work"
        description="Design, test, and ship reusable AI capabilities from one workspace."
        actions={
          <>
            <button
              className="button primary"
              onClick={() => navigate("/playground")}
            >
              <Play size={15} />
              Open playground
            </button>
          </>
        }
      />
      <section className="stat-grid">
        <Stat label="Total runs" value={String(runs.length)} />
        <Stat label="Success rate" value={`${successRate}%`} />
        <Stat label="Skills" value={String(skills.length)} />
        <Stat label="Avg. latency" value={`${averageLatency}ms`} />
      </section>
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">ACTIVITY</span>
              <h3>Skill runs</h3>
            </div>
            <span className="muted">Last 7 days</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="fillRuns" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c6df2" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#7c6df2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--border)"
              />
              <XAxis dataKey="day" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              />
              <Area
                type="monotone"
                dataKey="runs"
                stroke="#8b7cf6"
                strokeWidth={2}
                fill="url(#fillRuns)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>
        <section className="panel activity">
          <div className="panel-title">
            <h3>Recent activity</h3>
            <Link className="text-btn" to="/runs">
              View all
            </Link>
          </div>
          {runs.slice(0, 4).map((run) => (
            <div className="activity-row" key={run.id}>
              <span className="activity-icon">
                <Check size={14} />
              </span>
              <div>
                <b>
                  {skills.find((skill) => skill.id === run.skillId)?.name ??
                    "Deleted skill"}
                </b>
                <small>
                  {run.status} · {new Date(run.createdAt).toLocaleString()}
                </small>
              </div>
            </div>
          ))}
          {!runs.length && <p className="muted">No runs yet.</p>}
        </section>
      </div>
      <div className="section-title">
        <div>
          <span className="eyebrow">YOUR LIBRARY</span>
          <h2>Skills</h2>
        </div>
        <Link className="text-btn" to="/skills">
          View all <ArrowRight size={14} />
        </Link>
      </div>
      <section className="skill-grid">
        {skills.map((s) => (
          <article
            className="skill-card"
            key={s.id}
            onClick={() => navigate(`/skills/${s.id}/editor`)}
          >
            <div className="skill-card-head">
              <span className="skill-icon">{s.icon}</span>
              <Status value={s.status} />
            </div>
            <h3>{s.name}</h3>
            <p>{s.description}</p>
            <div className="tags">
              {s.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="skill-meta">
              <span>v{s.version}</span>
              <span>{s.runs.toLocaleString()} runs</span>
              <span>{s.passRate}% pass</span>
            </div>
            <div className="skill-footer">
              <span>
                Updated{" "}
                {new Date(s.updated).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <SkillActionControls skill={s} card />
            </div>
          </article>
        ))}
      </section>
      {!skills.length && (
        <section className="panel">
          <h3>No skills yet</h3>
          <p className="muted">
            Use New skill to create your first local skill.
          </p>
        </section>
      )}
    </div>
  );
}

const defaultCode = `---
name: Support Triage
version: 2.4.1
model: claude-3-7-sonnet
temperature: 0.2
tools: [customer_lookup, ticket_router]
---

# Role
You are a support operations specialist. Analyze each request,
identify urgency and category, then route it to the right team.

## Rules
1. Treat account lockouts and outages as **urgent**.
2. Never expose internal customer metadata.
3. Return a concise rationale with your routing decision.

## Output
Return JSON matching the schema in \`schema.json\`.`;

export function Editor({ skillId }: { skillId?: string } = {}) {
  const { id: routeId } = useParams();
  const id = skillId ?? routeId;
  const navigate = useNavigate();
  const {
    skills,
    theme,
    removeSkill,
    editorMode,
    setEditorMode,
    updateSkill,
    provider,
    providers,
    activeProviderId,
    assistantWidth,
    setAssistantWidth,
    assistantConversations,
    assistantThreads,
    assistantThreadOrder,
    activeAssistantThreads,
    assistantPending,
    assistantErrors,
    setAssistantMessages,
    createAssistantThread,
    setActiveAssistantThread,
    setAssistantThreadMessages,
    appendAssistantThreadMessage,
    deleteAssistantThread,
    setAssistantPending,
    setAssistantError,
    editorSessions,
    setEditorSession,
    assistantDrafts,
    setAssistantDraft,
  } = useStudio();
  const skill = skills.find((s) => s.id === id);
  const initialSession = id ? editorSessions[id] : undefined;
  const [file, setFile] = useState(initialSession?.file ?? "SKILL.md");
  const [content, setContent] = useState(
    initialSession?.content ?? skill?.content ?? "",
  );
  const [saved, setSaved] = useState(initialSession?.saved ?? true);
  const [autoSave, setAutoSave] = useState(true);
  const [autoSaving, setAutoSaving] = useState(false);
  const [files, setFiles] = useState<WorkspaceEntry[]>([]);
  const [assistantProviderId, setAssistantProviderId] =
    useState(activeProviderId);
  const [assistantInput, setAssistantInput] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [python, setPython] = useState<PythonStatus | null>(null);
  const [pythonRunning, setPythonRunning] = useState(false);
  const [pythonResult, setPythonResult] = useState<PythonRunResult | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [entryDialog, setEntryDialog] = useState<{
    mode: "file" | "folder" | "rename" | "delete";
    path?: string;
    value: string;
  } | null>(null);
  const [skillDialog, setSkillDialog] = useState<"remove" | "delete" | null>(
    null,
  );
  const [skillRemoving, setSkillRemoving] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry?: WorkspaceEntry;
  } | null>(null);
  const providerThreadIds = assistantThreadOrder[assistantProviderId] ?? [];
  const activeThreadId =
    activeAssistantThreads[assistantProviderId] || providerThreadIds[0] || "";
  const activeThread = assistantThreads[activeThreadId];
  const conversationKey = activeThreadId || `new:${assistantProviderId}`;
  const assistantMessages = activeThread?.messages ?? [];
  const assistantError = assistantErrors[conversationKey] ?? "";
  const assistantBusy = assistantPending[conversationKey] ?? false;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.IStandaloneCodeEditor | null>(null);
  const latestContentRef = useRef(content);
  const importedLegacyChats = useRef(false);
  latestContentRef.current = content;
  const refreshWorkspace = useCallback(async () => {
    if (!skill?.workspacePath) {
      setFiles([]);
      return;
    }
    try {
      setFiles(await listWorkspace(skill.workspacePath));
      setWorkspaceError("");
    } catch (error) {
      setFiles([]);
      setWorkspaceError(
        `Skill directory is missing or inaccessible: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [skill?.workspacePath]);
  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);
  useEffect(() => {
    if (isTauri()) void getPythonStatus().then(setPython);
  }, []);
  useEffect(() => {
    if (skill) setEditorSession(skill.id, { file, content, saved });
  }, [skill?.id, file, content, saved]);
  useEffect(() => {
    if (
      !activeThreadId &&
      assistantProviderId &&
      !Object.values(assistantConversations).some((messages) => messages.length)
    )
      createAssistantThread(assistantProviderId);
  }, [activeThreadId, assistantProviderId, createAssistantThread]);
  useEffect(() => {
    if (importedLegacyChats.current || Object.keys(assistantThreads).length)
      return;
    importedLegacyChats.current = true;
    Object.entries(assistantConversations)
      .filter(([, messages]) => messages.length)
      .forEach(([legacyKey, messages]) => {
        const threadId = createAssistantThread(assistantProviderId);
        setAssistantThreadMessages(threadId, messages);
        setAssistantMessages(legacyKey, []);
      });
  }, []);
  useEffect(() => {
    setAssistantInput(
      activeThreadId ? (assistantDrafts[activeThreadId] ?? "") : "",
    );
  }, [activeThreadId]);
  useEffect(() => {
    if (activeThreadId) setAssistantDraft(activeThreadId, assistantInput);
  }, [activeThreadId, assistantInput]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [assistantMessages.length, assistantBusy]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setMoveMenuOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);
  useEffect(() => {
    if (!autoSave || saved || !skill?.workspacePath || workspaceError) return;
    const snapshot = content;
    const path = file;
    const timer = window.setTimeout(async () => {
      setAutoSaving(true);
      try {
        await writeWorkspaceFile(skill.workspacePath!, path, snapshot);
        if (path === "SKILL.md")
          updateSkill(skill.id, {
            content: snapshot,
            updated: new Date().toISOString(),
          });
        if (latestContentRef.current === snapshot) setSaved(true);
      } catch (error) {
        setWorkspaceError(
          `Could not auto-save ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setAutoSaving(false);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    autoSave,
    content,
    file,
    saved,
    skill?.id,
    skill?.workspacePath,
    updateSkill,
    workspaceError,
  ]);
  const treeEntries = useMemo(() => {
    const children = new Map<string, WorkspaceEntry[]>();
    for (const entry of files) {
      const parent = entry.path.split("/").slice(0, -1).join("/");
      children.set(parent, [...(children.get(parent) ?? []), entry]);
    }
    const ordered: WorkspaceEntry[] = [];
    const visit = (parent: string) => {
      const siblings = (children.get(parent) ?? []).sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
      );
      for (const entry of siblings) {
        ordered.push(entry);
        if (entry.isDir && !collapsed.has(entry.path)) visit(entry.path);
      }
    };
    visit("");
    return ordered;
  }, [files, collapsed]);
  if (!skill)
    return (
      <div className="page">
        <Header
          title="Skill not found"
          description="Create a skill before opening the editor."
          actions={
            <Link className="button" to="/skills">
              Back to skills
            </Link>
          }
        />
      </div>
    );
  const openFile = async (path: string) => {
    if (skill.workspacePath) {
      try {
        setContent(await readWorkspaceFile(skill.workspacePath, path));
        setWorkspaceError("");
      } catch (error) {
        setWorkspaceError(
          `Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    } else if (path !== "SKILL.md") return;
    setFile(path);
    const markdown = /\.(md|mdx)$/i.test(path);
    const form = /(?:SKILL\.md|\.toml)$/i.test(path);
    if (
      (editorMode === "form" && !form) ||
      (editorMode === "blocks" && !markdown) ||
      (editorMode === "preview" && !markdown)
    )
      setEditorMode("code");
    setSaved(true);
  };
  const save = async () => {
    try {
      if (skill.workspacePath)
        await writeWorkspaceFile(skill.workspacePath, file, content);
      if (file === "SKILL.md")
        updateSkill(skill.id, { content, updated: new Date().toISOString() });
      setSaved(true);
      setWorkspaceError("");
    } catch (error) {
      setWorkspaceError(
        `Could not save ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const runPython = async () => {
    if (!skill.workspacePath || !file.toLowerCase().endsWith(".py")) return;
    setPythonRunning(true);
    setPythonResult(null);
    try {
      await writeWorkspaceFile(skill.workspacePath, file, content);
      setSaved(true);
      setPythonResult(await runPythonFile(skill.workspacePath, file));
    } catch (error) {
      setWorkspaceError(
        `Python execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPythonRunning(false);
    }
  };
  const moveEntry = async (from: string, destination: string) => {
    if (
      !skill.workspacePath ||
      !from ||
      from === destination ||
      destination.startsWith(`${from}/`)
    )
      return;
    try {
      await moveWorkspaceEntry(skill.workspacePath, from, destination);
      if (file === from || file.startsWith(`${from}/`))
        setFile(`${destination}${file.slice(from.length)}`);
      await refreshWorkspace();
    } catch (error) {
      setWorkspaceError(
        `Could not move entry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const applyEntryDialog = async () => {
    if (!entryDialog || !skill.workspacePath) return;
    try {
      if (entryDialog.mode === "file" || entryDialog.mode === "folder")
        await createWorkspaceEntry(
          skill.workspacePath,
          entryDialog.value.trim(),
          entryDialog.mode === "folder",
        );
      if (entryDialog.mode === "rename" && entryDialog.path) {
        const parent = entryDialog.path.split("/").slice(0, -1).join("/");
        await moveEntry(
          entryDialog.path,
          [parent, entryDialog.value.trim()].filter(Boolean).join("/"),
        );
      }
      if (entryDialog.mode === "delete" && entryDialog.path) {
        await deleteWorkspaceEntry(skill.workspacePath, entryDialog.path);
        if (
          file === entryDialog.path ||
          file.startsWith(`${entryDialog.path}/`)
        )
          await openFile("SKILL.md");
      }
      setEntryDialog(null);
      await refreshWorkspace();
    } catch (error) {
      setWorkspaceError(
        `Workspace operation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const insertAssistantText = (
    value: string,
    mode: "cursor" | "replace" | "append",
  ) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    const start =
      mode === "append"
        ? content.length
        : model && selection
          ? model.getOffsetAt(selection.getStartPosition())
          : content.length;
    const end =
      mode === "replace" && model && selection
        ? model.getOffsetAt(selection.getEndPosition())
        : start;
    const prefix =
      mode === "append" && content && !content.endsWith("\n\n")
        ? content.endsWith("\n")
          ? "\n"
          : "\n\n"
        : "";
    const next = `${content.slice(0, start)}${prefix}${value}${content.slice(end)}`;
    const caret = start + prefix.length + value.length;
    setContent(next);
    setSaved(false);
    requestAnimationFrame(() => {
      const current = editorRef.current;
      const currentModel = current?.getModel();
      if (current && currentModel) {
        current.setPosition(currentModel.getPositionAt(caret));
        current.focus();
      }
    });
  };
  const askAssistant = async () => {
    const prompt = assistantInput.trim();
    if (!prompt || assistantBusy || !activeThreadId) return;
    const key = conversationKey;
    const currentFile = file;
    const currentContent = content;
    const userMessage: ChatMessage = { role: "user", content: prompt };
    const history = [...assistantMessages, userMessage];
    setAssistantThreadMessages(key, history);
    setAssistantInput("");
    setAssistantError(key, "");
    setAssistantPending(key, true);
    try {
      const profile = providers.find((item) => item.id === assistantProviderId);
      const result = await aiProvider.chat({
        provider: profile ?? provider,
        apiKey: profile?.apiKey,
        messages: [
          {
            role: "system",
            content: `${profile?.assistantInstructions || "Help write clear and safe agent skills. Return concrete markdown suggestions."}\n\nCurrent file (${currentFile}):\n${currentContent}`,
          },
          ...history,
        ],
      });
      appendAssistantThreadMessage(key, {
        role: "assistant",
        content: result.content,
      });
    } catch (error) {
      setAssistantError(
        key,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setAssistantPending(key, false);
    }
  };
  const blocks = content.split(/(?=^##\s)/m).filter(Boolean);
  const supportsForm = /(?:SKILL\.md|\.toml)$/i.test(file);
  const supportsBlocks = /\.(?:md|mdx)$/i.test(file);
  const tomlRows = content
    .split("\n")
    .map((line, index) => ({
      index,
      match: line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/),
    }))
    .filter((row) => row.match);
  const moveSource = contextMenu?.entry;
  const moveSourceParent =
    moveSource?.path.split("/").slice(0, -1).join("/") ?? "";
  const moveSourceName = moveSource?.path.split("/").pop() ?? "";
  const moveFolders = moveSource
    ? files
        .filter(
          (entry) =>
            entry.isDir &&
            entry.path !== moveSource.path &&
            entry.path !== moveSourceParent &&
            !entry.path.startsWith(`${moveSource.path}/`),
        )
        .sort((a, b) => a.path.localeCompare(b.path))
    : [];
  return (
    <div className="editor-page">
      <div className="editor-titlebar">
        <div>
          <Link className="editor-back" to="/skills" title="Back to skills">
            <ArrowLeft size={16} />
            <span>Back to skills</span>
          </Link>
          <span className="skill-icon mini">{skill.icon}</span>
          <b>{skill.name}</b>
          <span className="muted">/</span>
          <span>{file}</span>
        </div>
        <div>
          {file.toLowerCase().endsWith(".py") && (
            <button
              className="button python-run"
              disabled={!python?.available || pythonRunning}
              title={
                python?.available
                  ? (python.version ?? "Python 3")
                  : "Python 3 is not available on PATH"
              }
              onClick={() => void runPython()}
            >
              {pythonRunning ? (
                <RefreshCw className="spin" size={14} />
              ) : (
                <Play size={14} />
              )}{" "}
              {pythonRunning ? "Running..." : "Run Python"}
            </button>
          )}
          <span className="saved">
            <Check size={13} />
            {autoSaving ? "Saving..." : saved ? "Saved" : "Unsaved"}
          </span>
          <label className="auto-save-toggle">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(event) => setAutoSave(event.target.checked)}
            />
            Auto-save
          </label>
          <div className="segmented">
            <button
              className={editorMode === "code" ? "active" : ""}
              onClick={() => setEditorMode("code")}
            >
              <Code2 size={14} />
              Code
            </button>
            <button
              className={editorMode === "form" ? "active" : ""}
              disabled={!supportsForm}
              onClick={() => setEditorMode("form")}
            >
              <Settings2 size={14} />
              Form
            </button>
            <button
              className={editorMode === "blocks" ? "active" : ""}
              disabled={!supportsBlocks}
              onClick={() => setEditorMode("blocks")}
            >
              <Box size={14} />
              Blocks
            </button>
            <button
              className={editorMode === "preview" ? "active" : ""}
              disabled={!supportsBlocks}
              onClick={() => setEditorMode("preview")}
            >
              <Eye size={14} />
              Preview
            </button>
          </div>
          <button
            className="button"
            disabled={saved || Boolean(workspaceError)}
            onClick={() => void save()}
          >
            <Save size={14} />
            Save
          </button>
          <button
            className="button danger"
            onClick={() => setSkillDialog("remove")}
          >
            <Trash2 size={14} />
            Remove
          </button>
          <Link className="button primary" to="/playground">
            <Play size={15} />
            Test
          </Link>
        </div>
      </div>
      <div
        className="editor-layout"
        style={{
          gridTemplateColumns: `175px minmax(0, 1fr) ${assistantWidth}px`,
        }}
      >
        <aside className="file-tree">
          <div
            className="tree-head"
            onContextMenu={(event) => {
              event.preventDefault();
              setMoveMenuOpen(false);
              setContextMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            <span>FILES</span>
            <span className="tree-actions">
              <button
                title="New file"
                disabled={Boolean(workspaceError)}
                onClick={() => setEntryDialog({ mode: "file", value: "" })}
              >
                <File size={13} />
              </button>
              <button
                title="New folder"
                disabled={Boolean(workspaceError)}
                onClick={() => setEntryDialog({ mode: "folder", value: "" })}
              >
                <FolderKanban size={13} />
              </button>
            </span>
          </div>
          {!workspaceError && (
            <div className="tree-move-hint">
              <Info size={13} />
              <span>Right-click an item to move it</span>
            </div>
          )}
          {treeEntries.map((entry) => (
            <button
              className={`tree-entry ${file === entry.path ? "active" : ""}`}
              style={{ paddingLeft: 8 + entry.path.split("/").length * 12 }}
              onClick={() =>
                entry.isDir
                  ? setCollapsed((current) => {
                      const next = new Set(current);
                      next.has(entry.path)
                        ? next.delete(entry.path)
                        : next.add(entry.path);
                      return next;
                    })
                  : void openFile(entry.path)
              }
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMoveMenuOpen(false);
                setContextMenu({ x: event.clientX, y: event.clientY, entry });
              }}
              key={entry.path}
            >
              {entry.isDir ? (
                <FolderKanban size={15} />
              ) : (
                <FileText size={15} />
              )}
              {entry.name}
            </button>
          ))}
          {!workspaceError && !treeEntries.length && (
            <p className="tree-empty">No files found</p>
          )}
        </aside>
        <section className="code-area">
          {workspaceError && (
            <div className="workspace-error dismissible-inline">
              <span>{workspaceError}</span>
              <button
                className="icon-btn"
                aria-label="Dismiss workspace error"
                onClick={() => setWorkspaceError("")}
              >
                <XCircle size={14} />
              </button>
            </div>
          )}
          {editorMode === "code" ? (
            <div className="monaco-editor-shell">
              <MonacoEditor
                path={`${skill.id}/${file}`}
                language={editorLanguage(file)}
                theme={theme === "dark" ? "vs-dark" : "light"}
                value={content}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                onChange={(value) => {
                  setContent(value ?? "");
                  setSaved(false);
                }}
                options={{
                  automaticLayout: true,
                  fontFamily: "DM Mono, monospace",
                  fontSize: 12,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "off",
                  padding: { top: 14, bottom: 14 },
                }}
              />
            </div>
          ) : editorMode === "form" ? (
            <div className="form-editor">
              <span className="eyebrow">SKILL CONFIGURATION</span>
              <h2>Runtime & behavior</h2>
              <div className="form-grid">
                {file.endsWith(".toml") ? (
                  tomlRows.map(({ index, match }) => (
                    <label key={index}>
                      {match?.[1]}
                      <input
                        value={match?.[2] ?? ""}
                        onChange={(event) => {
                          const lines = content.split("\n");
                          lines[index] =
                            `${match?.[1]} = ${event.target.value}`;
                          setContent(lines.join("\n"));
                          setSaved(false);
                        }}
                      />
                    </label>
                  ))
                ) : (
                  <>
                    <label>
                      Name
                      <input value={skill.name} readOnly />
                    </label>
                    <label>
                      Version
                      <input value={skill.version} readOnly />
                    </label>
                    <label className="span2">
                      System instructions
                      <textarea
                        rows={8}
                        value={content}
                        onChange={(event) => {
                          setContent(event.target.value);
                          setSaved(false);
                        }}
                      />
                    </label>
                    <label>
                      Model
                      <input value="Configured in Settings" disabled />
                    </label>
                    <label>
                      Temperature
                      <input value="Provider default" disabled />
                    </label>
                  </>
                )}
              </div>
              <button className="button primary" onClick={() => void save()}>
                <Save size={15} />
                Save changes
              </button>
            </div>
          ) : editorMode === "preview" ? (
            <article className="markdown-preview">
              <ReactMarkdown
                components={{
                  a: ({ children, href }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="block-editor">
              <span className="eyebrow">MARKDOWN BLOCKS</span>
              <h2>Visual structure</h2>
              {blocks.map((block, index) => {
                const [heading, ...body] = block.split("\n");
                return (
                  <article className="editor-block" draggable key={index}>
                    <div>
                      <GripVertical size={15} />
                      <b>
                        {heading.replace(/^#+\s*/, "") ||
                          "Frontmatter & introduction"}
                      </b>
                    </div>
                    <textarea
                      value={body.join("\n").trim()}
                      onChange={(event) => {
                        const next = [...blocks];
                        next[index] = `${heading}\n${event.target.value}`;
                        setContent(next.join("\n\n"));
                        setSaved(false);
                      }}
                    />
                  </article>
                );
              })}
              <button
                className="button"
                onClick={() => {
                  setContent(
                    `${content.trim()}\n\n## New section\n\nAdd instructions here.\n`,
                  );
                  setSaved(false);
                }}
              >
                <Plus size={14} />
                Add block
              </button>
            </div>
          )}
        </section>
        <aside className="inspector assistant-panel">
          <div
            className="assistant-resize-handle"
            title="Drag to resize"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const move = (next: PointerEvent) =>
                setAssistantWidth(window.innerWidth - next.clientX);
              const stop = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", stop);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", stop);
            }}
          />
          <div className="assistant-head">
            <span className="eyebrow">AI WRITING ASSISTANT</span>
            <div className="assistant-controls">
              <select
                className="assistant-provider-select"
                title={
                  providers.find((item) => item.id === assistantProviderId)
                    ?.name
                }
                value={assistantProviderId}
                onChange={(event) => setAssistantProviderId(event.target.value)}
                disabled={assistantBusy}
                aria-label="Assistant provider"
              >
                {providers.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className="assistant-thread-select"
                value={activeThreadId}
                onChange={(event) =>
                  setActiveAssistantThread(
                    assistantProviderId,
                    event.target.value,
                  )
                }
                disabled={assistantBusy}
                aria-label="Conversation history"
              >
                {providerThreadIds.map((threadId) => (
                  <option value={threadId} key={threadId}>
                    {assistantThreads[threadId]?.title ?? "Conversation"}
                  </option>
                ))}
              </select>
              <button
                className="icon-btn"
                title="New conversation"
                aria-label="New assistant conversation"
                disabled={assistantBusy}
                onClick={() => createAssistantThread(assistantProviderId)}
              >
                <Plus size={14} />
              </button>
              <button
                className="icon-btn"
                title="Delete conversation"
                aria-label="Delete assistant conversation"
                disabled={!activeThreadId || assistantBusy}
                onClick={() =>
                  deleteAssistantThread(assistantProviderId, activeThreadId)
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="assistant-chat">
            {assistantMessages.length === 0 && (
              <div className="assistant-empty">
                <Sparkles size={20} />
                <p>
                  Ask for a rewrite, validation, examples, or a new section.
                </p>
              </div>
            )}
            {assistantMessages.map((message, index) => (
              <div
                className={`chat-bubble ${message.role}`}
                key={`${message.role}-${index}`}
              >
                <span>{message.role === "user" ? "You" : "Assistant"}</span>
                {message.role === "assistant" ? (
                  <div className="assistant-markdown">
                    <ReactMarkdown
                      components={{
                        code({ children, className }) {
                          const value = String(children).replace(/\n$/, "");
                          const block =
                            Boolean(className) || value.includes("\n");
                          return block ? (
                            <div className="assistant-code">
                              <code className={className}>{value}</code>
                              <div>
                                <button
                                  className="text-btn"
                                  onClick={() =>
                                    insertAssistantText(value, "cursor")
                                  }
                                >
                                  Insert at cursor
                                </button>
                                <button
                                  className="text-btn"
                                  onClick={() =>
                                    insertAssistantText(value, "replace")
                                  }
                                >
                                  Replace selection
                                </button>
                              </div>
                            </div>
                          ) : (
                            <code>{children}</code>
                          );
                        },
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p>{message.content}</p>
                )}
                {message.role === "assistant" && (
                  <button
                    className="text-btn"
                    onClick={() =>
                      insertAssistantText(message.content, "append")
                    }
                  >
                    Append markdown
                  </button>
                )}
              </div>
            ))}
            {assistantBusy && (
              <div className="chat-bubble assistant typing">
                <RefreshCw className="spin" size={14} />
                <span>Generating response</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {assistantError && (
            <ProviderErrorMessage
              error={assistantError}
              provider={
                providers.find((item) => item.id === assistantProviderId)
                  ?.kind ?? provider.kind
              }
              onDismiss={() => setAssistantError(conversationKey, "")}
            />
          )}
          <div className="assistant-composer">
            <textarea
              rows={3}
              value={assistantInput}
              onChange={(e) => setAssistantInput(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void askAssistant();
                }
              }}
              placeholder="Message the writing assistant..."
            />
            <button
              className="button primary"
              aria-label="Send message"
              disabled={assistantBusy || !assistantInput.trim()}
              onClick={() => void askAssistant()}
            >
              <Send size={15} />
            </button>
          </div>
        </aside>
      </div>
      {pythonResult && (
        <Modal
          title={`Python result · ${file}`}
          onClose={() => setPythonResult(null)}
          wide
        >
          <div className="python-result-summary">
            <Status
              value={
                pythonResult.timedOut || pythonResult.exitCode !== 0
                  ? "Failed"
                  : "Passed"
              }
            />
            <span>Exit code: {pythonResult.exitCode ?? "terminated"}</span>
            <span>{pythonResult.durationMs}ms</span>
            {pythonResult.truncated && <span>Output truncated</span>}
          </div>
          <div className="python-warning">
            <ShieldCheck size={16} />
            <p>
              This runs local Python code with your user permissions. It is
              time-limited, but it is not a security sandbox.
            </p>
          </div>
          <div className="python-output-grid">
            <section>
              <span>STDOUT</span>
              <pre>{pythonResult.stdout || "No output"}</pre>
            </section>
            <section>
              <span>STDERR</span>
              <pre>
                {pythonResult.timedOut ? "Execution timed out.\n" : ""}
                {pythonResult.stderr || "No errors"}
              </pre>
            </section>
          </div>
          <div className="modal-actions">
            <button
              className="button primary"
              onClick={() => setPythonResult(null)}
            >
              Close
            </button>
          </div>
        </Modal>
      )}
      {contextMenu && (
        <div
          className="workspace-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.entry?.isDir && (
            <>
              <button
                onClick={() => {
                  setEntryDialog({
                    mode: "file",
                    value: `${contextMenu.entry?.path}/`,
                  });
                  setContextMenu(null);
                }}
              >
                New file inside
              </button>
              <button
                onClick={() => {
                  setEntryDialog({
                    mode: "folder",
                    value: `${contextMenu.entry?.path}/`,
                  });
                  setContextMenu(null);
                }}
              >
                New folder inside
              </button>
            </>
          )}
          {contextMenu.entry && (
            <>
              <div className="context-submenu-wrap">
                <button
                  className="context-submenu-trigger"
                  onClick={() => setMoveMenuOpen((open) => !open)}
                >
                  <span>Move</span>
                  <ChevronRight size={14} />
                </button>
                {moveMenuOpen && (
                  <div className="workspace-move-submenu">
                    <span className="context-menu-label">
                      MOVE {contextMenu.entry.name.toUpperCase()}
                    </span>
                    {moveSourceParent && (
                      <button
                        onClick={() => {
                          void moveEntry(
                            contextMenu.entry!.path,
                            moveSourceName,
                          );
                          setContextMenu(null);
                          setMoveMenuOpen(false);
                        }}
                      >
                        <FolderKanban size={14} />
                        <span>
                          <b>Workspace root</b>
                          <small>/</small>
                        </span>
                      </button>
                    )}
                    {moveSourceParent.includes("/") && (
                      <button
                        onClick={() => {
                          const parent = moveSourceParent
                            .split("/")
                            .slice(0, -1)
                            .join("/");
                          void moveEntry(
                            contextMenu.entry!.path,
                            [parent, moveSourceName].filter(Boolean).join("/"),
                          );
                          setContextMenu(null);
                          setMoveMenuOpen(false);
                        }}
                      >
                        <ArrowLeft size={14} />
                        <span>
                          <b>Move up one level</b>
                          <small>
                            {moveSourceParent
                              .split("/")
                              .slice(0, -1)
                              .join("/") || "/"}
                          </small>
                        </span>
                      </button>
                    )}
                    {moveFolders.length > 0 && (
                      <span className="context-menu-label">MOVE TO FOLDER</span>
                    )}
                    {moveFolders.map((folder) => (
                      <button
                        style={{
                          paddingLeft: 10 + folder.path.split("/").length * 10,
                        }}
                        key={folder.path}
                        onClick={() => {
                          void moveEntry(
                            contextMenu.entry!.path,
                            `${folder.path}/${moveSourceName}`,
                          );
                          setContextMenu(null);
                          setMoveMenuOpen(false);
                        }}
                      >
                        <FolderKanban size={14} />
                        <span>
                          <b>{folder.name}</b>
                          <small>{folder.path}</small>
                        </span>
                      </button>
                    ))}
                    {!moveSourceParent && moveFolders.length === 0 && (
                      <p>No available move targets</p>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setEntryDialog({
                    mode: "rename",
                    path: contextMenu.entry?.path,
                    value: contextMenu.entry?.name ?? "",
                  });
                  setContextMenu(null);
                }}
              >
                Rename
              </button>
              <button
                className="danger"
                disabled={contextMenu.entry.path === "SKILL.md"}
                onClick={() => {
                  setEntryDialog({
                    mode: "delete",
                    path: contextMenu.entry?.path,
                    value: "",
                  });
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
            </>
          )}
          {!contextMenu.entry && (
            <>
              <button
                onClick={() => {
                  setEntryDialog({ mode: "file", value: "" });
                  setContextMenu(null);
                }}
              >
                New file
              </button>
              <button
                onClick={() => {
                  setEntryDialog({ mode: "folder", value: "" });
                  setContextMenu(null);
                }}
              >
                New folder
              </button>
            </>
          )}
        </div>
      )}
      {entryDialog && (
        <Modal
          title={
            entryDialog.mode === "delete"
              ? "Delete workspace entry"
              : entryDialog.mode === "rename"
                ? "Rename workspace entry"
                : `Create ${entryDialog.mode}`
          }
          onClose={() => setEntryDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void applyEntryDialog();
            }}
          >
            {entryDialog.mode === "delete" ? (
              <p>
                Delete <code>{entryDialog.path}</code> from disk? This cannot be
                undone.
              </p>
            ) : (
              <label>
                {entryDialog.mode === "rename" ? "New name" : "Relative path"}
                <input
                  autoFocus
                  value={entryDialog.value}
                  onChange={(event) =>
                    setEntryDialog({
                      ...entryDialog,
                      value: event.target.value,
                    })
                  }
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setEntryDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`button ${entryDialog.mode === "delete" ? "danger" : "primary"}`}
                disabled={
                  entryDialog.mode !== "delete" && !entryDialog.value.trim()
                }
              >
                {entryDialog.mode === "delete" ? "Delete" : "Apply"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {skillDialog && (
        <Modal
          title={
            skillDialog === "delete"
              ? "Delete skill files"
              : "Remove skill from Studio"
          }
          onClose={() => !skillRemoving && setSkillDialog(null)}
        >
          <p>
            {skillDialog === "delete"
              ? `Delete ${skill.name}'s workspace and remove it from Skill Studio? This cannot be undone.`
              : `Remove ${skill.name} from Skill Studio? Files will remain on disk.`}
          </p>
          {skillRemoving && (
            <div className="operation-bar modal-operation" role="status">
              <RefreshCw className="spin" size={15} />
              <span>
                {skillDialog === "delete"
                  ? `Deleting ${skill.name} files...`
                  : `Removing ${skill.name} from Studio...`}
              </span>
              <i>
                <b />
              </i>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={skillRemoving}
              onClick={() => setSkillDialog(null)}
            >
              Cancel
            </button>
            {skillDialog === "remove" && skill.workspacePath && (
              <button
                className="button danger"
                disabled={skillRemoving}
                onClick={() => setSkillDialog("delete")}
              >
                Delete files instead
              </button>
            )}
            <button
              className="button danger"
              disabled={skillRemoving}
              onClick={async () => {
                setSkillRemoving(true);
                try {
                  if (skillDialog === "delete" && skill.workspacePath)
                    await deleteSkillWorkspace(skill.workspacePath);
                  removeSkill(skill.id);
                  navigate("/skills");
                } catch (error) {
                  setWorkspaceError(
                    `Could not delete skill workspace: ${error instanceof Error ? error.message : String(error)}`,
                  );
                  setSkillDialog(null);
                } finally {
                  setSkillRemoving(false);
                }
              }}
            >
              {skillDialog === "delete" ? "Delete files" : "Remove from Studio"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const initialNodes: Node[] = [
  {
    id: "1",
    type: "studio",
    position: { x: 20, y: 170 },
    data: { kind: "trigger", label: "New ticket", meta: "Webhook event" },
  },
  {
    id: "2",
    type: "studio",
    position: { x: 260, y: 170 },
    data: {
      kind: "agent",
      label: "Analyze request",
      meta: "Claude 3.7 Sonnet",
    },
  },
  {
    id: "3",
    type: "studio",
    position: { x: 520, y: 170 },
    data: { kind: "condition", label: "Priority?", meta: "Branch on urgency" },
  },
  {
    id: "4",
    type: "studio",
    position: { x: 790, y: 60 },
    data: { kind: "action", label: "Escalate", meta: "PagerDuty" },
  },
  {
    id: "5",
    type: "studio",
    position: { x: 790, y: 270 },
    data: { kind: "action", label: "Route ticket", meta: "Zendesk" },
  },
];
const initialEdges: Edge[] = [
  { id: "e1", source: "1", target: "2" },
  { id: "e2", source: "2", target: "3" },
  { id: "e3", source: "3", target: "4", label: "urgent" },
  { id: "e4", source: "3", target: "5", label: "normal" },
];
function StudioNode({ data }: NodeProps) {
  const d = data as { kind: string; label: string; meta: string };
  return (
    <div className={`flow-node ${d.kind}`}>
      <Handle type="target" position={Position.Left} />
      <span className="node-kind">{d.kind}</span>
      <b>{d.label}</b>
      <small>{d.meta}</small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
export function Workflow() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const onConnect = useCallback(
    (c: Connection) => setEdges((e) => addEdge(c, e)),
    [],
  );
  return (
    <div className="workflow-page">
      <div className="editor-titlebar">
        <div>
          <Link to="/">
            <ArrowLeft size={16} />
          </Link>
          <b>Support Triage</b>
          <span className="muted">/ Workflow</span>
        </div>
        <div>
          <button className="button">
            <RotateCcw size={14} />
            Undo
          </button>
          <button className="button primary">
            <Save size={14} />
            Save workflow
          </button>
        </div>
      </div>
      <div className="workflow-body">
        <aside className="node-palette">
          <span className="eyebrow">NODES</span>
          {[
            ["Trigger", "Starts a workflow"],
            ["AI agent", "Runs a skill prompt"],
            ["Condition", "Branches by value"],
            ["Action", "Calls an integration"],
          ].map(([a, b]) => (
            <button key={a}>
              <GripVertical size={14} />
              <div>
                <b>{a}</b>
                <small>{b}</small>
              </div>
              <Plus size={14} />
            </button>
          ))}
        </aside>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) =>
            setNodes((nds) =>
              changes.reduce(
                (all, c) =>
                  c.type === "position"
                    ? all.map((n) =>
                        n.id === c.id
                          ? { ...n, position: c.position ?? n.position }
                          : n,
                      )
                    : all,
                nds,
              ),
            )
          }
          onEdgesChange={() => {}}
          onConnect={onConnect}
          nodeTypes={{ studio: StudioNode }}
          fitView
        >
          <Background gap={22} size={1} />
          <MiniMap />
          <Controls />
        </ReactFlow>
        <aside className="workflow-inspector">
          <span className="eyebrow">NODE SETTINGS</span>
          <h3>Analyze request</h3>
          <label>
            Skill
            <select>
              <option>Support Triage</option>
            </select>
          </label>
          <label>
            Input
            <textarea defaultValue={"{{ trigger.body.message }}"} />
          </label>
          <label>
            Timeout
            <input defaultValue="30 seconds" />
          </label>
          <button className="button danger">
            <Trash2 size={14} />
            Remove node
          </button>
        </aside>
      </div>
    </div>
  );
}

export function Playground() {
  const { provider, providers, activeProviderId, addRun, skills } = useStudio();
  const [providerId, setProviderId] = useState(activeProviderId);
  const activeProfile = providers.find((item) => item.id === providerId);
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(0);
  const run = async () => {
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) {
      setError("Select a skill first.");
      return;
    }
    setRunning(true);
    setError("");
    setOutput("");
    const started = Date.now();
    try {
      const result = await aiProvider.chat({
        provider: activeProfile ?? provider,
        apiKey: activeProfile?.apiKey,
        messages: [
          {
            role: "system",
            content: skill.content || skill.description,
          },
          { role: "user", content: input },
        ],
      });
      setOutput(result.content);
      setDuration(result.durationMs);
      addRun({
        id: crypto.randomUUID(),
        skillId: skill.id,
        provider: (activeProfile ?? provider).kind,
        model: result.model,
        input,
        output: result.content,
        status: "passed",
        durationMs: result.durationMs,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setDuration(Date.now() - started);
      addRun({
        id: crypto.randomUUID(),
        skillId: skill.id,
        provider: (activeProfile ?? provider).kind,
        model: (activeProfile ?? provider).model,
        input,
        output: "",
        status: "failed",
        durationMs: Date.now() - started,
        error: message,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="page playground">
      <Header
        eyebrow="LOCAL EXECUTION"
        title="Playground"
        description="Real provider execution with persisted local history."
        actions={
          <span className="status active">
            <i />
            {`${activeProfile?.name ?? provider.kind} / ${activeProfile?.model ?? provider.model}`}
          </span>
        }
      />
      <div className="play-grid">
        <section className="panel prompt-panel">
          <div className="panel-title">
            <h3>Input</h3>
          </div>
          <label>
            Skill
            <select
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
            >
              <option value="">Select a skill</option>
              {skills.map((skill) => (
                <option value={skill.id} key={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model connection
            <select
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {providers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.model}
                </option>
              ))}
            </select>
          </label>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} />
          <button
            className="button primary run-button"
            onClick={run}
            disabled={running || !input.trim() || !skillId}
          >
            {running ? (
              <>
                <RefreshCw className="spin" size={16} />
                Running...
              </>
            ) : (
              <>
                <Play size={16} />
                Run skill
              </>
            )}
          </button>
        </section>
        <section className="panel output-panel">
          <div className="panel-title">
            <h3>Output</h3>
            {output && <Status value="Passed" />}
            {error && <Status value="Failed" />}
          </div>
          {running ? (
            <div className="empty-output" role="status">
              <RefreshCw className="spin" size={28} />
              <span>Waiting for provider</span>
            </div>
          ) : (
            <div className="output-json">
              <span>{error ? "ERROR" : "MODEL OUTPUT"}</span>
              {error ? (
                <ProviderErrorMessage
                  error={error}
                  provider={(activeProfile ?? provider).kind}
                  onDismiss={() => setError("")}
                />
              ) : (
                <pre>{output || "Run the skill to see its real response."}</pre>
              )}
            </div>
          )}
          <div className="metrics-row">
            <div>
              <span>Duration</span>
              <b>{duration}ms</b>
            </div>
            <div>
              <span>Provider</span>
              <b>{activeProfile?.name ?? provider.kind}</b>
            </div>
            <div>
              <span>History</span>
              <b>Saved locally</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function DiffView() {
  return (
    <div className="page">
      <Header
        eyebrow="PLAYGROUND / COMPARE"
        title="Run comparison"
        description="Inspect output and configuration changes between two executions."
        actions={
          <Link className="button" to="/playground">
            <ArrowLeft size={15} />
            Back to run
          </Link>
        }
      />
      <div className="diff-select">
        <label>
          BASE RUN
          <select>
            <option>#1841 · v2.4.0 · 9:42 AM</option>
          </select>
        </label>
        <ArrowRight size={18} />
        <label>
          COMPARE RUN
          <select>
            <option>#1842 · v2.4.1 · 10:18 AM</option>
          </select>
        </label>
      </div>
      <div className="diff-summary">
        <Stat label="Score change" value="+8 pts" delta="88 → 96" />
        <Stat label="Latency" value="−320ms" delta="1.56s → 1.24s" />
        <Stat label="Token change" value="−42" delta="528 → 486" />
      </div>
      <section className="panel diff">
        <div className="diff-head">
          <span>run-1841/output.json</span>
          <span>run-1842/output.json</span>
        </div>
        <div className="diff-code old">
          <pre>{`  "category": "account_issue",
- "priority": "high",
- "route": "general_support",
  "confidence": 0.88`}</pre>
        </div>
        <div className="diff-code new">
          <pre>{`  "category": "account_access",
+ "priority": "urgent",
+ "route": "identity_support",
  "confidence": 0.96`}</pre>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Configuration changes</h3>
        </div>
        <div className="change-row">
          <code>temperature</code>
          <span>0.4</span>
          <ArrowRight size={14} />
          <span>0.2</span>
        </div>
        <div className="change-row">
          <code>prompt.version</code>
          <span>2.4.0</span>
          <ArrowRight size={14} />
          <span>2.4.1</span>
        </div>
      </section>
    </div>
  );
}

export function Tests() {
  const {
    tests,
    testAttempts,
    addTestAttempts,
    addTest,
    removeTest,
    setTests,
    skills,
    provider,
    providers,
    activeProviderId,
  } = useStudio();
  const activeTestProfile = providers.find(
    (item) => item.id === activeProviderId,
  );
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<(typeof tests)[number] | null>(null);
  const [creating, setCreating] = useState(false);
  const [repeatCount, setRepeatCount] = useState(3);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState({
    name: "",
    skillId: "",
    input: "",
    expected: "",
    suite: "Behavior",
    assertion: "contains" as TestAssertion,
    caseSensitive: false,
  });
  const assertionLabels: Record<TestAssertion, string> = {
    contains: "Contains text",
    "not-contains": "Does not contain text",
    equals: "Equals exactly",
    "not-equals": "Does not equal",
    "starts-with": "Starts with",
    "ends-with": "Ends with",
    regex: "Matches regular expression",
    "length-greater": "Character count is greater than",
    "length-less": "Character count is less than",
    "word-count-greater": "Word count is greater than",
    "word-count-less": "Word count is less than",
    "valid-json": "Is valid JSON",
  };
  const shown = tests.filter((t) => filter === "all" || t.status === filter);
  const lastRun = tests
    .map((test) => test.lastRunAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const createTest = () => {
    if (
      !draft.name.trim() ||
      !draft.skillId ||
      !draft.input.trim() ||
      (draft.assertion !== "valid-json" && !draft.expected.trim())
    )
      return;
    addTest({
      id: crypto.randomUUID(),
      ...draft,
      status: "queued",
      duration: "—",
      score: 0,
    });
    setCreating(false);
    setDraft({
      name: "",
      skillId: "",
      input: "",
      expected: "",
      suite: "Behavior",
      assertion: "contains",
      caseSensitive: false,
    });
  };
  const runRepeated = async (
    test: (typeof tests)[number],
    count: number,
    showResult = true,
  ) => {
    setRunningIds((current) => new Set(current).add(test.id));
    setTests(
      useStudio
        .getState()
        .tests.map((item) =>
          item.id === test.id ? { ...item, status: "running" } : item,
        ),
    );
    const attempts = [];
    let latest = test;
    try {
      for (let iteration = 0; iteration < count; iteration += 1) {
        [latest] = await executeTests(
          [latest],
          activeTestProfile ?? provider,
          skills,
          activeTestProfile?.apiKey,
        );
        attempts.push({
          id: crypto.randomUUID(),
          testId: test.id,
          status:
            latest.status === "passed"
              ? ("passed" as const)
              : ("failed" as const),
          score: latest.score,
          durationMs: Number.parseInt(latest.duration, 10) || 0,
          error: latest.error,
          createdAt: latest.lastRunAt ?? new Date().toISOString(),
        });
      }
      addTestAttempts(attempts);
      setTests(
        useStudio
          .getState()
          .tests.map((item) => (item.id === test.id ? latest : item)),
      );
      if (showResult) setSelected(latest);
    } finally {
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(test.id);
        return next;
      });
    }
  };
  const runAllTests = async () => {
    for (const test of tests) await runRepeated(test, 1, false);
  };
  const attemptsFor = (testId: string) =>
    testAttempts.filter((attempt) => attempt.testId === testId);
  const successRateFor = (testId: string) => {
    const attempts = attemptsFor(testId);
    return attempts.length
      ? Math.round(
          (attempts.filter((attempt) => attempt.status === "passed").length /
            attempts.length) *
            100,
        )
      : null;
  };
  return (
    <div className="page">
      <Header
        eyebrow="QUALITY / EVALUATIONS"
        title="Tests"
        description="Verify behavior across scenarios before you ship."
        actions={
          <>
            <button className="button" onClick={() => setCreating(true)}>
              <Plus size={15} />
              New test
            </button>
            <button
              className="button primary"
              disabled={!tests.length || runningIds.size > 0}
              onClick={() => void runAllTests()}
            >
              <Play size={15} />
              Run all
            </button>
          </>
        }
      />
      <div className="test-summary">
        <Stat
          label="Passing"
          value={`${tests.filter((t) => t.status === "passed").length} / ${tests.length}`}
          delta={
            lastRun
              ? `Last run ${new Date(lastRun).toLocaleString()}`
              : "Never run"
          }
        />
        <div className="pass-ring">
          {tests.length
            ? Math.round(
                (tests.filter((t) => t.status === "passed").length /
                  tests.length) *
                  100,
              )
            : 0}
          %<small>PASS RATE</small>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="tabs">
          {["all", "passed", "failed", "queued"].map((x) => (
            <button
              className={filter === x ? "active" : ""}
              onClick={() => setFilter(x)}
              key={x}
            >
              {x[0].toUpperCase() + x.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="data-table">
        <div className="table-row table-head">
          <span>TEST CASE</span>
          <span>SUITE</span>
          <span>STATUS</span>
          <span>DURATION</span>
          <span>SCORE</span>
          <span />
        </div>
        {shown.map((t) => (
          <button
            className="table-row"
            key={t.id}
            onClick={() => setSelected(t)}
          >
            <span>
              <FileText size={15} />
              <b>{t.name}</b>
            </span>
            <span>{t.suite}</span>
            <span>
              <Status value={t.status} />
            </span>
            <span>{t.duration}</span>
            <span>
              <b>{t.lastRunAt ? t.score : "—"}</b>
              {successRateFor(t.id) !== null && (
                <small>{successRateFor(t.id)}% success</small>
              )}
            </span>
            <span>
              <ChevronRight size={15} />
            </span>
          </button>
        ))}
      </div>
      {!tests.length && (
        <section className="empty-state">
          <TestTube2 size={28} />
          <h3>No tests configured</h3>
          <p>Create a test with real input and an expected output fragment.</p>
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Create test
          </button>
        </section>
      )}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)} wide>
          <div className="test-modal-grid">
            <div>
              <span className="eyebrow">INPUT</span>
              <pre className="code-card">{selected.input}</pre>
              <span className="eyebrow">ASSERTION</span>
              <pre className="code-card">
                {assertionLabels[selected.assertion ?? "contains"]}
                {selected.expected ? `: ${selected.expected}` : ""}
                {selected.caseSensitive ? " (case-sensitive)" : ""}
              </pre>
            </div>
            <div>
              <span className="eyebrow">RESULT</span>
              <div className="result-score">
                <Status value={selected.status} />
                <strong>{selected.score}/100</strong>
              </div>
              {attemptsFor(selected.id).length > 0 && (
                <p className="test-success-rate">
                  <b>{successRateFor(selected.id)}% success rate</b>
                  <span>
                    {
                      attemptsFor(selected.id).filter(
                        (attempt) => attempt.status === "passed",
                      ).length
                    }{" "}
                    passed / {attemptsFor(selected.id).length} attempts
                  </span>
                </p>
              )}
              {selected.error && (
                <ProviderErrorMessage
                  error={selected.error}
                  provider={(activeTestProfile ?? provider).kind}
                />
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button
              className="button danger"
              onClick={() => {
                removeTest(selected.id);
                setSelected(null);
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button className="button" onClick={() => setSelected(null)}>
              Close
            </button>
            <label className="repeat-select">
              Repeat
              <select
                value={repeatCount}
                onChange={(event) => setRepeatCount(Number(event.target.value))}
              >
                <option value={1}>1x</option>
                <option value={3}>3x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
            </label>
            <button
              className="button primary"
              disabled={runningIds.has(selected.id)}
              onClick={() => void runRepeated(selected, repeatCount)}
            >
              <Play size={14} />
              {runningIds.has(selected.id)
                ? "Running..."
                : `Run ${repeatCount}x`}
            </button>
          </div>
        </Modal>
      )}
      {creating && (
        <Modal title="Create test" onClose={() => setCreating(false)}>
          <div className="form-stack">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Returns a concise summary"
              />
            </label>
            <label>
              Skill
              <select
                value={draft.skillId}
                onChange={(e) =>
                  setDraft({ ...draft, skillId: e.target.value })
                }
              >
                <option value="">Select a skill</option>
                {skills.map((skill) => (
                  <option value={skill.id} key={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Suite
              <input
                value={draft.suite}
                onChange={(e) => setDraft({ ...draft, suite: e.target.value })}
              />
            </label>
            <label>
              Input
              <textarea
                rows={4}
                value={draft.input}
                onChange={(e) => setDraft({ ...draft, input: e.target.value })}
              />
            </label>
            <label>
              Assertion
              <select
                value={draft.assertion}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    assertion: e.target.value as TestAssertion,
                    expected:
                      e.target.value === "valid-json" ? "" : draft.expected,
                  })
                }
              >
                {Object.entries(assertionLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.assertion !== "valid-json" && (
              <label>
                {draft.assertion.includes("length") ||
                draft.assertion.includes("word-count")
                  ? "Threshold"
                  : draft.assertion === "regex"
                    ? "Regular expression"
                    : "Expected text"}
                <input
                  type={
                    draft.assertion.includes("length") ||
                    draft.assertion.includes("word-count")
                      ? "number"
                      : "text"
                  }
                  min="0"
                  value={draft.expected}
                  onChange={(e) =>
                    setDraft({ ...draft, expected: e.target.value })
                  }
                  placeholder={
                    draft.assertion === "regex"
                      ? "^Result:.*$"
                      : "Required value"
                  }
                />
              </label>
            )}
            {![
              "valid-json",
              "length-greater",
              "length-less",
              "word-count-greater",
              "word-count-less",
            ].includes(draft.assertion) && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={draft.caseSensitive}
                  onChange={(e) =>
                    setDraft({ ...draft, caseSensitive: e.target.checked })
                  }
                />
                Case-sensitive comparison
              </label>
            )}
          </div>
          <div className="modal-actions">
            <button className="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                !draft.name.trim() ||
                !draft.skillId ||
                !draft.input.trim() ||
                (draft.assertion !== "valid-json" && !draft.expected.trim())
              }
              onClick={createTest}
            >
              Create test
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const packages = [
  [
    "PII Redactor",
    "Detect and redact sensitive data before model calls.",
    "Acme Security",
    "4.9",
  ],
  [
    "Slack Connector",
    "Read channels, search messages, and post updates.",
    "Skill Studio",
    "4.8",
  ],
  [
    "Web Research",
    "Search, browse, and cite reliable web sources.",
    "Northstar AI",
    "4.7",
  ],
  [
    "Postgres Toolkit",
    "Safely query and inspect PostgreSQL databases.",
    "Dataforge",
    "4.6",
  ],
  [
    "Document Parser",
    "Extract structured text from PDF, DOCX, and HTML.",
    "Paperwork",
    "4.8",
  ],
  [
    "Guardrails Pro",
    "Policy checks, injection detection, and moderation.",
    "Boundary Labs",
    "4.9",
  ],
];

const docSections = [
  ["docs-start", "Getting started"],
  ["docs-projects", "Projects"],
  ["docs-editor", "Skill Editor"],
  ["docs-assistant", "AI Assistant"],
  ["docs-testing", "Running and testing"],
  ["docs-manager", "Skill Manager"],
  ["docs-deploy", "Deploy"],
  ["docs-clis", "AI coding CLIs"],
  ["docs-providers", "Model connections"],
  ["docs-storage", "Data and security"],
  ["docs-help", "Troubleshooting"],
] as const;

export function Documentation() {
  return (
    <div className="page docs-page">
      <Header
        eyebrow="USER GUIDE"
        title="Documentation"
        description="The in-app guide to developing, testing, and installing local skills with Skill Studio."
      />
      <div className="docs-layout">
        <aside className="docs-nav">
          <span className="eyebrow">CONTENTS</span>
          {docSections.map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
              <ChevronRight size={13} />
            </a>
          ))}
        </aside>
        <main className="docs-content">
          <section className="docs-intro" id="docs-start">
            <span className="docs-kicker">SKILL STUDIO 0.1</span>
            <h2>Your local skill workspace</h2>
            <p>
              Skill Studio is a local-first desktop application for editing
              skill files, running them with real model providers, testing them,
              and installing them into supported agent directories.
            </p>
            <div className="docs-steps">
              <article>
                <b>01</b>
                <span>
                  <strong>Choose a workspace</strong>
                  <small>
                    Create or import a skill from any local authoring folder.
                  </small>
                </span>
              </article>
              <article>
                <b>02</b>
                <span>
                  <strong>Create a skill</strong>
                  <small>
                    Start a new skill, import a child folder, or directly open a
                    workspace whose root contains SKILL.md.
                  </small>
                </span>
              </article>
              <article>
                <b>03</b>
                <span>
                  <strong>Connect a model</strong>
                  <small>
                    Configure Ollama or a compatible API in Settings.
                  </small>
                </span>
              </article>
              <article>
                <b>04</b>
                <span>
                  <strong>Test and install</strong>
                  <small>
                    Validate with Playground and Tests, then install for your
                    target agent.
                  </small>
                </span>
              </article>
            </div>
          </section>

          <section className="docs-section" id="docs-projects">
            <div className="docs-section-title">
              <FolderKanban size={19} />
              <div>
                <span>INSTALL TARGETS</span>
                <h2>Projects</h2>
              </div>
            </div>
            <p>
              Projects stores local roots used by Skill Manager for
              project-scoped installations. Selecting <b>Add local project</b>{" "}
              scans the folder for OpenCode configuration and nested{" "}
              <code>SKILL.md</code> files. Discovered skills also appear in
              Skill Manager's Installed tab.
            </p>
            <div className="docs-callout">
              <ShieldCheck size={17} />
              <p>
                Authoring workspaces are selected independently when creating a
                skill. Removing a project from Skill Studio never deletes files
                from disk.
              </p>
            </div>
            <h3>Project actions</h3>
            <p>
              Use the project menu to rescan its skills, rename its display
              label, or remove it from the saved project list.{" "}
              <b>Refresh all</b> checks every saved project and updates its
              discovered-skill count. Projects refresh automatically when this
              page opens and every five minutes while it remains active. Missing
              or inaccessible folders are listed for confirmation before their
              saved records are removed; project files are never deleted by this
              cleanup.
            </p>
          </section>

          <section className="docs-section" id="docs-editor">
            <div className="docs-section-title">
              <Code2 size={19} />
              <div>
                <span>AUTHORING</span>
                <h2>Creating and editing skills</h2>
              </div>
            </div>
            <p>
              <b>New skill</b> uses any folder you choose as an authoring
              workspace. Skill Studio creates a normal skill directory directly
              inside it and can import existing direct child folders containing{" "}
              <code>SKILL.md</code>. Use <b>Open workspace</b> to select and
              open an existing skill directory whose root contains{" "}
              <code>SKILL.md</code>.
            </p>
            <div className="docs-code">
              <span>Created structure</span>
              <pre>{`workspace/\n└── incident-investigator/\n    └── SKILL.md`}</pre>
            </div>
            <h3>Editor modes</h3>
            <div className="docs-grid">
              <article>
                <b>Code</b>
                <p>
                  Edit raw skill and supporting files. Unsaved changes are shown
                  in the title bar.
                </p>
              </article>
              <article>
                <b>Form</b>
                <p>Edit SKILL.md content or TOML keys through guided fields.</p>
              </article>
              <article>
                <b>Blocks</b>
                <p>
                  Edit Markdown sections as visual blocks and add new sections.
                </p>
              </article>
              <article>
                <b>Preview</b>
                <p>Render Markdown and MDX files as a read-only document.</p>
              </article>
            </div>
            <p>
              The file tree supports folders and a dedicated right-click menu.
              Move opens a hierarchical destination menu with workspace root,
              parent, and valid folder targets. Skills can be removed from
              Studio with or without deleting their workspace files.
            </p>
            <p>
              Code mode uses a locally bundled Monaco editor with syntax
              highlighting for Markdown, Python, JavaScript/TypeScript, JSON,
              YAML, TOML, Rust, Go, Java, C/C++, shell, HTML/CSS, SQL, and other
              common text formats. JavaScript/TypeScript use Monaco language
              services, while Python and other common languages include local
              keyword and snippet completion. Python files expose{" "}
              <b>Run Python</b> when a Python 3 runtime is available on the
              device.
            </p>
            <div className="docs-callout warning">
              <ShieldCheck size={17} />
              <p>
                Python execution has a timeout and output limit but is not
                sandboxed. The script runs with the current operating-system
                user's permissions.
              </p>
            </div>
          </section>

          <section className="docs-section" id="docs-assistant">
            <div className="docs-section-title">
              <Sparkles size={19} />
              <div>
                <span>AI AUTHORING</span>
                <h2>AI Writing Assistant</h2>
              </div>
            </div>
            <p>
              The conversation beside the editor sends the current file as model
              context. Conversations are global threads grouped by provider, so
              they remain available across files without mixing histories from
              different model connections. Use the thread selector to reopen a
              conversation or the plus button to start a new one. Drag the
              panel's left edge to resize it.
            </p>
            <ol>
              <li>Select an active model connection in Settings.</li>
              <li>Describe what you want written, corrected, or reviewed.</li>
              <li>
                Press <b>Enter</b> to send or <b>Shift + Enter</b> for a new
                line.
              </li>
              <li>
                Use <b>Append to file</b> on a useful response, review it, and
                save.
              </li>
            </ol>
            <div className="docs-callout warning">
              <Sparkles size={17} />
              <p>
                Review every assistant change. Inserted content can be written
                by the editor's auto-save setting after the normal delay.
              </p>
            </div>
          </section>

          <section className="docs-section" id="docs-testing">
            <div className="docs-section-title">
              <TestTube2 size={19} />
              <div>
                <span>VALIDATION</span>
                <h2>Playground and Tests</h2>
              </div>
            </div>
            <div className="docs-grid two">
              <article>
                <b>Playground</b>
                <p>
                  Select a skill, model connection, and input to make a real
                  provider request. Output, duration, and errors are recorded in
                  Runs.
                </p>
              </article>
              <article>
                <b>Tests</b>
                <p>
                  Define scenarios with text, regular-expression, length, word
                  count, or valid JSON assertions and repeat them to measure a
                  success rate.
                </p>
              </article>
            </div>
            <p>
              The latest 100 runs are retained locally. Real model availability,
              quota, and network conditions can affect test results.
            </p>
          </section>

          <section className="docs-section" id="docs-manager">
            <div className="docs-section-title">
              <Blocks size={19} />
              <div>
                <span>DISTRIBUTION</span>
                <h2>Skill Manager</h2>
              </div>
            </div>
            <p>
              <b>Discover</b> sends searches directly to skills.sh. Install a
              result through the bundled official skills CLI by choosing an
              assistant, scope, and saved project when needed.{" "}
              <b>Default / General</b> uses the shared{" "}
              <code>.agents/skills</code> location for compatible CLIs not
              listed separately.
            </p>
            <p>
              Project-scoped installs maintain a clearly marked Skill Studio
              section in the project's <code>AGENTS.md</code>, creating the file
              when needed and recording the installed skill's relative path
              without replacing existing instructions.
            </p>
            <p>
              Skills you authored locally can be installed from the{" "}
              <b>Skills</b> page. The install action copies the complete
              workspace into the selected project's or assistant's global skill
              directory and tracks the exact target in Skill Manager.
            </p>
            <p>
              Removing installed files deletes only the exact managed skill
              directory recorded by Skill Studio. Removal does not run the
              skills CLI or affect another installation of the same skill.
            </p>
            <p>
              <b>Installed</b> combines two sources:
            </p>
            <div className="docs-grid two">
              <article>
                <b>Active</b>
                <p>
                  A skill installed and tracked by Skill Studio. Update and
                  remove actions are available while its directory exists.
                </p>
              </article>
              <article>
                <b>Discovered</b>
                <p>
                  An external skill found under a saved project. Give an unknown
                  skill a local display name, or explicitly delete its exact
                  directory after confirmation. Managed installations and
                  authored workspaces are excluded from discovery. The last
                  known discovered inventory is retained locally across app
                  restarts and refreshed when its project can be scanned.
                </p>
              </article>
            </div>
            <div className="docs-callout">
              <ShieldCheck size={17} />
              <p>
                Project operations run in the selected project. Global
                operations use the selected assistant's configuration directory.
                Missing installations and deleted project directories are
                reported explicitly.
              </p>
            </div>
          </section>

          <section className="docs-section" id="docs-deploy">
            <div className="docs-section-title">
              <GitBranch size={19} />
              <div>
                <span>PUBLISHING</span>
                <h2>Deploy to GitHub and skills.sh</h2>
              </div>
            </div>
            <p>
              Deploy signs in through the bundled GitHub CLI, creates a public
              repository, commits the selected skill's complete workspace in a
              temporary staging directory, and pushes it to GitHub. Your
              authored workspace and its existing Git history are not modified.
            </p>
            <ol>
              <li>
                Select Sign in with GitHub. GitHub CLI and Git are included with
                the desktop application.
              </li>
              <li>
                Complete the browser/device flow using the one-time clipboard
                code.
              </li>
              <li>Select a skill, enter a new repository name, and publish.</li>
              <li>
                Run the generated <code>npx skills add</code> command to verify
                discovery.
              </li>
            </ol>
            <div className="docs-callout">
              <ShieldCheck size={17} />
              <p>
                GitHub CLI stores credentials using its secure operating-system
                credential mechanism. Skill Studio never places a GitHub token
                in Zustand state or the authored repository.
              </p>
            </div>
            <h3>Deployed repositories</h3>
            <p>
              Every repository created by Skill Studio is tracked in the local
              deployment registry. Refresh checks GitHub for availability,
              visibility, default branch, and the latest push. Repositories
              deleted or made inaccessible outside the app are marked missing.
            </p>
            <p>
              <b>Update from workspace</b> clones an available repository into a
              temporary directory, overlays the current authored workspace,
              commits changes, and pushes them. <b>Forget record</b> removes
              only local tracking metadata and never deletes the GitHub
              repository. Log out removes the local GitHub CLI session.
            </p>
            <p>
              Skills.sh indexes public GitHub sources and may not show a new
              repository immediately. It does not require a separate publisher
              login.
            </p>
          </section>

          <section className="docs-section" id="docs-clis">
            <div className="docs-section-title">
              <Terminal size={19} />
              <div>
                <span>ECOSYSTEM</span>
                <h2>AI coding CLIs</h2>
              </div>
            </div>
            <p>
              CLIs is a searchable reference for coding agents that can use
              skills or complement Skill Studio workflows. Filter by tool,
              provider, category, or pricing label, then open the official
              website in your system browser.
            </p>
            <div className="docs-callout warning">
              <ExternalLink size={17} />
              <p>
                Pricing and free-tier labels are informational and can change.
                Verify current availability and terms on the provider's website.
              </p>
            </div>
          </section>

          <section className="docs-section" id="docs-providers">
            <div className="docs-section-title">
              <Settings2 size={19} />
              <div>
                <span>MODELS</span>
                <h2>Model connections</h2>
              </div>
            </div>
            <h3>Ollama</h3>
            <div className="docs-code">
              <span>Default address</span>
              <pre>http://127.0.0.1:11434</pre>
            </div>
            <p>
              Ollama must be running locally. Download a model first, choose its
              exact name in Settings, and run <b>Test connection</b>.
            </p>
            <h3>Google Gemini</h3>
            <p>
              Create a Gemini API key for free in Google AI Studio, add the
              Gemini preset, and test the connection. Keep the{" "}
              <code>/v1beta/openai</code> endpoint suffix and confirm that the
              selected model is available for your account.
            </p>
            <h3>OpenAI-compatible</h3>
            <p>
              For OpenRouter or another compatible service, enter an HTTPS base
              URL, model identifier, and API key when required. Remote endpoints
              must use HTTPS.
            </p>
            <div className="docs-callout warning">
              <ShieldCheck size={17} />
              <p>
                Provider API keys are persisted in local application state.
                Avoid production credentials on shared devices.
              </p>
            </div>
          </section>

          <section className="docs-section" id="docs-storage">
            <div className="docs-section-title">
              <ShieldCheck size={19} />
              <div>
                <span>LOCAL-FIRST</span>
                <h2>Data and security</h2>
              </div>
            </div>
            <p>
              The web app stores Zustand state in <code>localStorage</code>. The
              Tauri app writes the same state to <code>state.json</code> in the
              operating system's application-data directory. Managed
              installations are tracked separately in{" "}
              <code>installations.json</code>.
            </p>
            <ul>
              <li>
                Workspace file operations cannot leave their selected root.
              </li>
              <li>
                Discovered skills not managed by Skill Studio are never deleted.
              </li>
              <li>Desktop Ollama access is limited to HTTP localhost.</li>
              <li>Rust limits provider and catalog responses to 4 MiB.</li>
              <li>
                Cloud sync remains disabled without Supabase environment
                variables.
              </li>
            </ul>
          </section>

          <section className="docs-section" id="docs-help">
            <div className="docs-section-title">
              <Terminal size={19} />
              <div>
                <span>SUPPORT</span>
                <h2>Troubleshooting</h2>
              </div>
            </div>
            <div className="docs-faq">
              <details>
                <summary>The model connection fails</summary>
                <p>
                  For Ollama, confirm the service is running and the model is
                  downloaded. For remote providers, verify the base URL, model
                  ID, API key, and account quota.
                </p>
              </details>
              <details>
                <summary>Provider requests are blocked in the web app</summary>
                <p>
                  Browser CORS policies can block direct provider requests. Use
                  the Tauri desktop app, which sends network requests through
                  Rust.
                </p>
              </details>
              <details>
                <summary>A project skill is missing</summary>
                <p>
                  Confirm the file exists at{" "}
                  <code>
                    &lt;project&gt;/.opencode/skills/&lt;skill-id&gt;/SKILL.md
                  </code>
                  , run Rescan in Projects, then Refresh installed in Skill
                  Manager.
                </p>
              </details>
              <details>
                <summary>The editor cannot save a file</summary>
                <p>
                  Confirm that the authoring workspace and skill directories
                  still exist and are writable. The editor displays a filesystem
                  error when its workspace is missing.
                </p>
              </details>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export function Projects() {
  const {
    projects,
    skills,
    addProject,
    updateProject,
    removeProject,
    setDiscoveredSkillsForProject,
    requestInstalledRefresh,
  } = useStudio();
  const authoredWorkspacePaths = skills.flatMap((skill) =>
    skill.workspacePath ? [skill.workspacePath] : [],
  );
  const location = useLocation();
  const projectsActive = location.pathname === "/projects";
  const projectScanKey = projects
    .map((project) => `${project.id}\0${project.name}\0${project.path}`)
    .join("\n");
  const authoredWorkspaceKey = authoredWorkspacePaths.join("\n");
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [rescanning, setRescanning] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState<
    "rename" | "remove" | null
  >(null);
  const [projectName, setProjectName] = useState("");
  const [projectNotice, setProjectNotice] = useState("");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [missingProjects, setMissingProjects] = useState<typeof projects>([]);
  const refreshAllBusy = useRef(false);
  const ignoredMissingPaths = useRef(new Set<string>());
  const chooseDirectory = async () => {
    if (!isTauri()) return;
    try {
      const selectedPath = await selectProjectDirectory();
      if (selectedPath) setPath(selectedPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectError(message);
    }
  };
  const add = async () => {
    setScanning(true);
    setProjectError("");
    try {
      const p = validateProjectPath(path);
      const [detection, discovered] = isTauri()
        ? await Promise.all([
            detectOpenCode(p),
            scanProjectSkills(p, authoredWorkspacePaths),
          ])
        : [{ detected: false, skillsCount: 0 }, [] as InstalledSkill[]];
      addProject({
        id: crypto.randomUUID(),
        name: p.split(/[\\/]/).pop() || "Local project",
        path: p,
        platform: detection.detected ? "OpenCode" : "Generic",
        skills: discovered.length,
        updated: new Date().toISOString(),
        discoveredSkillPaths: discovered.map((skill) => skill.targetPath),
      });
      setDiscoveredSkillsForProject(p, discovered);
      if (discovered.length) {
        setProjectNotice(
          `${discovered.length} skill${discovered.length === 1 ? "" : "s"} found and added to Skill Manager's Installed tab.`,
        );
      }
      requestInstalledRefresh();
      setSelected(projects.length);
      setOpen(false);
      setPath("");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
  };
  const current = projects[selected];
  const rescanCurrent = async () => {
    if (!current) return;
    setRescanning(true);
    setProjectError("");
    try {
      const [detection, discovered] = await Promise.all([
        detectOpenCode(current.path),
        scanProjectSkills(current.path, authoredWorkspacePaths),
      ]);
      const previous = new Set(current.discoveredSkillPaths ?? []);
      const added = discovered.filter(
        (skill) => !previous.has(skill.targetPath),
      );
      updateProject(current.id, {
        platform: detection.detected ? "OpenCode" : "Generic",
        skills: discovered.length,
        updated: new Date().toISOString(),
        discoveredSkillPaths: discovered.map((skill) => skill.targetPath),
      });
      setDiscoveredSkillsForProject(current.path, discovered);
      if (added.length) {
        setProjectNotice(
          `${added.length} new skill${added.length === 1 ? "" : "s"} found and added to Skill Manager's Installed tab.`,
        );
      }
      requestInstalledRefresh();
      setActionsOpen(false);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
      setMissingProjects([current]);
    } finally {
      setRescanning(false);
    }
  };
  const refreshAll = async (announce = true) => {
    if (
      !isTauri() ||
      !projects.length ||
      refreshAllBusy.current ||
      scanning ||
      rescanning
    )
      return;
    refreshAllBusy.current = true;
    setRefreshingAll(true);
    if (announce) setProjectError("");
    try {
      const results = await Promise.all(
        projects.map(async (project) => {
          try {
            const [detection, discovered] = await Promise.all([
              detectOpenCode(project.path),
              scanProjectSkills(project.path, authoredWorkspacePaths),
            ]);
            return { project, detection, discovered, error: "" };
          } catch (error) {
            return {
              project,
              detection: null,
              discovered: [] as InstalledSkill[],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
      const available = results.filter((result) => !result.error);
      const unavailable = results
        .filter((result) => result.error)
        .map((result) => result.project);
      available.forEach(({ project, detection, discovered }) => {
        updateProject(project.id, {
          platform: detection?.detected ? "OpenCode" : "Generic",
          skills: discovered.length,
          updated: new Date().toISOString(),
          discoveredSkillPaths: discovered.map((skill) => skill.targetPath),
        });
        setDiscoveredSkillsForProject(project.path, discovered);
      });
      const unavailablePaths = new Set(
        unavailable.map((project) => project.path),
      );
      ignoredMissingPaths.current.forEach((path) => {
        if (!unavailablePaths.has(path))
          ignoredMissingPaths.current.delete(path);
      });
      if (
        unavailable.length &&
        (announce ||
          unavailable.some(
            (project) => !ignoredMissingPaths.current.has(project.path),
          ))
      )
        setMissingProjects(unavailable);
      else if (!unavailable.length) setMissingProjects([]);
      requestInstalledRefresh();
      if (announce) {
        const total = available.reduce(
          (sum, result) => sum + result.discovered.length,
          0,
        );
        setProjectNotice(
          `${available.length} project${available.length === 1 ? "" : "s"} refreshed. ${total} discovered skill${total === 1 ? "" : "s"} found.`,
        );
      }
    } finally {
      refreshAllBusy.current = false;
      setRefreshingAll(false);
    }
  };
  useEffect(() => {
    if (!projectsActive) {
      setMissingProjects([]);
      return;
    }
    if (!isTauri() || !projects.length) return;
    void refreshAll(false);
    const timer = window.setInterval(() => void refreshAll(false), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [projectsActive, projectScanKey, authoredWorkspaceKey]);
  return (
    <div className="page">
      <Header
        eyebrow="LOCAL WORKSPACES"
        title="Projects"
        description="Connect local projects and manage the skills installed in each workspace."
        actions={
          <>
            <button
              className="button"
              disabled={refreshingAll || !projects.length || !isTauri()}
              onClick={() => void refreshAll(true)}
            >
              <RefreshCw className={refreshingAll ? "spin" : ""} size={15} />
              {refreshingAll ? "Refreshing..." : "Refresh all"}
            </button>
            <button className="button primary" onClick={() => setOpen(true)}>
              <Plus size={15} />
              Add local project
            </button>
          </>
        }
      />
      {projectNotice && (
        <DismissibleMessage
          role="status"
          onDismiss={() => setProjectNotice("")}
        >
          {projectNotice}
        </DismissibleMessage>
      )}
      {!projects.length ? (
        <section className="empty-state project-empty">
          <FolderKanban size={30} />
          <h2>No saved projects</h2>
          <p>
            Add a local folder to use it as an OpenCode installation target.
          </p>
          <button className="button primary" onClick={() => setOpen(true)}>
            <Plus size={15} />
            Add your first project
          </button>
        </section>
      ) : (
        <div className="project-layout">
          <section className="project-list">
            {projects.map((p, i) => (
              <button
                className={`project-row ${selected === i ? "active" : ""}`}
                onClick={() => setSelected(i)}
                key={p.path}
              >
                <span className="package-icon">
                  <Terminal size={18} />
                </span>
                <span>
                  <b>{p.name}</b>
                  <small>{p.path}</small>
                </span>
                <span>
                  <Status value={p.platform} />
                  <small>{p.skills} skills</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>
          {current && (
            <aside className="panel project-detail">
              <div className="project-hero">
                <span className="package-icon">
                  <Terminal size={21} />
                </span>
                <div>
                  <h2>{current.name}</h2>
                  <code>{current.path}</code>
                </div>
                <div className="project-actions">
                  <button
                    className="button project-menu-trigger"
                    aria-label="Project actions"
                    aria-expanded={actionsOpen}
                    onClick={() => setActionsOpen((value) => !value)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {actionsOpen && (
                    <div className="project-menu">
                      <button
                        disabled={rescanning}
                        onClick={() => void rescanCurrent()}
                      >
                        <RefreshCw
                          className={rescanning ? "spin" : ""}
                          size={14}
                        />
                        <span>
                          <b>{rescanning ? "Scanning..." : "Rescan skills"}</b>
                          <small>
                            Refresh platform and installed skill count
                          </small>
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setProjectName(current.name);
                          setProjectDialog("rename");
                          setActionsOpen(false);
                        }}
                      >
                        <Settings2 size={14} />
                        <span>
                          <b>Rename project</b>
                          <small>Change only the display name</small>
                        </span>
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          setProjectDialog("remove");
                          setActionsOpen(false);
                        }}
                      >
                        <Trash2 size={14} />
                        <span>
                          <b>Remove project</b>
                          <small>Keep every file on disk</small>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {projectError && (
                <DismissibleMessage
                  role="alert"
                  onDismiss={() => setProjectError("")}
                >
                  {projectError}
                </DismissibleMessage>
              )}
              <div className="detail-grid">
                <div>
                  <span>PLATFORM</span>
                  <b>{current.platform}</b>
                </div>
                <div>
                  <span>GIT BRANCH</span>
                  <b>Not inspected</b>
                </div>
                <div>
                  <span>INSTALLED SKILLS</span>
                  <b>{current.skills}</b>
                </div>
                <div>
                  <span>LAST SCANNED</span>
                  <b>{current.updated}</b>
                </div>
              </div>
              <h3>Workspace</h3>
              <p className="muted">
                Use this saved project directly when installing a skill from
                Skill Manager.
              </p>
              <Link className="button full" to="/manager">
                Browse skills for this project
              </Link>
            </aside>
          )}
        </div>
      )}
      {open && (
        <Modal title="Add local project" onClose={() => setOpen(false)}>
          <p className="muted">
            Choose a project directory. Skill Studio will detect OpenCode
            configuration and installed skills.
          </p>
          <div className="folder-picker">
            <Terminal size={22} />
            <div>
              <b>Project directory</b>
              <span>{path || "No folder selected"}</span>
            </div>
            <button className="button" onClick={() => void chooseDirectory()}>
              Browse...
            </button>
          </div>
          {!isTauri() && (
            <label>
              Project path
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/project"
              />
            </label>
          )}
          {projectError && (
            <DismissibleMessage
              role="alert"
              onDismiss={() => setProjectError("")}
            >
              {projectError}
            </DismissibleMessage>
          )}
          <div className="modal-actions">
            <button className="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!path || scanning}
              onClick={add}
            >
              {scanning ? (
                <>
                  <RefreshCw className="spin" size={14} />
                  Detecting...
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add project
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
      {projectDialog && current && (
        <Modal
          title={
            projectDialog === "rename" ? "Rename project" : "Remove project"
          }
          onClose={() => setProjectDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (projectDialog === "rename" && !projectName.trim()) return;
              if (projectDialog === "rename")
                updateProject(current.id, { name: projectName.trim() });
              else {
                removeProject(current.id);
                requestInstalledRefresh();
                setSelected(0);
              }
              setProjectDialog(null);
            }}
          >
            {projectDialog === "rename" ? (
              <label>
                Project name
                <input
                  autoFocus
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
            ) : (
              <p>
                Remove <b>{current.name}</b> from Skill Studio? Files will
                remain on disk.
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setProjectDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`button ${projectDialog === "remove" ? "danger" : "primary"}`}
                disabled={projectDialog === "rename" && !projectName.trim()}
              >
                {projectDialog === "rename" ? "Rename" : "Remove"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {missingProjects.length > 0 && (
        <Modal
          title="Remove unavailable projects?"
          onClose={() => {
            missingProjects.forEach((project) =>
              ignoredMissingPaths.current.add(project.path),
            );
            setMissingProjects([]);
          }}
          wide
        >
          <p>
            These project folders are missing or inaccessible. Remove their
            saved records from Skill Studio? Files are never deleted by this
            action.
          </p>
          <div className="missing-project-list">
            {missingProjects.map((project) => (
              <div key={project.id}>
                <b>{project.name}</b>
                <code>{project.path}</code>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                missingProjects.forEach((project) =>
                  ignoredMissingPaths.current.add(project.path),
                );
                setMissingProjects([]);
              }}
            >
              Keep records
            </button>
            <button
              className="button danger"
              onClick={() => {
                missingProjects.forEach((project) => {
                  removeProject(project.id);
                  ignoredMissingPaths.current.delete(project.path);
                });
                setMissingProjects([]);
                setSelected(0);
                requestInstalledRefresh();
                setProjectNotice(
                  `${missingProjects.length} unavailable project record${missingProjects.length === 1 ? "" : "s"} removed from Skill Studio.`,
                );
              }}
            >
              Remove from Skill Studio
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Skills() {
  const skills = useStudio((state) => state.skills);
  const navigate = useNavigate();
  return (
    <div className="page">
      <Header
        eyebrow="LIBRARY"
        title="Skills"
        description="Browse and maintain every skill in this workspace."
      />
      <div className="data-table">
        <div className="table-row skills-table table-head">
          <span>SKILL</span>
          <span>STATUS</span>
          <span>VERSION</span>
          <span>RUNS</span>
          <span>PASS RATE</span>
          <span />
        </div>
        {skills.map((s) => (
          <div className="table-row skills-table skill-library-row" key={s.id}>
            <button
              className="skill-open-cell"
              onClick={() => navigate(`/skills/${s.id}/editor`)}
            >
              <span className="skill-icon mini">{s.icon}</span>
              <b>{s.name}</b>
            </button>
            <span>
              <Status value={s.status} />
            </span>
            <span>v{s.version}</span>
            <span>{s.runs.toLocaleString()}</span>
            <span>{s.passRate}%</span>
            <SkillActionControls
              skill={s}
              onOpen={() => navigate(`/skills/${s.id}/editor`)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Runs() {
  const { runs, skills } = useStudio();
  return (
    <div className="page">
      <Header
        eyebrow="OBSERVABILITY"
        title="Runs"
        description="Inspect recent skill executions across projects and environments."
        actions={
          <button className="button">
            <Download size={14} />
            Export
          </button>
        }
      />
      <div className="data-table">
        <div className="table-row runs-table table-head">
          <span>RUN ID</span>
          <span>SKILL</span>
          <span>PROJECT</span>
          <span>STATUS</span>
          <span>LATENCY</span>
          <span>STARTED</span>
        </div>
        {runs.map((run) => (
          <button
            className="table-row runs-table"
            key={run.id}
            title={run.error || run.output}
          >
            <span>
              <Terminal size={14} />
              <code>{run.id.slice(0, 12)}</code>
            </span>
            <span>
              {skills.find((skill) => skill.id === run.skillId)?.name ??
                "Deleted skill"}
            </span>
            <span>
              {run.provider} / {run.model}
            </span>
            <span>
              <Status value={run.status === "passed" ? "Passed" : "Failed"} />
            </span>
            <span>{run.durationMs}ms</span>
            <span>{new Date(run.createdAt).toLocaleString()}</span>
          </button>
        ))}
        {!runs.length && (
          <p className="muted">No runs yet. Execute a skill in Playground.</p>
        )}
      </div>
    </div>
  );
}

type ManagedSkill = {
  id: string;
  name: string;
  version: string;
  platform: string;
  scope: string;
  path: string;
  status: string;
};
const formatInstallCount = (value: string) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);

export function Manager() {
  const projects = useStudio((state) => state.projects);
  const skills = useStudio((state) => state.skills);
  const updateProject = useStudio((state) => state.updateProject);
  const installedInventoryRevision = useStudio(
    (state) => state.installedInventoryRevision,
  );
  const discoveredSkillNames = useStudio((state) => state.discoveredSkillNames);
  const discoveredSkills = useStudio((state) => state.discoveredSkills);
  const setDiscoveredSkills = useStudio((state) => state.setDiscoveredSkills);
  const setDiscoveredSkillName = useStudio(
    (state) => state.setDiscoveredSkillName,
  );
  const [tab, setTab] = useState<"discover" | "installed">("discover");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [allCatalog, setAllCatalog] = useState<CatalogSkill[]>([]);
  const [details, setDetails] = useState<Record<string, CatalogSkillDetail>>(
    {},
  );
  const [selected, setSelected] = useState<CatalogSkill | null>(null);
  const [removingInstallation, setRemovingInstallation] =
    useState<InstalledSkill | null>(null);
  const [installed, setInstalled] =
    useState<InstalledSkill[]>(discoveredSkills);
  const [scope, setScope] = useState<"project" | "global">("global");
  const [projectPath, setProjectPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [warningsDismissed, setWarningsDismissed] = useState(false);
  const [visible, setVisible] = useState(12);
  const [agent, setAgent] = useState("universal");
  const [operation, setOperation] = useState("");
  const [installNotice, setInstallNotice] = useState("");
  const [namingInstallation, setNamingInstallation] =
    useState<InstalledSkill | null>(null);
  const [discoveredName, setDiscoveredName] = useState("");
  const [deletingDiscovery, setDeletingDiscovery] =
    useState<InstalledSkill | null>(null);
  const [discoveryDeleteError, setDiscoveryDeleteError] = useState("");
  const authoredWorkspacePaths = skills.flatMap((skill) =>
    skill.workspacePath ? [skill.workspacePath] : [],
  );
  const authoredWorkspaceKey = authoredWorkspacePaths.join("\n");
  const projectScanKey = projects.map((project) => project.path).join("\n");

  const refreshInstalled = async (revealWarnings = false) => {
    if (!isTauri()) return;
    if (revealWarnings) setWarningsDismissed(false);
    try {
      const [managed, discoveredByProject] = await Promise.all([
        listInstalledSkills(),
        Promise.allSettled(
          projects.map((project) =>
            scanProjectSkills(project.path, authoredWorkspacePaths),
          ),
        ),
      ]);
      const successfulProjectPaths = new Set(
        discoveredByProject.flatMap((result, index) =>
          result.status === "fulfilled" ? [projects[index].path] : [],
        ),
      );
      const persisted = new Map(
        discoveredSkills
          .filter(
            (item) =>
              item.projectPath &&
              projects.some((project) => project.path === item.projectPath) &&
              !successfulProjectPaths.has(item.projectPath),
          )
          .map((item) => [item.targetPath, item]),
      );
      discoveredByProject.forEach((result, index) => {
        if (result.status === "fulfilled")
          result.value.forEach((item) =>
            persisted.set(item.targetPath, {
              ...item,
              projectPath: projects[index].path,
            }),
          );
      });
      const nextDiscoveredSkills = [...persisted.values()];
      setDiscoveredSkills(nextDiscoveredSkills);
      const merged = new Map<string, InstalledSkill>();
      nextDiscoveredSkills.forEach((item) => merged.set(item.targetPath, item));
      managed.forEach((item) => merged.set(item.targetPath, item));
      setInstalled([...merged.values()]);
      setScanWarnings(
        discoveredByProject.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                `${projects[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              ]
            : [],
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const loadDetails = async (items: CatalogSkill[]) => {
    const loaded = await Promise.all(
      items
        .filter((item) => !details[item.id])
        .map(async (item) => {
          try {
            return await getCatalogSkill(item.source, item.slug);
          } catch {
            return null;
          }
        }),
    );
    setDetails((current) => ({
      ...current,
      ...Object.fromEntries(
        loaded
          .filter((item): item is CatalogSkillDetail => Boolean(item))
          .map((item) => [item.id, item]),
      ),
    }));
  };
  const searchCatalog = async (value = query) => {
    setMessage("");
    if (!isTauri()) {
      setMessage(
        "The skills CLI integration is available in the Tauri desktop app.",
      );
      return;
    }
    if (!value.trim()) {
      setLoading(true);
      try {
        const results = allCatalog.length
          ? allCatalog
          : await popularSkillCatalog(100);
        setAllCatalog(results);
        setCatalog(results);
        setVisible(12);
        await loadDetails(results.slice(0, 12));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (value.trim().length < 2) {
      setMessage("Enter at least two characters.");
      return;
    }
    setLoading(true);
    try {
      const results = await searchSkillCatalog(value.trim());
      setCatalog(results);
      setVisible(12);
      await loadDetails(results.slice(0, 12));
      if (!results.length) setMessage("No matching skill found on skills.sh.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void searchCatalog("");
  }, []);
  useEffect(() => {
    void refreshInstalled();
  }, [installedInventoryRevision, authoredWorkspaceKey, projectScanKey]);

  const removeDiscovered = async () => {
    const projectPath = deletingDiscovery?.projectPath;
    if (!deletingDiscovery || !projectPath) return;
    const item = deletingDiscovery;
    setBusy(item.targetPath);
    setMessage("");
    setDiscoveryDeleteError("");
    setOperation(`Deleting ${item.name} files...`);
    try {
      await deleteDiscoveredSkill(
        projectPath,
        item.targetPath,
        authoredWorkspacePaths,
      );
      const remaining = await scanProjectSkills(
        projectPath,
        authoredWorkspacePaths,
      );
      const project = projects.find(
        (candidate) => candidate.path === projectPath,
      );
      if (project)
        updateProject(project.id, {
          skills: remaining.length,
          updated: new Date().toISOString(),
          discoveredSkillPaths: remaining.map((skill) => skill.targetPath),
        });
      await refreshInstalled();
      setDeletingDiscovery(null);
      setMessage(`${item.name} was permanently deleted from the project.`);
    } catch (error) {
      setDiscoveryDeleteError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusy("");
      setOperation("");
    }
  };
  const openDetail = async (item: CatalogSkill) => {
    setSelected(item);
    setInstallNotice("");
    if (!details[item.id]) {
      try {
        const detail = await getCatalogSkill(item.source, item.slug);
        setDetails((current) => ({ ...current, [item.id]: detail }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  };
  const chooseInstallPath = async () => {
    try {
      const path = await selectProjectDirectory();
      if (path) setProjectPath(path);
    } catch (error) {
      setInstallNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const install = async () => {
    if (!selected) return;
    setBusy(selected.id);
    setInstallNotice("");
    setOperation(`Installing ${selected.name} for ${agent}...`);
    try {
      await installCatalogSkill(
        selected.source,
        selected.slug,
        projectPath,
        scope,
        agent,
      );
      await refreshInstalled();
      setInstallNotice(
        `${selected.name} installed for ${agent}. You can close this dialog or install it elsewhere.`,
      );
    } catch (error) {
      setInstallNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
      setOperation("");
    }
  };
  const remove = async (item: InstalledSkill, deleteFiles: boolean) => {
    setBusy(item.id);
    setMessage("");
    setOperation(
      deleteFiles
        ? `Deleting ${item.name} files...`
        : `Forgetting ${item.name}...`,
    );
    try {
      if (deleteFiles && item.available)
        await removeCatalogSkill(item.targetPath);
      else await forgetCatalogSkill(item.targetPath);
      await refreshInstalled();
      setMessage(
        !item.available
          ? `${item.name} missing record removed from Skill Studio.`
          : deleteFiles
            ? `${item.name} files and managed record removed.`
            : `${item.name} removed from Skill Studio tracking. Files were kept.`,
      );
      setRemovingInstallation(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
      setOperation("");
    }
  };
  const update = async (item: InstalledSkill) => {
    setBusy(item.id);
    setMessage("");
    setOperation(`Updating ${item.name}...`);
    try {
      await updateCatalogSkill(item.targetPath);
      setMessage(`${item.name} is up to date.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
      setOperation("");
    }
  };
  const selectedDetail = selected ? details[selected.id] : null;
  return (
    <div className="page manager-store">
      <Header
        eyebrow="SKILLS.SH / OPEN AGENT SKILLS"
        title="Skill manager"
        description="Discover skills from skills.sh and install them through the official skills CLI."
        actions={
          <button
            className="button"
            onClick={() => void refreshInstalled(true)}
          >
            <RefreshCw size={14} />
            Refresh installed
          </button>
        }
      />
      <div className="tabs manager-tabs">
        <button
          className={tab === "discover" ? "active" : ""}
          onClick={() => setTab("discover")}
        >
          Discover
        </button>
        <button
          className={tab === "installed" ? "active" : ""}
          onClick={() => setTab("installed")}
        >
          Installed ({installed.length})
        </button>
      </div>
      {message && (
        <DismissibleMessage role="status" onDismiss={() => setMessage("")}>
          {message}
        </DismissibleMessage>
      )}
      {scanWarnings.length > 0 && !warningsDismissed && (
        <div className="manager-message dismissible-message" role="status">
          <button
            className="icon-btn"
            aria-label="Dismiss warning"
            onClick={() => setWarningsDismissed(true)}
          >
            <XCircle size={15} />
          </button>
          <b>Some saved projects could not be scanned:</b>
          {scanWarnings.map((warning) => (
            <span className="message-line" key={warning}>
              {warning}
            </span>
          ))}
        </div>
      )}
      {operation &&
        !selected &&
        !removingInstallation &&
        !deletingDiscovery && (
          <div className="operation-bar">
            <RefreshCw className="spin" size={15} />
            <span>{operation}</span>
            <i>
              <b />
            </i>
          </div>
        )}
      {tab === "discover" ? (
        <>
          <form
            className="catalog-search"
            onSubmit={(event) => {
              event.preventDefault();
              void searchCatalog();
            }}
          >
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills.sh..."
            />
            <button className="button primary" disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </button>
          </form>
          <div className="catalog-grid">
            {catalog.slice(0, visible).map((item) => {
              const detail = details[item.id];
              const isInstalled = installed.some((row) => row.id === item.slug);
              return (
                <article className="catalog-card" key={item.id}>
                  <div className="catalog-card-top">
                    <span className="skill-icon">
                      {item.slug.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="catalog-installs">
                      {formatInstallCount(item.installs)} installs
                    </span>
                  </div>
                  <h3>{item.name}</h3>
                  <code>{item.source}</code>
                  <p>{detail?.description || "Skills.sh catalog skill"}</p>
                  <div className="catalog-card-actions">
                    <button
                      className="button"
                      onClick={() => void openDetail(item)}
                    >
                      Details
                    </button>
                    <button
                      className="button primary"
                      onClick={() => void openDetail(item)}
                    >
                      {isInstalled ? "Install again" : "Install"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {visible < catalog.length && (
            <div className="load-more">
              <button
                className="button"
                onClick={() => {
                  const next = Math.min(visible + 12, catalog.length);
                  void loadDetails(catalog.slice(visible, next));
                  setVisible(next);
                }}
              >
                Show more skills
              </button>
            </div>
          )}
          {!loading && !catalog.length && (
            <section className="panel">
              <h3>Search the skills catalog</h3>
              <p className="muted">
                Searches are sent to the complete skills.sh catalog instead of
                filtering only the initial popular results.
              </p>
            </section>
          )}
        </>
      ) : (
        <section className="installed-list">
          <div className="installed-list-head">
            <h2>Installed skills</h2>
          </div>
          {installed.map((item) => {
            const displayName = item.identityKnown
              ? item.name
              : discoveredSkillNames[item.targetPath] || item.name;
            const canDeleteDiscovery =
              Boolean(item.projectPath) &&
              item.targetPath.replace(/[\\/]+$/, "").toLowerCase() !==
                item.projectPath?.replace(/[\\/]+$/, "").toLowerCase();
            return (
              <article className="installed-card" key={item.targetPath}>
                <span className="skill-icon">
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
                <div className="installed-copy">
                  <h3>{displayName}</h3>
                  {item.available && (
                    <code title={item.targetPath}>{item.targetPath}</code>
                  )}
                  <small>
                    {item.pathError ||
                      `${item.platform} · ${item.scope} · ${item.managed ? `installed ${new Date(item.installedAt).toLocaleString()}` : "discovered in saved project"}`}
                  </small>
                </div>
                <div className="installed-state">
                  <Status
                    value={
                      !item.available
                        ? "Missing"
                        : item.managed
                          ? "Active"
                          : "Discovered"
                    }
                  />
                  {!item.managed && (
                    <span className="managed-note">
                      Managed outside Skill Studio
                    </span>
                  )}
                </div>
                {item.managed ? (
                  <div className="installed-actions">
                    {item.available && item.version !== "local" && (
                      <button
                        className="button"
                        disabled={busy === item.id}
                        onClick={() => void update(item)}
                      >
                        <RefreshCw size={14} />
                        Update
                      </button>
                    )}
                    <button
                      className="button danger"
                      disabled={busy === item.id}
                      onClick={() => setRemovingInstallation(item)}
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="installed-actions">
                    {!item.identityKnown && (
                      <button
                        className="button"
                        onClick={() => {
                          setNamingInstallation(item);
                          setDiscoveredName(
                            discoveredSkillNames[item.targetPath] ?? "",
                          );
                        }}
                      >
                        Name skill
                      </button>
                    )}
                    {canDeleteDiscovery && (
                      <button
                        className="button danger"
                        onClick={() => {
                          setDiscoveryDeleteError("");
                          setDeletingDiscovery(item);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete files
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {!installed.length && (
            <div className="panel">
              <h3>No installed skills found</h3>
              <p className="muted">
                Install a catalog skill or add a project containing
                `.opencode/skills`.
              </p>
            </div>
          )}
        </section>
      )}
      {selected && (
        <Modal
          title={selected.name}
          onClose={() => !busy && setSelected(null)}
          wide
        >
          <div className="catalog-detail compact-detail">
            <div className="catalog-detail-meta">
              <code>{selected.source}</code>
              <span>{formatInstallCount(selected.installs)} installs</span>
            </div>
            <div className="full-summary">
              {selectedDetail?.description ||
                "Loading full summary from skills.sh..."}
            </div>
            <div className="install-options">
              <label>
                Target assistant
                <select
                  value={agent}
                  disabled={Boolean(busy)}
                  onChange={(event) => setAgent(event.target.value)}
                >
                  <option value="universal">Default / General</option>
                  <option value="opencode">OpenCode</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex</option>
                  <option value="github-copilot">GitHub Copilot</option>
                  <option value="antigravity">Antigravity / Gemini CLI</option>
                  <option value="cursor">Cursor</option>
                </select>
                <small>
                  Default uses the shared .agents/skills directory for other
                  compatible CLIs.
                </small>
              </label>
              <label>
                Install scope
                <select
                  value={scope}
                  disabled={Boolean(busy)}
                  onChange={(event) =>
                    setScope(event.target.value as "project" | "global")
                  }
                >
                  <option value="global">Global</option>
                  <option value="project">Project</option>
                </select>
              </label>
              {scope === "project" && (
                <label className="span2">
                  Project path{" "}
                  <small>
                    Select a saved project, type any path, or browse for a
                    folder.
                  </small>
                  <select
                    disabled={Boolean(busy)}
                    value={
                      projects.some((project) => project.path === projectPath)
                        ? projectPath
                        : ""
                    }
                    onChange={(event) => setProjectPath(event.target.value)}
                  >
                    <option value="">Custom path</option>
                    {projects.map((project) => (
                      <option value={project.path} key={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <div className="install-path-picker">
                    <input
                      disabled={Boolean(busy)}
                      value={projectPath}
                      onChange={(event) => setProjectPath(event.target.value)}
                      placeholder="C:\path\to\project"
                    />
                    <button
                      className="button"
                      disabled={Boolean(busy)}
                      onClick={() => void chooseInstallPath()}
                    >
                      Browse...
                    </button>
                  </div>
                </label>
              )}
            </div>
            {operation && (
              <div className="operation-bar modal-operation">
                <RefreshCw className="spin" size={15} />
                <span>{operation}</span>
                <i>
                  <b />
                </i>
              </div>
            )}
            {installNotice && (
              <DismissibleMessage onDismiss={() => setInstallNotice("")}>
                {installNotice}
              </DismissibleMessage>
            )}
          </div>
          <div className="modal-actions">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => setSelected(null)}
            >
              {installNotice ? "Close" : "Cancel"}
            </button>
            <button
              className="button primary"
              disabled={
                !selectedDetail ||
                Boolean(busy) ||
                (scope === "project" && !projectPath.trim())
              }
              onClick={() => void install()}
            >
              <Download size={14} />
              {busy ? "Installing..." : `Install for ${agent}`}
            </button>
          </div>
        </Modal>
      )}
      {removingInstallation && (
        <Modal
          title={`Remove ${removingInstallation.name}?`}
          onClose={() => !busy && setRemovingInstallation(null)}
          wide
        >
          <p>
            Choose whether Skill Studio should forget only its managed record or
            also delete the installed skill files.
          </p>
          <div className="remove-install-options">
            <button
              className="remove-install-option"
              disabled={Boolean(busy)}
              onClick={() => void remove(removingInstallation, false)}
            >
              <span className="skill-icon mini">
                <XCircle size={15} />
              </span>
              <span>
                <b>Remove from Skill Studio only</b>
                <small>
                  Forget the exact managed record and keep every installed file.
                  Project scans may show it later as externally managed.
                </small>
                <code>{removingInstallation.targetPath}</code>
              </span>
            </button>
            {removingInstallation.available && (
              <button
                className="remove-install-option danger"
                disabled={Boolean(busy)}
                onClick={() => void remove(removingInstallation, true)}
              >
                <span className="skill-icon mini">
                  <Trash2 size={15} />
                </span>
                <span>
                  <b>Delete installed files and remove</b>
                  <small>
                    Permanently remove this exact managed installation from disk
                    and delete its Skill Studio record.
                  </small>
                  <code>{removingInstallation.targetPath}</code>
                </span>
              </button>
            )}
          </div>
          {!removingInstallation.available && (
            <DismissibleMessage role="alert">
              The installed directory is already missing, so only the stale
              Skill Studio record can be removed.
            </DismissibleMessage>
          )}
          {operation && (
            <div className="operation-bar modal-operation">
              <RefreshCw className="spin" size={15} />
              <span>{operation}</span>
              <i>
                <b />
              </i>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => setRemovingInstallation(null)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {namingInstallation && (
        <Modal
          title="Name discovered skill"
          onClose={() => setNamingInstallation(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!discoveredName.trim()) return;
              setDiscoveredSkillName(
                namingInstallation.targetPath,
                discoveredName,
              );
              setNamingInstallation(null);
              setMessage("Discovered skill name saved.");
            }}
          >
            <p className="muted">
              This label is stored in Skill Studio and does not modify the skill
              files.
            </p>
            <label>
              Display name
              <input
                value={discoveredName}
                maxLength={128}
                autoFocus
                onChange={(event) => setDiscoveredName(event.target.value)}
              />
            </label>
            <code>{namingInstallation.targetPath}</code>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setNamingInstallation(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={!discoveredName.trim()}
              >
                Save name
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deletingDiscovery && (
        <Modal
          title={`Delete ${deletingDiscovery.name}?`}
          onClose={() => !busy && setDeletingDiscovery(null)}
        >
          <p>
            Permanently delete this externally managed skill directory? This
            cannot be undone.
          </p>
          <code className="modal-path">{deletingDiscovery.targetPath}</code>
          {discoveryDeleteError && (
            <DismissibleMessage
              role="alert"
              onDismiss={() => setDiscoveryDeleteError("")}
            >
              {discoveryDeleteError}
            </DismissibleMessage>
          )}
          {operation && (
            <div className="operation-bar modal-operation" role="status">
              <RefreshCw className="spin" size={15} />
              <span>{operation}</span>
              <i>
                <b />
              </i>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => setDeletingDiscovery(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={Boolean(busy)}
              onClick={() => void removeDiscovered()}
            >
              {busy ? "Deleting..." : "Delete skill files"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function ManagerLegacy() {
  const skills = useStudio((state) => state.skills);
  const [rows, setRows] = useState<ManagedSkill[]>([]);
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [skill, setSkill] = useState("");
  const [scope, setScope] = useState("Project");
  const [path, setPath] = useState("");
  const [managerError, setManagerError] = useState("");
  const mapInstalled = (row: InstalledSkill): ManagedSkill => ({
    id: row.id,
    name: row.name,
    version: row.version,
    platform: row.platform,
    scope: row.scope === "global" ? "Global" : "Project",
    path: row.targetPath,
    status: "Active",
  });
  const refresh = async () => {
    if (!isTauri()) return;
    try {
      setRows((await listInstalledSkills()).map(mapInstalled));
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const install = async () => {
    setManagerError("");
    try {
      const selected = skills.find((item) => item.id === skill);
      if (!selected) throw new Error("Select a local skill.");
      const slug = validateSlug(selected.id);
      if (!isTauri())
        throw new Error(
          "Filesystem installation requires the Tauri desktop app.",
        );
      const row = await installSkill(
        slug,
        path,
        scope.toLowerCase() as "project" | "global",
        selected.content || `# ${selected.name}\n\n${selected.description}\n`,
      );
      setRows((v) => [...v, mapInstalled(row)]);
      setSuccess(true);
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : String(error));
    }
  };
  const remove = async (row: ManagedSkill) => {
    try {
      if (!isTauri())
        throw new Error("Uninstall requires the Tauri desktop app.");
      await uninstallSkill(row.id, row.path);
      await refresh();
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="page">
      <Header
        eyebrow="OPENCode / INSTALLATIONS"
        title="Skill manager"
        description="Manage skills installed into OpenCode projects and global scope."
        actions={
          <button
            className="button primary"
            onClick={() => {
              setSuccess(false);
              setOpen(true);
            }}
          >
            <PackagePlus size={15} />
            Install skill
          </button>
        }
      />
      <div className="manager-summary">
        <Stat label="Installed skills" value={String(rows.length)} />
        <Stat label="Updates available" value="0" />
        <Stat
          label="Global skills"
          value={String(rows.filter((x) => x.scope === "Global").length)}
          delta="Available to all projects"
        />
      </div>
      <div className="table-toolbar">
        <div className="manager-search compact">
          <Search size={15} />
          <input placeholder="Filter installed skills..." />
        </div>
        <button className="button" onClick={() => void refresh()}>
          <RefreshCw size={14} />
          Rescan
        </button>
      </div>
      <div className="data-table">
        <div className="installed-row table-head">
          <span>SKILL</span>
          <span>VERSION</span>
          <span>PLATFORM</span>
          <span>SCOPE</span>
          <span>INSTALL PATH</span>
          <span>STATUS</span>
          <span>ACTIONS</span>
        </div>
        {rows.map((r) => (
          <div className="installed-row" key={r.id + r.path}>
            <span>
              <span className="skill-icon mini">
                {r.name.slice(0, 2).toUpperCase()}
              </span>
              <b>{r.name}</b>
            </span>
            <span>v{r.version}</span>
            <span>{r.platform}</span>
            <span>{r.scope}</span>
            <code title={r.path}>{r.path}</code>
            <Status value={r.status} />
            <span>
              <button className="icon-btn" title="Open folder">
                <ExternalLink size={14} />
              </button>
              <button
                className="icon-btn"
                title="Uninstall"
                onClick={() => void remove(r)}
              >
                <Trash2 size={14} />
              </button>
              <button className="icon-btn">
                <MoreHorizontal size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
      {open && (
        <Modal title="Install skill to OpenCode" onClose={() => setOpen(false)}>
          {success ? (
            <div className="success-modal">
              <span>
                <Check size={30} />
              </span>
              <h3>Skill installed successfully</h3>
              <p>
                {skill} is available at <code>{path}\.opencode\skills</code>.
              </p>
              <div className="modal-actions">
                <button
                  className="button primary"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="form-stack">
                <label>
                  Skill
                  <select
                    value={skill}
                    onChange={(e) => setSkill(e.target.value)}
                  >
                    <option value="">Select a skill</option>
                    {skills.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Platform
                  <select>
                    <option>OpenCode</option>
                  </select>
                </label>
                <label>
                  Install scope
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    <option>Project</option>
                    <option>Global</option>
                  </select>
                </label>
                <label>
                  Project path
                  <div className="input-action">
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                    />
                    <button className="button">Browse</button>
                  </div>
                </label>
                <div className="install-preview">
                  <span>INSTALL TARGET</span>
                  <code>
                    {scope === "Global"
                      ? "~\\.config\\opencode\\skills"
                      : `${path}\\.opencode\\skills`}
                  </code>
                </div>
              </div>
              <div className="modal-actions">
                <button className="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                {managerError && (
                  <DismissibleMessage
                    role="alert"
                    onDismiss={() => setManagerError("")}
                  >
                    {managerError}
                  </DismissibleMessage>
                )}
                <button
                  className="button primary"
                  disabled={!skill || (scope === "Project" && !path)}
                  onClick={() => void install()}
                >
                  <Download size={14} />
                  Install
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

export function Versions() {
  return (
    <div className="page">
      <Header
        eyebrow="SUPPORT TRIAGE / HISTORY"
        title="Versions"
        description="Review releases, restore a snapshot, or compare changes."
        actions={
          <button className="button primary">
            <Plus size={15} />
            Create version
          </button>
        }
      />
      <div className="version-layout">
        <section className="timeline-list">
          {[
            [
              "2.4.1",
              "Current",
              "Improved urgent account routing",
              "Eymen Y.",
              "Today, 10:14",
            ],
            [
              "2.4.0",
              "Production",
              "Added identity support route",
              "Maya Chen",
              "Jul 10, 16:30",
            ],
            [
              "2.3.2",
              "",
              "Tune confidence threshold",
              "Eymen Y.",
              "Jul 8, 09:12",
            ],
            [
              "2.3.1",
              "",
              "Fix schema validation on empty context",
              "Alex Morgan",
              "Jul 3, 14:45",
            ],
          ].map((v, i) => (
            <article className="version-row" key={v[0]}>
              <div className="version-dot">
                {i === 0 ? <Check size={13} /> : <Circle size={10} />}
              </div>
              <div>
                <div className="version-title">
                  <h3>v{v[0]}</h3>
                  {v[1] && <Status value={v[1]} />}
                </div>
                <p>{v[2]}</p>
                <small>
                  {v[3]} · {v[4]}
                </small>
              </div>
              <div className="version-actions">
                <button className="button">
                  <GitCompare size={14} />
                  Compare
                </button>
                <button className="icon-btn">
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </article>
          ))}
        </section>
        <aside className="panel release-info">
          <span className="eyebrow">SELECTED VERSION</span>
          <h2>v2.4.1</h2>
          <p>Improved urgent account routing</p>
          <div className="commit">
            <code>9f2a1c7</code>
            <Copy size={14} />
          </div>
          <hr />
          <h4>Changes</h4>
          <ul>
            <li>Added explicit account lockout rule</li>
            <li>Reduced temperature to 0.2</li>
            <li>Updated identity route examples</li>
          </ul>
          <button className="button full">
            <RotateCcw size={14} />
            Restore this version
          </button>
        </aside>
      </div>
    </div>
  );
}

export function Publish() {
  const [published, setPublished] = useState(false);
  return (
    <div className="page narrow">
      <Header
        eyebrow="DISTRIBUTION"
        title="Publish Support Triage"
        description="Package a stable version and choose where it can run."
      />
      <section className="publish-step">
        <span className="step-number">1</span>
        <div>
          <h3>Release details</h3>
          <p>Describe what changed in this release.</p>
          <div className="form-grid">
            <label>
              Version
              <input defaultValue="2.5.0" />
            </label>
            <label>
              Release type
              <select>
                <option>Minor release</option>
                <option>Patch release</option>
              </select>
            </label>
            <label className="span2">
              Release notes
              <textarea
                rows={4}
                defaultValue="Improve escalation accuracy and add regional support routing."
              />
            </label>
          </div>
        </div>
      </section>
      <section className="publish-step">
        <span className="step-number">2</span>
        <div>
          <h3>Visibility</h3>
          <p>Control who can discover and use this skill.</p>
          <div className="radio-cards">
            <label>
              <input type="radio" name="visibility" defaultChecked />
              <span>
                <b>Workspace</b>
                <small>Everyone at Acme Labs</small>
              </span>
            </label>
            <label>
              <input type="radio" name="visibility" />
              <span>
                <b>Private</b>
                <small>Only you and collaborators</small>
              </span>
            </label>
            <label>
              <input type="radio" name="visibility" />
              <span>
                <b>Public registry</b>
                <small>Available to all users</small>
              </span>
            </label>
          </div>
        </div>
      </section>
      <section className="publish-step">
        <span className="step-number">3</span>
        <div>
          <h3>Preflight checks</h3>
          {[
            "Manifest is valid",
            "All 6 tests completed",
            "No unresolved secrets",
            "Version number is available",
          ].map((x) => (
            <div className="preflight" key={x}>
              <CheckCircle2 size={17} />
              {x}
              <span>Passed</span>
            </div>
          ))}
        </div>
      </section>
      <div className="publish-bar">
        <div>
          <ShieldCheck size={19} />
          <span>
            <b>Ready to publish</b>
            <small>This release passed all quality checks.</small>
          </span>
        </div>
        <button className="button primary" onClick={() => setPublished(true)}>
          <CloudUpload size={16} />
          Publish v2.5.0
        </button>
      </div>
      {published && (
        <Modal title="Release published" onClose={() => setPublished(false)}>
          <div className="success-modal">
            <span>
              <Check size={30} />
            </span>
            <h3>Support Triage v2.5.0 is live</h3>
            <p>Workspace users can now use this version in their projects.</p>
          </div>
          <div className="modal-actions">
            <button className="button" onClick={() => setPublished(false)}>
              Close
            </button>
            <button className="button primary">
              View release <ExternalLink size={14} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const settingTabs = ["General", "Appearance", "Models", "Storage"];
export function Settings() {
  const [tab, setTab] = useState("Models");
  const {
    providers,
    activeProviderId,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProvider,
    theme,
    toggleTheme,
    runs,
    clearRuns,
  } = useStudio();
  const [selectedProviderId, setSelectedProviderId] =
    useState(activeProviderId);
  const selectedProfile =
    providers.find((item) => item.id === selectedProviderId) ?? providers[0];
  const [providerMessage, setProviderMessage] = useState("");
  const [providerMessageIsError, setProviderMessageIsError] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    setAvailableModels([]);
    if (
      !selectedProfile ||
      !isGeminiBaseUrl(selectedProfile.baseUrl) ||
      !selectedProfile.apiKey?.trim()
    ) {
      return;
    }
    const profile = selectedProfile;
    let cancelled = false;
    setProviderMessage("Loading models available to this Gemini API key...");
    setProviderMessageIsError(false);
    const timer = window.setTimeout(() => {
      void aiProvider
        .listModels(profile, profile.apiKey)
        .then((models) => {
          if (cancelled) return;
          setAvailableModels(models);
          const defaultModel = chooseGeminiDefaultModel(models);
          if (defaultModel) updateProvider(profile.id, { model: defaultModel });
          setProviderMessage(
            `${models.length} Gemini models loaded${defaultModel ? `. Default: ${defaultModel}.` : "."}`,
          );
        })
        .catch((error) => {
          if (cancelled) return;
          setProviderMessageIsError(true);
          setProviderMessage(
            error instanceof Error ? error.message : String(error),
          );
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    selectedProfile?.id,
    selectedProfile?.baseUrl,
    selectedProfile?.apiKey,
    updateProvider,
  ]);
  const testProvider = async () => {
    if (!selectedProfile) return;
    setProviderMessage("Testing...");
    setProviderMessageIsError(false);
    try {
      const models = await aiProvider.listModels(
        selectedProfile,
        selectedProfile.apiKey,
      );
      setAvailableModels(models);
      setProviderMessage(`Connected. ${models.length} models listed.`);
    } catch (error) {
      setProviderMessageIsError(true);
      setProviderMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const openGeminiKeyPage = async () => {
    const url = "https://aistudio.google.com/app/apikey";
    try {
      if (isTauri()) await openExternalUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setProviderMessageIsError(true);
      setProviderMessage(
        `Could not open Google AI Studio: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const addPreset = (
    name: string,
    baseUrl: string,
    model: string,
    kind: "ollama" | "openai-compatible" = "openai-compatible",
  ) => {
    const id = crypto.randomUUID();
    addProvider({
      id,
      name,
      kind,
      baseUrl,
      model,
      timeoutMs: 60000,
      assistantInstructions:
        "Help write clear, safe and reusable agent skills.",
    });
    setSelectedProviderId(id);
  };
  const toggle = (title: string, description: string, on = true) => (
    <label className="setting-toggle">
      <span>
        <b>{title}</b>
        <small>{description}</small>
      </span>
      <input type="checkbox" defaultChecked={on} />
    </label>
  );
  return (
    <div className="page">
      <Header
        eyebrow="WORKSPACE"
        title="Settings"
        description="Manage workspace, platform, security, and developer preferences."
      />
      <div className="settings-layout">
        <aside>
          {settingTabs.map((x) => (
            <button
              className={tab === x ? "active" : ""}
              onClick={() => setTab(x)}
              key={x}
            >
              {x}
            </button>
          ))}
        </aside>
        <section className="settings-content">
          <h2>{tab}</h2>
          <p className="muted">
            Configure local {tab.toLowerCase()} preferences.
          </p>
          {tab === "General" && (
            <div className="settings-section">
              <h3>Workspace profile</h3>
              <div className="form-grid">
                <label>
                  Workspace name
                  <input value="Local workspace" readOnly />
                </label>
                <label>
                  Default project folder
                  <input value="Selected per project or skill" readOnly />
                </label>
                <label>
                  Telemetry
                  <select>
                    <option>Disabled</option>
                  </select>
                </label>
                <label>
                  Update channel
                  <select>
                    <option>Stable</option>
                    <option>Preview</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          {tab === "Appearance" && (
            <div className="settings-section">
              <h3>Interface</h3>
              <div className="form-grid">
                <label>
                  Color theme
                  <select
                    value={theme}
                    onChange={(e) => {
                      if (e.target.value !== theme) toggleTheme();
                    }}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <label>
                  Editor font size
                  <input type="number" defaultValue="13" />
                </label>
              </div>
              <div className="appearance-toggles">
                {toggle(
                  "Dense interface",
                  "Show more information on each screen.",
                )}
                {toggle(
                  "Reduce motion",
                  "Limit non-essential interface animation.",
                  false,
                )}
                {toggle(
                  "Show editor minimap",
                  "Display a document overview in Monaco.",
                  false,
                )}
              </div>
            </div>
          )}
          {tab === "Models" && (
            <div className="settings-section">
              <div className="panel-title">
                <h3>Model connections</h3>
                <span className="muted">
                  Multiple providers can be saved locally.
                </span>
              </div>
              <div className="provider-presets">
                <button
                  className="button"
                  onClick={() =>
                    addPreset(
                      "OpenRouter",
                      "https://openrouter.ai/api/v1",
                      "openrouter/free",
                    )
                  }
                >
                  + OpenRouter
                </button>
                <button
                  className="button"
                  onClick={() =>
                    addPreset(
                      "OpenAI",
                      "https://api.openai.com/v1",
                      "gpt-4.1-mini",
                    )
                  }
                >
                  + OpenAI
                </button>
                <button
                  className="button"
                  onClick={() =>
                    addPreset(
                      "Anthropic via compatible gateway",
                      "https://openrouter.ai/api/v1",
                      "anthropic/claude-sonnet-4",
                    )
                  }
                >
                  + Claude
                </button>
                <button
                  className="button"
                  onClick={() =>
                    addPreset(
                      "Google Gemini",
                      "https://generativelanguage.googleapis.com/v1beta/openai",
                      GEMINI_DEFAULT_MODEL,
                    )
                  }
                >
                  + Gemini
                </button>
                <button
                  className="button"
                  onClick={() =>
                    addPreset(
                      "Groq",
                      "https://api.groq.com/openai/v1",
                      "llama-3.3-70b-versatile",
                    )
                  }
                >
                  + Groq
                </button>
                <button
                  className="button"
                  onClick={() =>
                    addPreset(
                      "Local Ollama",
                      "http://127.0.0.1:11434",
                      "llama3.2:3b",
                      "ollama",
                    )
                  }
                >
                  + Ollama
                </button>
              </div>
              <div className="gemini-notice">
                <Sparkles size={18} />
                <div>
                  <b>Gemini includes a free API tier</b>
                  <p>
                    Add the Gemini preset and paste a Google AI Studio key.
                    Skill Studio will load every chat-capable model available
                    to that key and prefer the free {GEMINI_DEFAULT_MODEL}
                    model.
                  </p>
                  <button
                    className="text-btn"
                    onClick={() => void openGeminiKeyPage()}
                  >
                    Get a free Gemini API key <ExternalLink size={12} />
                  </button>
                </div>
              </div>
              <div className="provider-editor-layout">
                <div className="provider-list">
                  {providers.map((item) => (
                    <button
                      className={
                        selectedProfile?.id === item.id ? "active" : ""
                      }
                      onClick={() => setSelectedProviderId(item.id)}
                      key={item.id}
                    >
                      <span>
                        <b>{item.name}</b>
                        <small>{item.model}</small>
                      </span>
                      {activeProviderId === item.id && (
                        <Status value="Active" />
                      )}
                    </button>
                  ))}
                </div>
                {selectedProfile && (
                  <div className="form-grid">
                    <label>
                      Connection name
                      <input
                        value={selectedProfile.name}
                        onChange={(e) =>
                          updateProvider(selectedProfile.id, {
                            name: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Type
                      <select
                        value={selectedProfile.kind}
                        onChange={(e) =>
                          updateProvider(selectedProfile.id, {
                            kind: e.target.value as typeof selectedProfile.kind,
                          })
                        }
                      >
                        <option value="ollama">Ollama</option>
                        <option value="openai-compatible">
                          OpenAI-compatible
                        </option>
                      </select>
                    </label>
                    <label className="span2">
                      Base URL
                      <input
                        value={selectedProfile.baseUrl}
                        onChange={(e) =>
                          updateProvider(selectedProfile.id, {
                            baseUrl: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Model
                      {availableModels.length ? (
                        <select
                          value={selectedProfile.model}
                          onChange={(e) =>
                            updateProvider(selectedProfile.id, {
                              model: e.target.value,
                            })
                          }
                        >
                          {!availableModels.some(
                            (model) => model.id === selectedProfile.model,
                          ) && (
                            <option value={selectedProfile.model}>
                              {selectedProfile.model}
                            </option>
                          )}
                          {availableModels.map((model) => (
                            <option value={model.id} key={model.id}>
                              {model.name === model.id
                                ? model.id
                                : `${model.name} (${model.id})`}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={selectedProfile.model}
                          onChange={(e) =>
                            updateProvider(selectedProfile.id, {
                              model: e.target.value,
                            })
                          }
                        />
                      )}
                    </label>
                    <label>
                      Timeout
                      <input
                        type="number"
                        value={selectedProfile.timeoutMs}
                        onChange={(e) =>
                          updateProvider(selectedProfile.id, {
                            timeoutMs: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="span2">
                      API key
                      <input
                        type="password"
                        value={selectedProfile.apiKey ?? ""}
                        onChange={(e) =>
                          updateProvider(selectedProfile.id, {
                            apiKey: e.target.value,
                          })
                        }
                      />
                      <small>
                        Stored in the local AppData state file. Use an OS
                        keychain for production secrets.
                      </small>
                    </label>
                    <label className="span2">
                      Skill assistant instructions
                      <textarea
                        rows={3}
                        value={selectedProfile.assistantInstructions ?? ""}
                        onChange={(e) =>
                          updateProvider(selectedProfile.id, {
                            assistantInstructions: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
              <div className="settings-buttons">
                <button
                  className="button primary"
                  disabled={!selectedProfile}
                  onClick={() =>
                    selectedProfile && setActiveProvider(selectedProfile.id)
                  }
                >
                  Use as default
                </button>
                <button className="button" onClick={() => void testProvider()}>
                  <Zap size={14} />
                  Test connection & list models
                </button>
                <button
                  className="button danger"
                  disabled={providers.length <= 1 || !selectedProfile}
                  onClick={() =>
                    selectedProfile && removeProvider(selectedProfile.id)
                  }
                >
                  Remove
                </button>
              </div>
              {providerMessage &&
                (providerMessageIsError ? (
                  <ProviderErrorMessage
                    error={providerMessage}
                    provider={selectedProfile?.kind}
                    onDismiss={() => setProviderMessage("")}
                  />
                ) : (
                  <p className="muted">{providerMessage}</p>
                ))}
            </div>
          )}
          {tab === "Platforms" && (
            <div className="settings-section">
              <h3>Skill targets</h3>
              <div className="provider">
                <span className="package-icon">
                  <Terminal size={18} />
                </span>
                <div>
                  <b>OpenCode</b>
                  <small>Detected · C:\Users\eymen\.config\opencode</small>
                </div>
                <Status value="Connected" />
              </div>
              <div className="provider">
                <span className="package-icon">
                  <Box size={18} />
                </span>
                <div>
                  <b>Generic filesystem</b>
                  <small>Portable SKILL.md packages</small>
                </div>
                <Status value="Active" />
              </div>
              {toggle(
                "Detect projects automatically",
                "Scan recently opened folders for OpenCode configuration.",
              )}
            </div>
          )}
          {tab === "GitHub" && (
            <div className="settings-section">
              <h3>GitHub integration</h3>
              <div className="provider">
                <span className="package-icon">
                  <GitBranch size={18} />
                </span>
                <div>
                  <b>eymen-acme</b>
                  <small>Connected · repo and workflow scopes</small>
                </div>
                <button className="button">Disconnect</button>
              </div>
              {toggle(
                "Create commits when publishing",
                "Commit generated skill files and release metadata.",
              )}
              {toggle(
                "Open pull requests",
                "Publish changes through a review branch.",
                false,
              )}
            </div>
          )}
          {tab === "Sandbox" && (
            <div className="settings-section">
              <h3>Execution sandbox</h3>
              <div className="form-grid">
                <label>
                  Isolation mode
                  <select>
                    <option>Restricted process</option>
                    <option>Container</option>
                  </select>
                </label>
                <label>
                  Default timeout
                  <input defaultValue="30 seconds" />
                </label>
              </div>
              {toggle(
                "Network disabled by default",
                "Require explicit network permission per skill.",
              )}
              {toggle(
                "Clean environment after runs",
                "Delete temporary execution files.",
              )}
            </div>
          )}
          {tab === "Security" && (
            <div className="settings-section">
              <h3>Security policy</h3>
              {toggle(
                "Confirm shell commands",
                "Require approval before command execution.",
              )}
              {toggle(
                "Block secrets in output",
                "Scan results for credentials and tokens.",
              )}
              {toggle(
                "Verify package signatures",
                "Reject unsigned registry packages.",
              )}
              {toggle(
                "Allow high-risk permissions",
                "Skills may request shell and network access.",
                false,
              )}
            </div>
          )}
          {tab === "Storage" && (
            <div className="settings-section">
              <h3>Local data</h3>
              <div className="detail-grid">
                <div>
                  <span>DATABASE</span>
                  <b>Browser local storage</b>
                </div>
                <div>
                  <span>USED SPACE</span>
                  <b>{runs.length} run records</b>
                </div>
                <div>
                  <span>RUN RETENTION</span>
                  <b>Last 100 runs</b>
                </div>
                <div>
                  <span>BACKUPS</span>
                  <b>Not configured</b>
                </div>
              </div>
              <div className="settings-buttons">
                <button
                  className="button danger"
                  disabled={!runs.length}
                  onClick={clearRuns}
                >
                  <Trash2 size={14} />
                  Clear run history
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
