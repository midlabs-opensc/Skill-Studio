import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Blocks,
  BookOpen,
  CloudUpload,
  Code2,
  FlaskConical,
  FolderKanban,
  Home,
  Moon,
  Plus,
  Settings,
  Sun,
  Terminal,
  TestTube2,
} from "lucide-react";
import { useStudio } from "../store";
import { Modal } from "./Modal";
import { DismissibleMessage } from "./DismissibleMessage";
import {
  createSkillWorkspace,
  discoverSkillWorkspaces,
  readWorkspaceFile,
  selectProjectDirectory,
} from "../lib/tauri";
import { isTauri } from "../services/ai";
import logoUrl from "../../ss.png";

const nav = [
  ["/", "Dashboard", Home],
  ["/projects", "Projects", FolderKanban],
  ["/skills", "Skills", Code2],
  ["/playground", "Playground", FlaskConical],
  ["/tests", "Tests", TestTube2],
  ["/manager", "Skill Manager", Blocks],
  ["/docs", "Documentation", BookOpen],
  ["/deploy", "Deploy", CloudUpload],
  ["/clis", "CLIs", Terminal],
  ["/settings", "Settings", Settings],
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme, addSkill, skills, tests } = useStudio();
  const [wizard, setWizard] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [template, setTemplate] = useState("basic");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [shellError, setShellError] = useState("");
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [existingSkills, setExistingSkills] = useState<
    { id: string; path: string; content: string }[]
  >([]);
  const navigate = useNavigate();
  const location = useLocation();
  const [lastEditorPath, setLastEditorPath] = useState("");

  useEffect(() => {
    if (/^\/skills\/[^/]+\/editor$/.test(location.pathname)) {
      setLastEditorPath(location.pathname);
    }
  }, [location.pathname]);

  const inspectWorkspace = async (root: string) => {
    const found = await discoverSkillWorkspaces(root);
    setExistingSkills(
      found.map((item) => {
        const declared = item.content
          .match(/^name:\s*([^\r\n]+)$/m)?.[1]
          ?.trim();
        const candidate = declared
          ?.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return { ...item, id: candidate || item.id };
      }),
    );
  };

  const chooseWorkspace = async () => {
    if (!isTauri()) return;
    try {
      const root = await selectProjectDirectory();
      if (!root) return;
      setWorkspaceRoot(root);
      setCreateError("");
      await inspectWorkspace(root);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    }
  };

  const finish = async () => {
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || crypto.randomUUID();
    const skillName = name || "Untitled skill";
    const bodies: Record<string, string> = {
      basic: `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${skillName}\n\n## Instructions\n\nDescribe what this skill should do.\n`,
      workflow: `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${skillName}\n\n## Inputs\n\n## Workflow\n\n1. Validate the input.\n2. Perform the task.\n3. Return a structured result.\n\n## Output\n`,
      tool: `---\nname: ${id}\ndescription: ${description}\nallowed-tools: []\n---\n\n# ${skillName}\n\n## Tool policy\n\n## Instructions\n`,
    };
    setCreating(true);
    setCreateError("");
    try {
      if (!workspaceRoot)
        throw new Error("Choose a workspace folder before creating a skill.");
      if (!isTauri())
        throw new Error("Creating workspace files requires the desktop app.");
      if (skills.some((skill) => skill.id === id))
        throw new Error(`A skill with ID "${id}" is already in the library.`);
      const content = bodies[template];
      const workspacePath = await createSkillWorkspace(
        workspaceRoot,
        id,
        content,
      );
      addSkill({
        id,
        name: skillName,
        description,
        icon: skillName.slice(0, 2).toUpperCase(),
        status: "Draft",
        version: "0.1.0",
        updated: new Date().toISOString(),
        runs: 0,
        passRate: 0,
        tags: [],
        content,
        workspacePath,
        template,
      });
      setWizard(false);
      setName("");
      setDescription("");
      setWorkspaceRoot("");
      setExistingSkills([]);
      navigate(`/skills/${id}/editor`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const importExisting = (
    item: { id: string; path: string; content: string },
    onError = setCreateError,
  ) => {
    if (skills.some((skill) => skill.id === item.id)) {
      onError(`A skill with ID "${item.id}" is already in the library.`);
      return;
    }
    if (
      skills.some(
        (skill) =>
          skill.workspacePath?.toLowerCase() === item.path.toLowerCase(),
      )
    ) {
      onError("This workspace is already open in the skill library.");
      return;
    }
    const title = item.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || item.id;
    addSkill({
      id: item.id,
      name: title,
      description: "Imported from an existing workspace.",
      icon: title.slice(0, 2).toUpperCase(),
      status: "Draft",
      version: "0.1.0",
      updated: new Date().toISOString(),
      runs: 0,
      passRate: 0,
      tags: [],
      content: item.content,
      workspacePath: item.path,
    });
    setWizard(false);
    navigate(`/skills/${item.id}/editor`);
  };

  const openExistingWorkspace = async () => {
    if (!isTauri()) return;
    setOpeningWorkspace(true);
    setShellError("");
    try {
      const path = await selectProjectDirectory();
      if (!path) return;
      const content = await readWorkspaceFile(path, "SKILL.md");
      const declared = content.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
      const folderName = path.split(/[\\/]/).filter(Boolean).at(-1) || "skill";
      const id = (declared || folderName)
        .replace(/^['"]|['"]$/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!id)
        throw new Error("The selected workspace has no usable skill ID.");
      importExisting({ id, path, content }, setShellError);
    } catch (error) {
      setShellError(
        `Could not open workspace: ${error instanceof Error ? error.message : String(error)}. Select a folder whose root contains SKILL.md.`,
      );
    } finally {
      setOpeningWorkspace(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={logoUrl} alt="" />
          </div>
          <strong>Skill Studio</strong>
          <span className="beta">BETA</span>
        </div>
        <div className="workspace">
          <span className="avatar small">LS</span>
          <span>
            <b>Local workspace</b>
            <small>Stored on this device</small>
          </span>
        </div>
        <nav>
          {nav.map(([to, label, Icon]) => {
            const destination =
              label === "Skills" && lastEditorPath ? lastEditorPath : to;
            return (
              <NavLink
                key={to}
                to={destination}
                end={to === "/"}
                className={({ isActive }) =>
                  isActive ||
                  (label === "Skills" &&
                    location.pathname.startsWith("/skills")) ||
                  (to === "/playground" &&
                    location.pathname.startsWith("/playground"))
                    ? "active"
                    : ""
                }
              >
                <Icon size={17} />
                <span>{label}</span>
                {label === "Tests" && tests.length > 0 && <i>{tests.length}</i>}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="user local-user">
            <span>
              <b>Local only</b>
              <small>No account connected</small>
            </span>
            <button
              className="icon-btn"
              aria-label="Toggle theme"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div />
          <div className="top-actions">
            <button
              className="button open-workspace-button"
              disabled={openingWorkspace || !isTauri()}
              title={
                isTauri()
                  ? "Open a folder whose root contains SKILL.md"
                  : "Opening local workspaces requires the desktop app"
              }
              onClick={() => void openExistingWorkspace()}
            >
              <FolderKanban size={16} />
              {openingWorkspace ? "Opening..." : "Open workspace"}
            </button>
            <button className="button primary" onClick={() => setWizard(true)}>
              <Plus size={16} />
              New skill
            </button>
          </div>
        </header>
        {shellError && (
          <DismissibleMessage
            className="shell-message"
            role="alert"
            onDismiss={() => setShellError("")}
          >
            {shellError}
          </DismissibleMessage>
        )}
        {children}
      </main>
      {wizard && (
        <Modal title="Create a new skill" onClose={() => setWizard(false)} wide>
          <div className="form-stack">
            <label>
              Skill name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Incident investigator"
              />
            </label>
            <label>
              Skill ID <small>Generated from the name</small>
              <input
                value={name
                  .toLowerCase()
                  .trim()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")}
                readOnly
                placeholder="incident-investigator"
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What should this skill accomplish?"
              />
            </label>
            <label>
              Starter template
              <select
                value={template}
                onChange={(event) => setTemplate(event.target.value)}
              >
                <option value="basic">Basic instructions</option>
                <option value="workflow">Structured workflow</option>
                <option value="tool">Tool-enabled skill</option>
              </select>
            </label>
            <label>
              Workspace folder{" "}
              <small>
                The skill will be created directly as
                &lt;workspace&gt;/&lt;skill-id&gt;/SKILL.md.
              </small>
            </label>
            <div className="folder-picker">
              <FolderKanban size={22} />
              <div>
                <b>Workspace</b>
                <span>{workspaceRoot || "No folder selected"}</span>
              </div>
              <button className="button" onClick={() => void chooseWorkspace()}>
                Browse...
              </button>
            </div>
            {existingSkills.length > 0 && (
              <div className="existing-skills">
                <b>Existing skills in this workspace</b>
                {existingSkills.map((item) => (
                  <div key={item.path}>
                    <code>{item.id}</code>
                    <button
                      className="button"
                      onClick={() => importExisting(item)}
                    >
                      Import
                    </button>
                  </div>
                ))}
              </div>
            )}
            {createError && (
              <DismissibleMessage
                role="alert"
                onDismiss={() => setCreateError("")}
              >
                {createError}
              </DismissibleMessage>
            )}
          </div>
          <div className="modal-actions">
            <button className="button" onClick={() => setWizard(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={creating || !workspaceRoot || !name.trim()}
              onClick={() => void finish()}
            >
              {creating ? "Creating..." : "Create skill"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
