use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env,
    ffi::{OsStr, OsString},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const MAX_RESPONSE_SIZE: usize = 4 * 1024 * 1024;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x00000400;

type Result<T> = std::result::Result<T, String>;

fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.stdin(Stdio::null());
    command
}

fn process_path(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

#[derive(Clone, Copy)]
enum EmbeddedTool {
    Skills,
    Git,
    Gh,
}

impl EmbeddedTool {
    fn label(self) -> &'static str {
        match self {
            Self::Skills => "skills CLI",
            Self::Git => "Git",
            Self::Gh => "GitHub CLI",
        }
    }
}

struct ResolvedTool {
    program: PathBuf,
    prefix_arguments: Vec<OsString>,
    path_entries: Vec<PathBuf>,
    label: &'static str,
}

fn bundled_tool(root: &Path, tool: EmbeddedTool) -> Result<Option<ResolvedTool>> {
    if !root.exists() {
        return Ok(None);
    }
    let node = root.join("node/node.exe");
    let skills = root.join("skills/package/bin/cli.mjs");
    let skills_dist = root.join("skills/package/dist/cli.mjs");
    let skills_manifest = root.join("skills/package/package.json");
    let git = root.join("git/cmd/git.exe");
    let git_bin = root.join("git/mingw64/bin");
    let gh = root.join("gh/bin/gh.exe");
    let resolved = match tool {
        EmbeddedTool::Skills
            if node.is_file()
                && skills.is_file()
                && skills_dist.is_file()
                && skills_manifest.is_file()
                && git.is_file() =>
        {
            ResolvedTool {
                program: process_path(&node),
                prefix_arguments: vec![process_path(&skills).into_os_string()],
                path_entries: vec![
                    process_path(node.parent().unwrap()),
                    process_path(git.parent().unwrap()),
                    process_path(&git_bin),
                ],
                label: "skills CLI",
            }
        }
        EmbeddedTool::Git if git.is_file() => ResolvedTool {
            program: process_path(&git),
            prefix_arguments: Vec::new(),
            path_entries: vec![process_path(git.parent().unwrap()), process_path(&git_bin)],
            label: "Git",
        },
        EmbeddedTool::Gh if gh.is_file() && git.is_file() => ResolvedTool {
            program: process_path(&gh),
            prefix_arguments: Vec::new(),
            path_entries: vec![process_path(git.parent().unwrap()), process_path(&git_bin)],
            label: "GitHub CLI",
        },
        _ => {
            return Err(format!(
                "The bundled {} runtime is incomplete. Reinstall Skill Studio.",
                tool.label()
            ));
        }
    };
    Ok(Some(resolved))
}

fn packaged_tool(resource_dir: &Path, tool: EmbeddedTool) -> Result<ResolvedTool> {
    let root = resource_dir.join("tools/windows-x64");
    bundled_tool(&root, tool)?.ok_or_else(|| {
        format!(
            "The bundled {} runtime is missing. Reinstall Skill Studio.",
            tool.label()
        )
    })
}

fn resolve_tool(app: &AppHandle, tool: EmbeddedTool) -> Result<ResolvedTool> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    match packaged_tool(&resource_dir, tool) {
        Ok(resolved) => return Ok(resolved),
        Err(error) if cfg!(not(debug_assertions)) || cfg!(target_os = "windows") => {
            return Err(error);
        }
        Err(_) => {}
    }
    let (program, label) = match tool {
        EmbeddedTool::Skills => {
            #[cfg(target_os = "windows")]
            let program = "npx.cmd";
            #[cfg(not(target_os = "windows"))]
            let program = "npx";
            (program, "skills CLI")
        }
        EmbeddedTool::Git => ("git", "Git"),
        EmbeddedTool::Gh => ("gh", "GitHub CLI"),
    };
    Ok(ResolvedTool {
        program: PathBuf::from(program),
        prefix_arguments: if matches!(tool, EmbeddedTool::Skills) {
            vec![OsString::from("--yes"), OsString::from("skills")]
        } else {
            Vec::new()
        },
        path_entries: Vec::new(),
        label,
    })
}

fn tool_command(app: &AppHandle, tool: EmbeddedTool) -> Result<(Command, &'static str)> {
    let resolved = resolve_tool(app, tool)?;
    let mut command = background_command(&resolved.program);
    command.args(&resolved.prefix_arguments);
    if !resolved.path_entries.is_empty() {
        let mut paths = resolved.path_entries;
        if let Some(existing) = env::var_os("PATH") {
            paths.extend(env::split_paths(&existing));
        }
        command.env("PATH", env::join_paths(paths).map_err(|e| e.to_string())?);
    }
    Ok((command, resolved.label))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledSkill {
    id: String,
    name: String,
    version: String,
    platform: String,
    scope: String,
    target_path: String,
    installed_at: String,
    #[serde(default = "default_true")]
    managed: bool,
    #[serde(default = "default_true")]
    available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path_error: Option<String>,
    #[serde(default = "default_true")]
    identity_known: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeDetection {
    detected: bool,
    config_path: Option<String>,
    skills_path: String,
    skills_count: usize,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    path: String,
    name: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSkill {
    id: String,
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PythonStatus {
    available: bool,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PythonRunResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    duration_ms: u128,
    timed_out: bool,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSkill {
    id: String,
    source: String,
    slug: String,
    name: String,
    installs: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSkillDetail {
    id: String,
    source: String,
    slug: String,
    name: String,
    description: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubAuthStatus {
    installed: bool,
    authenticated: bool,
    username: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubAuthStart {
    code: String,
    verification_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubPublishResult {
    repository_url: String,
    install_command: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployedRepository {
    repository: String,
    repository_url: String,
    skill_id: String,
    workspace_path: String,
    created_at: String,
    published_at: String,
    #[serde(default = "default_true")]
    available: bool,
    #[serde(default)]
    pushed_at: Option<String>,
    #[serde(default)]
    default_branch: Option<String>,
    #[serde(default)]
    visibility: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfig {
    provider: String,
    base_url: String,
    model: String,
    timeout_ms: u64,
    api_key: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatResult {
    content: String,
    model: String,
    duration_ms: u128,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    demo: bool,
}

fn validate_slug(value: &str) -> Result<()> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'));
    valid
        .then_some(())
        .ok_or_else(|| "Invalid skill identifier.".into())
}

fn validate_agent(value: &str) -> Result<()> {
    const AGENTS: &[&str] = &[
        "opencode",
        "claude-code",
        "codex",
        "github-copilot",
        "antigravity",
        "cursor",
        "gemini-cli",
        "universal",
    ];
    AGENTS
        .contains(&value)
        .then_some(())
        .ok_or_else(|| "Unsupported agent.".into())
}

fn validate_catalog_source(value: &str) -> Result<()> {
    let valid = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
        && value
            .split('/')
            .all(|part| !part.is_empty() && !matches!(part, "." | ".."));
    valid
        .then_some(())
        .ok_or_else(|| "Invalid catalog source.".into())
}

fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join(name))
}

fn load_registry(app: &AppHandle) -> Result<Vec<InstalledSkill>> {
    let path = data_file(app, "installations.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn save_registry(app: &AppHandle, rows: &[InstalledSkill]) -> Result<()> {
    let path = data_file(app, "installations.json")?;
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(rows).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

fn load_deployments(app: &AppHandle) -> Result<Vec<DeployedRepository>> {
    let path = data_file(app, "deployments.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn save_deployments(app: &AppHandle, rows: &[DeployedRepository]) -> Result<()> {
    let path = data_file(app, "deployments.json")?;
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(rows).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

fn global_skill_root(agent: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory is unavailable.".to_string())?;
    let path = match agent {
        "opencode" => dirs::config_dir()
            .ok_or_else(|| "Config directory is unavailable.".to_string())?
            .join("opencode/skills"),
        "claude-code" => home.join(".claude/skills"),
        "codex" => home.join(".codex/skills"),
        "github-copilot" => home.join(".copilot/skills"),
        "cursor" => home.join(".cursor/skills"),
        "gemini-cli" => home.join(".gemini/skills"),
        "antigravity" => home.join(".gemini/antigravity/skills"),
        "universal" => home.join(".config/agents/skills"),
        _ => return Err("Unsupported agent.".into()),
    };
    Ok(path)
}

fn project_skill_root(project: &Path, agent: &str) -> Result<PathBuf> {
    let relative = match agent {
        "opencode" => ".opencode/skills",
        "claude-code" => ".claude/skills",
        "codex" => ".codex/skills",
        "github-copilot" => ".github/skills",
        "cursor" => ".cursor/skills",
        "gemini-cli" => ".gemini/skills",
        "antigravity" => ".agent/skills",
        "universal" => ".agents/skills",
        _ => return Err("Unsupported agent.".into()),
    };
    Ok(project.join(relative))
}

fn discovered_skill_identity(path: &Path) -> (String, String, bool) {
    const MAX_IDENTITY_BYTES: u64 = 64 * 1024;
    let mut content = String::new();
    let read = fs::File::open(path)
        .and_then(|file| file.take(MAX_IDENTITY_BYTES).read_to_string(&mut content));
    if read.is_err() {
        return ("unknown".into(), "Unknown skill".into(), false);
    }
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return ("unknown".into(), "Unknown skill".into(), false);
    }
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            let value = value.trim().trim_matches(['\'', '"']);
            if !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control) {
                return (value.to_string(), value.to_string(), true);
            }
        }
    }
    ("unknown".into(), "Unknown skill".into(), false)
}

fn scan_project_skill_files(project: &Path) -> Result<Vec<InstalledSkill>> {
    let mut rows = Vec::new();
    let mut directories = vec![project.to_path_buf()];
    while let Some(directory) = directories.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory != project => {
                log::warn!(
                    "Skipping unreadable project directory {}: {error}",
                    directory.display()
                );
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Could not read project directory ({}): {error}",
                    directory.display()
                ));
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    log::warn!(
                        "Skipping an unreadable entry in {}: {error}",
                        directory.display()
                    );
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    log::warn!(
                        "Skipping unreadable project entry {}: {error}",
                        path.display()
                    );
                    continue;
                }
            };
            if is_link_or_reparse_point(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                if entry.file_name() != ".git" {
                    directories.push(path);
                }
                continue;
            }
            if !metadata.is_file() || entry.file_name() != "SKILL.md" {
                continue;
            }
            let target = path
                .parent()
                .ok_or_else(|| "A discovered SKILL.md has no parent directory.".to_string())?;
            let (id, name, identity_known) = discovered_skill_identity(&path);
            let relative = target.strip_prefix(project).unwrap_or(target);
            let platform = relative
                .components()
                .filter_map(|component| component.as_os_str().to_str())
                .find_map(|component| match component {
                    ".opencode" => Some("opencode"),
                    ".claude" => Some("claude-code"),
                    ".codex" => Some("codex"),
                    ".github" => Some("github-copilot"),
                    ".cursor" => Some("cursor"),
                    ".gemini" => Some("gemini-cli"),
                    ".agent" => Some("antigravity"),
                    ".agents" => Some("universal"),
                    _ => None,
                })
                .unwrap_or("local");
            rows.push(InstalledSkill {
                id,
                name,
                version: "local".into(),
                platform: platform.into(),
                scope: "project".into(),
                target_path: target.to_string_lossy().into_owned(),
                installed_at: Utc::now().to_rfc3339(),
                managed: false,
                available: true,
                path_error: None,
                identity_known,
            });
        }
    }
    rows.sort_by(|a, b| a.target_path.cmp(&b.target_path));
    Ok(rows)
}

fn canonical_path_identity(path: &Path) -> Option<String> {
    let value = fs::canonicalize(path).ok()?.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    return Some(value.to_lowercase());
    #[cfg(not(target_os = "windows"))]
    Some(value)
}

fn skill_exclusion_paths(
    app: &AppHandle,
    authored_workspace_paths: &[String],
) -> Result<HashSet<String>> {
    let mut excluded = HashSet::new();
    for row in load_registry(app)?.into_iter().filter(|row| row.managed) {
        if let Some(path) = canonical_path_identity(Path::new(&row.target_path)) {
            excluded.insert(path);
        }
    }
    for path in authored_workspace_paths {
        if let Some(path) = canonical_path_identity(Path::new(path)) {
            excluded.insert(path);
        }
    }
    Ok(excluded)
}

fn is_excluded_path(path: &str, excluded: &HashSet<String>) -> bool {
    excluded.iter().any(|root| {
        path == root
            || path.strip_prefix(root).map_or(false, |suffix| {
                suffix.starts_with(std::path::MAIN_SEPARATOR)
            })
    })
}

fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return true;
    }
    false
}

fn delete_managed_skill_directory(target_path: &str) -> Result<()> {
    let target = Path::new(target_path);
    let metadata = fs::symlink_metadata(target).map_err(|e| e.to_string())?;
    if is_link_or_reparse_point(&metadata) || !metadata.is_dir() {
        return Err("Managed skill path must be a real directory, not a link.".into());
    }
    let marker = target.join("SKILL.md");
    let marker_metadata = fs::symlink_metadata(&marker)
        .map_err(|_| "Managed skill directory is missing SKILL.md.".to_string())?;
    if is_link_or_reparse_point(&marker_metadata) || !marker_metadata.is_file() {
        return Err("Managed skill SKILL.md must be a real file, not a link.".into());
    }
    fs::remove_dir_all(target).map_err(|e| e.to_string())
}

fn safe_path(root: &str, relative: &str) -> Result<PathBuf> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Path must stay inside the workspace.".into());
    }
    Ok(root.join(relative))
}

fn copy_directory(source: &Path, target: &Path, skip_git: bool) -> Result<()> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if skip_git && entry.file_name() == ".git" {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Symbolic links are not supported: {}",
                entry.path().display()
            ));
        }
        let destination = target.join(entry.file_name());
        if metadata.is_dir() {
            copy_directory(&entry.path(), &destination, skip_git)?;
        } else if metadata.is_file() {
            fs::copy(entry.path(), destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn run_tool(
    app: &AppHandle,
    tool: EmbeddedTool,
    arguments: &[&str],
    directory: Option<&Path>,
) -> Result<String> {
    let (mut command, label) = tool_command(app, tool)?;
    command.args(arguments);
    if let Some(path) = directory {
        command.current_dir(process_path(path));
    }
    let output = command
        .output()
        .map_err(|e| format!("Could not start {label}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("{label} exited unsuccessfully.")
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn python_runtime() -> Option<(String, Vec<String>, String)> {
    let candidates: &[(&str, &[&str])] = if cfg!(target_os = "windows") {
        &[("py", &["-3"]), ("python", &[])]
    } else {
        &[("python3", &[]), ("python", &[])]
    };
    for (program, prefix) in candidates {
        let output = background_command(program)
            .args(*prefix)
            .arg("--version")
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                let version = if output.stdout.is_empty() {
                    String::from_utf8_lossy(&output.stderr).trim().to_string()
                } else {
                    String::from_utf8_lossy(&output.stdout).trim().to_string()
                };
                return Some((
                    (*program).to_string(),
                    prefix.iter().map(|value| (*value).to_string()).collect(),
                    version,
                ));
            }
        }
    }
    None
}

#[tauri::command]
fn python_status() -> PythonStatus {
    let runtime = python_runtime();
    PythonStatus {
        available: runtime.is_some(),
        version: runtime.map(|(_, _, version)| version),
    }
}

fn run_python_file_blocking(
    root: String,
    path: String,
    timeout_ms: u64,
) -> Result<PythonRunResult> {
    const MAX_OUTPUT: u64 = 512 * 1024;
    let root = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    let target = safe_path(root.to_string_lossy().as_ref(), &path)?;
    let target = fs::canonicalize(target).map_err(|e| e.to_string())?;
    if !target.starts_with(&root)
        || !target.is_file()
        || target.extension().and_then(|v| v.to_str()) != Some("py")
    {
        return Err("Only Python files inside the selected skill workspace can run.".into());
    }
    let (program, prefix, _) = python_runtime()
        .ok_or_else(|| "Python 3 is not installed or is unavailable on PATH.".to_string())?;
    let mut command = background_command(&program);
    command
        .args(prefix)
        .args(["-I", "-B"])
        .arg(process_path(&target));
    command
        .current_dir(process_path(&root))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Python: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Python stdout is unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Python stderr is unavailable.".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(MAX_OUTPUT + 1).read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.take(MAX_OUTPUT + 1).read_to_end(&mut bytes);
        bytes
    });
    let timeout = Duration::from_millis(timeout_ms.clamp(500, 30_000));
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            break child.wait().map_err(|e| e.to_string())?;
        }
        thread::sleep(Duration::from_millis(40));
    };
    let mut stdout = stdout_reader.join().unwrap_or_default();
    let mut stderr = stderr_reader.join().unwrap_or_default();
    let truncated = stdout.len() as u64 > MAX_OUTPUT || stderr.len() as u64 > MAX_OUTPUT;
    stdout.truncate(MAX_OUTPUT as usize);
    stderr.truncate(MAX_OUTPUT as usize);
    Ok(PythonRunResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code: status.code(),
        duration_ms: started.elapsed().as_millis(),
        timed_out,
        truncated,
    })
}

#[tauri::command]
async fn run_python_file(root: String, path: String, timeout_ms: u64) -> Result<PythonRunResult> {
    tauri::async_runtime::spawn_blocking(move || run_python_file_blocking(root, path, timeout_ms))
        .await
        .map_err(|e| e.to_string())?
}

fn run_skills_cli(app: &AppHandle, arguments: &[&str], directory: Option<&Path>) -> Result<String> {
    let (mut command, _) = tool_command(app, EmbeddedTool::Skills)?;
    command.args(arguments).env("DISABLE_TELEMETRY", "1");
    if let Some(path) = directory {
        command.current_dir(process_path(path));
    }
    let output = command
        .output()
        .map_err(|e| format!("Could not start skills CLI: {e}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "skills CLI command failed.".into()
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn install_target(project_path: &str, scope: &str, agent: &str, slug: &str) -> Result<PathBuf> {
    let root = if scope == "global" {
        global_skill_root(agent)?
    } else {
        if project_path.is_empty() {
            return Err("A project directory is required for project installs.".into());
        }
        let project = fs::canonicalize(project_path).map_err(|e| e.to_string())?;
        project_skill_root(&project, agent)?
    };
    Ok(root.join(slug))
}

fn update_project_agents(project: &Path, skill_id: &str, target: &Path) -> Result<()> {
    let agents_path = project.join("AGENTS.md");
    if agents_path.exists()
        && fs::symlink_metadata(&agents_path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("AGENTS.md is a symbolic link and was not modified.".into());
    }
    let relative = target
        .strip_prefix(project)
        .map_err(|_| "Installed skill is outside the selected project.".to_string())?
        .join("SKILL.md")
        .to_string_lossy()
        .replace('\\', "/");
    let start = "<!-- skill-studio:skills:start -->";
    let end = "<!-- skill-studio:skills:end -->";
    let entry = format!("- `{skill_id}` is installed at `{relative}`.");
    let existing = if agents_path.exists() {
        fs::read_to_string(&agents_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let markers = existing.find(start).and_then(|from| {
        existing[from + start.len()..]
            .find(end)
            .map(|offset| (from, from + start.len() + offset))
    });
    let block = if let Some((from, to)) = markers {
        let current = &existing[from + start.len()..to];
        let mut lines = current.trim().to_string();
        if !lines.contains(&format!("`{relative}`")) {
            if !lines.is_empty() {
                lines.push('\n');
            }
            lines.push_str(&entry);
        }
        format!("{start}\n{lines}\n{end}")
    } else {
        format!("{start}\n## Installed skills\n\n{entry}\n{end}")
    };
    let next = if let Some((from, to)) = markers {
        format!(
            "{}{}{}",
            &existing[..from],
            block,
            &existing[to + end.len()..]
        )
    } else if existing.trim().is_empty() {
        format!("# Project agent notes\n\n{block}\n")
    } else {
        format!("{}\n\n{block}\n", existing.trim_end())
    };
    fs::write(agents_path, next).map_err(|e| e.to_string())
}

#[tauri::command]
fn select_project_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

fn detect_open_code_blocking(project_path: String) -> Result<OpenCodeDetection> {
    let project = fs::canonicalize(&project_path).map_err(|e| {
        format!("Project directory is missing or inaccessible ({project_path}): {e}")
    })?;
    if !project.is_dir() {
        return Err("Project path is not a directory.".into());
    }
    let json = project.join("opencode.json");
    let jsonc = project.join("opencode.jsonc");
    let dot = project.join(".opencode");
    let config = if json.exists() {
        Some(json)
    } else if jsonc.exists() {
        Some(jsonc)
    } else if dot.exists() {
        Some(dot.clone())
    } else {
        None
    };
    let skills_path = dot.join("skills");
    let skills_count = scan_project_skill_files(&project)?.len();
    Ok(OpenCodeDetection {
        detected: config.is_some(),
        config_path: config.map(|p| p.to_string_lossy().into_owned()),
        skills_path: skills_path.to_string_lossy().into_owned(),
        skills_count,
        version: background_command("opencode")
            .arg("--version")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()),
    })
}

#[tauri::command]
async fn detect_open_code(project_path: String) -> Result<OpenCodeDetection> {
    tauri::async_runtime::spawn_blocking(move || detect_open_code_blocking(project_path))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_project_skills_blocking(
    app: AppHandle,
    project_path: String,
    authored_workspace_paths: Vec<String>,
) -> Result<Vec<InstalledSkill>> {
    let project = fs::canonicalize(&project_path).map_err(|e| {
        format!("Project directory is missing or inaccessible ({project_path}): {e}")
    })?;
    if !project.is_dir() {
        return Err("Project path is not a directory.".into());
    }
    let excluded = skill_exclusion_paths(&app, &authored_workspace_paths)?;
    let mut rows = scan_project_skill_files(&project)?;
    rows.retain(|row| {
        canonical_path_identity(Path::new(&row.target_path))
            .map_or(true, |path| !is_excluded_path(&path, &excluded))
    });
    Ok(rows)
}

#[tauri::command]
async fn scan_project_skills(
    app: AppHandle,
    project_path: String,
    authored_workspace_paths: Vec<String>,
) -> Result<Vec<InstalledSkill>> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_project_skills_blocking(app, project_path, authored_workspace_paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn delete_discovered_skill_blocking(
    app: AppHandle,
    project_path: String,
    target_path: String,
    authored_workspace_paths: Vec<String>,
) -> Result<()> {
    let project = fs::canonicalize(&project_path).map_err(|e| {
        format!("Project directory is missing or inaccessible ({project_path}): {e}")
    })?;
    let supplied_metadata = fs::symlink_metadata(&target_path).map_err(|e| e.to_string())?;
    if is_link_or_reparse_point(&supplied_metadata) || !supplied_metadata.is_dir() {
        return Err("Discovered skill path must be a real directory, not a link.".into());
    }
    let target = fs::canonicalize(&target_path).map_err(|e| e.to_string())?;
    if target == project || !target.starts_with(&project) {
        return Err("Only a discovered skill inside the saved project can be deleted.".into());
    }
    let target_identity = canonical_path_identity(&target)
        .ok_or_else(|| "Could not verify the discovered skill path.".to_string())?;
    let excluded = skill_exclusion_paths(&app, &authored_workspace_paths)?;
    if is_excluded_path(&target_identity, &excluded) {
        return Err("Managed installations and authored workspaces cannot be deleted here.".into());
    }
    let still_discovered = scan_project_skill_files(&project)?.into_iter().any(|row| {
        canonical_path_identity(Path::new(&row.target_path)).as_deref()
            == Some(target_identity.as_str())
    });
    if !still_discovered {
        return Err("The selected directory is no longer a discovered skill.".into());
    }
    delete_managed_skill_directory(&target.to_string_lossy())
}

#[tauri::command]
async fn delete_discovered_skill(
    app: AppHandle,
    project_path: String,
    target_path: String,
    authored_workspace_paths: Vec<String>,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_discovered_skill_blocking(app, project_path, target_path, authored_workspace_paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn install_skill(
    app: AppHandle,
    skill_id: String,
    project_path: String,
    scope: String,
    content: Option<String>,
) -> Result<InstalledSkill> {
    validate_slug(&skill_id)?;
    if !matches!(scope.as_str(), "project" | "global") {
        return Err("Invalid install scope.".into());
    }
    let target = install_target(&project_path, &scope, "opencode", &skill_id)?;
    if target.exists() {
        return Err("The target skill directory already exists.".into());
    }
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    if let Err(error) = fs::write(
        target.join("SKILL.md"),
        content.unwrap_or_else(|| format!("# {skill_id}\n")),
    ) {
        let _ = fs::remove_dir_all(&target);
        return Err(error.to_string());
    }
    let row = InstalledSkill {
        id: skill_id.clone(),
        name: skill_id,
        version: "0.1.0".into(),
        platform: "opencode".into(),
        scope,
        target_path: target.to_string_lossy().into_owned(),
        installed_at: Utc::now().to_rfc3339(),
        managed: true,
        available: true,
        path_error: None,
        identity_known: true,
    };
    let mut rows = load_registry(&app)?;
    rows.push(row.clone());
    save_registry(&app, &rows)?;
    Ok(row)
}

fn install_local_skill_blocking(
    app: AppHandle,
    skill_id: String,
    workspace_path: String,
    project_path: String,
    scope: String,
    agent: String,
) -> Result<InstalledSkill> {
    validate_slug(&skill_id)?;
    validate_agent(&agent)?;
    if !matches!(scope.as_str(), "project" | "global") {
        return Err("Invalid install scope.".into());
    }
    let source = fs::canonicalize(&workspace_path).map_err(|e| e.to_string())?;
    if !source.is_dir() || !source.join("SKILL.md").is_file() {
        return Err("The authored skill workspace is missing or invalid.".into());
    }
    let target = install_target(&project_path, &scope, &agent, &skill_id)?;
    if target.exists() {
        return Err("The target skill directory already exists.".into());
    }
    if target.starts_with(&source) {
        return Err("A skill cannot be installed inside its authoring workspace.".into());
    }
    if let Err(error) = copy_directory(&source, &target, true) {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    let target = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if scope == "project" {
        let project = fs::canonicalize(&project_path).map_err(|e| e.to_string())?;
        if let Err(error) = update_project_agents(&project, &skill_id, &target) {
            let _ = fs::remove_dir_all(&target);
            return Err(format!("Could not update project AGENTS.md: {error}"));
        }
    }
    let row = InstalledSkill {
        id: skill_id.clone(),
        name: skill_id,
        version: "local".into(),
        platform: agent,
        scope,
        target_path: target.to_string_lossy().into_owned(),
        installed_at: Utc::now().to_rfc3339(),
        managed: true,
        available: true,
        path_error: None,
        identity_known: true,
    };
    let mut rows = load_registry(&app)?;
    rows.retain(|existing| existing.target_path != row.target_path);
    rows.push(row.clone());
    save_registry(&app, &rows)?;
    Ok(row)
}

#[tauri::command]
async fn install_local_skill(
    app: AppHandle,
    skill_id: String,
    workspace_path: String,
    project_path: String,
    scope: String,
    agent: String,
) -> Result<InstalledSkill> {
    tauri::async_runtime::spawn_blocking(move || {
        install_local_skill_blocking(app, skill_id, workspace_path, project_path, scope, agent)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn uninstall_skill(app: AppHandle, skill_id: String, target_path: String) -> Result<()> {
    let mut rows = load_registry(&app)?;
    let index = rows
        .iter()
        .position(|r| r.id == skill_id && r.target_path == target_path)
        .ok_or_else(|| "This installation is not managed by Skill Studio.".to_string())?;
    delete_managed_skill_directory(&target_path)?;
    rows.remove(index);
    save_registry(&app, &rows)
}

#[tauri::command]
fn list_installed_skills(app: AppHandle) -> Result<Vec<InstalledSkill>> {
    let mut rows = load_registry(&app)?;
    let mut registry_changed = false;
    for row in &mut rows {
        if row.managed
            && row.version != "local"
            && !Path::new(&row.target_path).join("SKILL.md").is_file()
        {
            let project = (row.scope == "project")
                .then(|| {
                    Path::new(&row.target_path)
                        .ancestors()
                        .nth(3)
                        .and_then(Path::to_str)
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            if let Ok(actual) = locate_catalog_install(project, &row.scope, &row.platform, &row.id)
            {
                row.target_path = actual.to_string_lossy().into_owned();
                registry_changed = true;
            }
        }
        let target = Path::new(&row.target_path);
        row.available = target.is_dir() && target.join("SKILL.md").is_file();
        row.path_error = (!row.available).then(|| {
            format!(
                "Installed skill directory is missing or invalid: {}",
                row.target_path
            )
        });
    }
    if registry_changed {
        save_registry(&app, &rows)?;
    }
    Ok(rows)
}

async fn fetch_json(url: &str) -> Result<Value> {
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Catalog request failed with HTTP {}.",
            response.status()
        ));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RESPONSE_SIZE {
        return Err("Catalog response was too large.".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

async fn catalog_search(query: &str, limit: usize) -> Result<Vec<CatalogSkill>> {
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let data = fetch_json(&format!("https://skills.sh/api/search?q={encoded}")).await?;
    Ok(data["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|item| {
            let source = item["source"].as_str()?.to_string();
            let slug = item["skillId"].as_str()?.to_string();
            let id = item["id"]
                .as_str()
                .unwrap_or(&format!("{source}/{slug}"))
                .to_string();
            Some(CatalogSkill {
                id,
                source: source.clone(),
                slug: slug.clone(),
                name: item["name"].as_str().unwrap_or(&slug).to_string(),
                installs: item["installs"].as_u64().unwrap_or(0).to_string(),
                url: format!("https://skills.sh/{source}/{slug}"),
            })
        })
        .collect())
}

#[tauri::command]
async fn search_skill_catalog(query: String) -> Result<Vec<CatalogSkill>> {
    if query.trim().len() < 2 {
        return Err("Enter at least two characters.".into());
    }
    catalog_search(query.trim(), 100).await
}

#[tauri::command]
async fn popular_skill_catalog(limit: usize) -> Result<Vec<CatalogSkill>> {
    catalog_search("skill", limit.min(100)).await
}

#[tauri::command]
async fn get_catalog_skill(source: String, slug: String) -> Result<CatalogSkillDetail> {
    validate_slug(&slug)?;
    validate_catalog_source(&source)?;
    let response = reqwest::get(format!("https://skills.sh/{source}/{slug}"))
        .await
        .map_err(|e| e.to_string())?;
    let body = response.text().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_RESPONSE_SIZE {
        return Err("Catalog detail was too large.".into());
    }
    let pattern =
        Regex::new(r#"\"description\":\"((?:\\.|[^\"\\])*)\""#).map_err(|e| e.to_string())?;
    let description = pattern
        .captures(&body)
        .and_then(|c| c.get(1))
        .map(|m| {
            serde_json::from_str::<String>(&format!("\"{}\"", m.as_str()))
                .unwrap_or_else(|_| m.as_str().to_string())
        })
        .unwrap_or_else(|| "Community skill from skills.sh".into());
    Ok(CatalogSkillDetail {
        id: format!("{source}/{slug}"),
        source,
        slug: slug.clone(),
        name: slug.clone(),
        content: description.clone(),
        description,
    })
}

fn locate_catalog_install(
    project_path: &str,
    scope: &str,
    agent: &str,
    slug: &str,
) -> Result<PathBuf> {
    let mut candidates = Vec::new();
    if scope == "project" {
        let project = fs::canonicalize(project_path).map_err(|e| e.to_string())?;
        candidates.push(project.join(".agents/skills").join(slug));
        candidates.push(project_skill_root(&project, agent)?.join(slug));
    } else {
        let home = dirs::home_dir().ok_or_else(|| "Home directory is unavailable.".to_string())?;
        candidates.push(home.join(".agents/skills").join(slug));
        candidates.push(global_skill_root(agent)?.join(slug));
    }
    candidates
        .into_iter()
        .find(|path| path.join("SKILL.md").is_file())
        .and_then(|path| fs::canonicalize(path).ok())
        .ok_or_else(|| {
            "The skills CLI finished, but the installed skill directory could not be located."
                .into()
        })
}

fn catalog_install_arguments<'a>(
    source: &'a str,
    slug: &'a str,
    agent: &'a str,
    global: bool,
) -> Vec<&'a str> {
    let mut arguments = vec![
        "add", source, "--skill", slug, "--agent", agent, "--yes", "--copy",
    ];
    if global {
        arguments.push("--global");
    }
    arguments
}

fn install_catalog_skill_blocking(
    app: AppHandle,
    source: String,
    slug: String,
    project_path: String,
    scope: String,
    agent: String,
) -> Result<String> {
    validate_slug(&slug)?;
    validate_agent(&agent)?;
    validate_catalog_source(&source)?;
    let project = match scope.as_str() {
        "project" => {
            if project_path.trim().is_empty() {
                return Err("A project directory is required for project installs.".into());
            }
            let path = fs::canonicalize(&project_path).map_err(|error| {
                format!("Project directory is missing or inaccessible ({project_path}): {error}")
            })?;
            if !path.is_dir() {
                return Err(format!(
                    "Project path is not a directory: {}",
                    path.display()
                ));
            }
            Some(path)
        }
        "global" => None,
        _ => return Err("Invalid install scope.".into()),
    };
    let arguments = catalog_install_arguments(
        source.as_str(),
        slug.as_str(),
        agent.as_str(),
        scope == "global",
    );
    let output = run_skills_cli(&app, &arguments, project.as_deref())?;
    let target = locate_catalog_install(&project_path, &scope, &agent, &slug)?;
    let row = InstalledSkill {
        id: slug.clone(),
        name: slug.clone(),
        version: "latest".into(),
        platform: agent,
        scope: scope.clone(),
        target_path: target.to_string_lossy().into_owned(),
        installed_at: Utc::now().to_rfc3339(),
        managed: true,
        available: true,
        path_error: None,
        identity_known: true,
    };
    let mut rows = load_registry(&app)?;
    rows.retain(|existing| {
        existing.target_path != row.target_path
            && !(existing.id == row.id
                && existing.platform == row.platform
                && existing.scope == row.scope
                && !Path::new(&existing.target_path).exists())
    });
    rows.push(row);
    save_registry(&app, &rows)?;
    if scope == "project" {
        let project = project.expect("project scope should have a canonical directory");
        return match update_project_agents(&project, &slug, &target) {
            Ok(()) => Ok(output),
            Err(error) => Ok(format!(
                "{output}\nInstalled successfully, but AGENTS.md was not updated: {error}"
            )),
        };
    }
    Ok(output)
}

#[tauri::command]
async fn install_catalog_skill(
    app: AppHandle,
    source: String,
    slug: String,
    project_path: String,
    scope: String,
    agent: String,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        install_catalog_skill_blocking(app, source, slug, project_path, scope, agent)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn remove_catalog_skill_blocking(app: AppHandle, target_path: String) -> Result<String> {
    let rows = load_registry(&app)?;
    let managed = rows
        .iter()
        .find(|row| row.target_path == target_path && row.managed)
        .ok_or_else(|| "Managed installation was not found.".to_string())?;
    validate_slug(&managed.id)?;
    validate_agent(&managed.platform)?;
    delete_managed_skill_directory(&managed.target_path)?;
    let remaining: Vec<_> = rows
        .into_iter()
        .filter(|row| row.target_path != target_path)
        .collect();
    save_registry(&app, &remaining)?;
    Ok("Managed skill files and record removed.".into())
}

#[tauri::command]
async fn remove_catalog_skill(app: AppHandle, target_path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || remove_catalog_skill_blocking(app, target_path))
        .await
        .map_err(|e| e.to_string())?
}

fn update_catalog_skill_blocking(app: AppHandle, target_path: String) -> Result<String> {
    let rows = load_registry(&app)?;
    let managed = rows
        .iter()
        .find(|row| row.target_path == target_path && row.managed)
        .ok_or_else(|| "Managed installation was not found.".to_string())?;
    validate_slug(&managed.id)?;
    validate_agent(&managed.platform)?;
    let mut arguments = vec!["update", managed.id.as_str(), "--yes"];
    if managed.scope == "global" {
        arguments.push("--global");
        run_skills_cli(&app, &arguments, None)
    } else {
        arguments.push("--project");
        let project = Path::new(&managed.target_path)
            .ancestors()
            .nth(3)
            .ok_or_else(|| "The project installation could not be located.".to_string())?;
        run_skills_cli(&app, &arguments, Some(project))
    }
}

#[tauri::command]
async fn update_catalog_skill(app: AppHandle, target_path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || update_catalog_skill_blocking(app, target_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn forget_catalog_skill(app: AppHandle, target_path: String) -> Result<()> {
    let mut rows = load_registry(&app)?;
    let before = rows.len();
    rows.retain(|row| row.target_path != target_path);
    if rows.len() == before {
        return Err("Managed installation was not found.".into());
    }
    save_registry(&app, &rows)
}

fn github_status(app: &AppHandle) -> GithubAuthStatus {
    let installed = tool_command(app, EmbeddedTool::Gh)
        .and_then(|(mut command, _)| command.arg("--version").output().map_err(|e| e.to_string()))
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !installed {
        return GithubAuthStatus {
            installed: false,
            authenticated: false,
            username: None,
        };
    }
    let username = run_tool(
        app,
        EmbeddedTool::Gh,
        &["api", "user", "--jq", ".login"],
        None,
    )
    .ok()
    .filter(|value| !value.is_empty());
    GithubAuthStatus {
        installed: true,
        authenticated: username.is_some(),
        username,
    }
}

#[tauri::command]
async fn github_auth_status(app: AppHandle) -> Result<GithubAuthStatus> {
    tauri::async_runtime::spawn_blocking(move || github_status(&app))
        .await
        .map_err(|e| e.to_string())
}

fn github_auth_login_blocking(app: AppHandle) -> Result<GithubAuthStart> {
    if !github_status(&app).installed {
        return Err("The bundled GitHub CLI is unavailable. Reinstall Skill Studio.".into());
    }
    let (mut command, _) = tool_command(&app, EmbeddedTool::Gh)?;
    let mut child = command
        .args([
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--clipboard",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start GitHub authentication: {e}"))?;
    let (sender, receiver) = mpsc::channel();
    if let Some(stream) = child.stdout.take() {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(|line| line.ok()) {
                let _ = sender.send(line);
            }
        });
    }
    if let Some(stream) = child.stderr.take() {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(|line| line.ok()) {
                let _ = sender.send(line);
            }
        });
    }
    drop(sender);
    let code_pattern = Regex::new(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}\b").map_err(|e| e.to_string())?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        if let Ok(line) = receiver.recv_timeout(Duration::from_millis(250)) {
            if let Some(code) = code_pattern.find(&line) {
                let code = code.as_str().to_string();
                thread::spawn(move || {
                    let _ = child.wait();
                });
                let verification_url = "https://github.com/login/device".to_string();
                open::that(&verification_url).map_err(|e| e.to_string())?;
                return Ok(GithubAuthStart {
                    code,
                    verification_url,
                });
            }
        }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
    }
    let _ = child.kill();
    Err("GitHub did not provide a device code. Try signing in again.".into())
}

#[tauri::command]
async fn github_auth_login(app: AppHandle) -> Result<GithubAuthStart> {
    tauri::async_runtime::spawn_blocking(move || github_auth_login_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn github_auth_logout_blocking(app: AppHandle) -> Result<GithubAuthStatus> {
    let status = github_status(&app);
    let username = status
        .username
        .ok_or_else(|| "No GitHub account is signed in.".to_string())?;
    run_tool(
        &app,
        EmbeddedTool::Gh,
        &[
            "auth",
            "logout",
            "--hostname",
            "github.com",
            "--user",
            username.as_str(),
        ],
        None,
    )?;
    Ok(github_status(&app))
}

#[tauri::command]
async fn github_auth_logout(app: AppHandle) -> Result<GithubAuthStatus> {
    tauri::async_runtime::spawn_blocking(move || github_auth_logout_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn refresh_deployment(app: &AppHandle, row: &mut DeployedRepository) {
    let detail = run_tool(
        app,
        EmbeddedTool::Gh,
        &[
            "repo",
            "view",
            row.repository.as_str(),
            "--json",
            "nameWithOwner,url,pushedAt,defaultBranchRef,visibility",
        ],
        None,
    );
    let Ok(detail) = detail else {
        row.available = false;
        row.pushed_at = None;
        row.default_branch = None;
        row.visibility = None;
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(&detail) else {
        row.available = false;
        return;
    };
    row.available = true;
    row.repository = value["nameWithOwner"]
        .as_str()
        .unwrap_or(&row.repository)
        .to_string();
    row.repository_url = value["url"]
        .as_str()
        .unwrap_or(&row.repository_url)
        .to_string();
    row.pushed_at = value["pushedAt"].as_str().map(str::to_string);
    row.default_branch = value["defaultBranchRef"]["name"]
        .as_str()
        .map(str::to_string);
    row.visibility = value["visibility"].as_str().map(str::to_string);
}

#[tauri::command]
async fn list_deployed_repositories(
    app: AppHandle,
    refresh: bool,
) -> Result<Vec<DeployedRepository>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut rows = load_deployments(&app)?;
        if refresh {
            if !github_status(&app).authenticated {
                return Err("Sign in to GitHub before refreshing repositories.".into());
            }
            for row in &mut rows {
                refresh_deployment(&app, row);
            }
            save_deployments(&app, &rows)?;
        }
        rows.sort_by(|a, b| b.published_at.cmp(&a.published_at));
        Ok(rows)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn forget_deployed_repository(app: AppHandle, repository: String) -> Result<()> {
    let mut rows = load_deployments(&app)?;
    let before = rows.len();
    rows.retain(|row| row.repository != repository);
    if rows.len() == before {
        return Err("Deployed repository record was not found.".into());
    }
    save_deployments(&app, &rows)
}

fn publish_skill_blocking(
    app: AppHandle,
    skill_id: String,
    workspace_path: String,
    repository: String,
    description: String,
) -> Result<GithubPublishResult> {
    validate_slug(&skill_id)?;
    let repository_pattern =
        Regex::new(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").map_err(|e| e.to_string())?;
    if !repository_pattern.is_match(&repository) {
        return Err("Repository must use the owner/name format.".into());
    }
    if !github_status(&app).authenticated {
        return Err("Sign in to GitHub before publishing.".into());
    }
    let source = fs::canonicalize(&workspace_path).map_err(|e| e.to_string())?;
    if !source.is_dir() || !source.join("SKILL.md").is_file() {
        return Err("The selected skill workspace is missing or invalid.".into());
    }
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = std::env::temp_dir().join(format!("skill-studio-publish-{unique}"));
    let result = (|| {
        copy_directory(&source, &temporary, true)?;
        run_tool(&app, EmbeddedTool::Git, &["init"], Some(&temporary))?;
        run_tool(
            &app,
            EmbeddedTool::Git,
            &["config", "user.name", "Skill Studio"],
            Some(&temporary),
        )?;
        run_tool(
            &app,
            EmbeddedTool::Git,
            &[
                "config",
                "user.email",
                "skill-studio@users.noreply.github.com",
            ],
            Some(&temporary),
        )?;
        run_tool(&app, EmbeddedTool::Git, &["add", "."], Some(&temporary))?;
        run_tool(
            &app,
            EmbeddedTool::Git,
            &["commit", "-m", "Publish skill from Skill Studio"],
            Some(&temporary),
        )?;
        let mut arguments = vec![
            "repo",
            "create",
            repository.as_str(),
            "--public",
            "--source",
            ".",
            "--remote",
            "origin",
            "--push",
        ];
        if !description.trim().is_empty() {
            arguments.push("--description");
            arguments.push(description.trim());
        }
        run_tool(&app, EmbeddedTool::Gh, &arguments, Some(&temporary))?;
        let published_at = Utc::now().to_rfc3339();
        let mut rows = load_deployments(&app)?;
        let deployment = DeployedRepository {
            repository: repository.clone(),
            repository_url: format!("https://github.com/{repository}"),
            skill_id: skill_id.clone(),
            workspace_path: source.to_string_lossy().into_owned(),
            created_at: published_at.clone(),
            published_at,
            available: true,
            pushed_at: None,
            default_branch: None,
            visibility: Some("PUBLIC".into()),
        };
        rows.retain(|row| row.repository != repository);
        rows.push(deployment);
        save_deployments(&app, &rows)?;
        Ok(GithubPublishResult {
            repository_url: format!("https://github.com/{repository}"),
            install_command: format!("npx skills add {repository} --skill {skill_id}"),
        })
    })();
    let _ = fs::remove_dir_all(&temporary);
    result
}

#[tauri::command]
async fn publish_skill_to_github(
    app: AppHandle,
    skill_id: String,
    workspace_path: String,
    repository: String,
    description: String,
) -> Result<GithubPublishResult> {
    tauri::async_runtime::spawn_blocking(move || {
        publish_skill_blocking(app, skill_id, workspace_path, repository, description)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn update_deployed_repository_blocking(
    app: AppHandle,
    repository: String,
    workspace_path: String,
) -> Result<DeployedRepository> {
    if !github_status(&app).authenticated {
        return Err("Sign in to GitHub before updating repositories.".into());
    }
    let mut rows = load_deployments(&app)?;
    let index = rows
        .iter()
        .position(|row| row.repository == repository)
        .ok_or_else(|| "Deployed repository record was not found.".to_string())?;
    let source = fs::canonicalize(&workspace_path).map_err(|e| e.to_string())?;
    if !source.is_dir() || !source.join("SKILL.md").is_file() {
        return Err("The authored skill workspace is missing or invalid.".into());
    }
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = std::env::temp_dir().join(format!("skill-studio-update-{unique}"));
    fs::create_dir_all(&temporary).map_err(|e| e.to_string())?;
    let result = (|| {
        run_tool(
            &app,
            EmbeddedTool::Gh,
            &["repo", "clone", repository.as_str(), "."],
            Some(&temporary),
        )?;
        copy_directory(&source, &temporary, true)?;
        run_tool(
            &app,
            EmbeddedTool::Git,
            &["config", "user.name", "Skill Studio"],
            Some(&temporary),
        )?;
        run_tool(
            &app,
            EmbeddedTool::Git,
            &[
                "config",
                "user.email",
                "skill-studio@users.noreply.github.com",
            ],
            Some(&temporary),
        )?;
        run_tool(&app, EmbeddedTool::Git, &["add", "--all"], Some(&temporary))?;
        let changes = run_tool(
            &app,
            EmbeddedTool::Git,
            &["status", "--porcelain"],
            Some(&temporary),
        )?;
        if !changes.is_empty() {
            run_tool(
                &app,
                EmbeddedTool::Git,
                &["commit", "-m", "Update skill from Skill Studio"],
                Some(&temporary),
            )?;
            run_tool(&app, EmbeddedTool::Git, &["push"], Some(&temporary))?;
        }
        rows[index].workspace_path = source.to_string_lossy().into_owned();
        rows[index].published_at = Utc::now().to_rfc3339();
        refresh_deployment(&app, &mut rows[index]);
        save_deployments(&app, &rows)?;
        Ok(rows[index].clone())
    })();
    let _ = fs::remove_dir_all(&temporary);
    result
}

#[tauri::command]
async fn update_deployed_repository(
    app: AppHandle,
    repository: String,
    workspace_path: String,
) -> Result<DeployedRepository> {
    tauri::async_runtime::spawn_blocking(move || {
        update_deployed_repository_blocking(app, repository, workspace_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn load_app_state(app: AppHandle) -> Result<Option<String>> {
    let path = data_file(&app, "state.json")?;
    if path.exists() {
        fs::read_to_string(path)
            .map(Some)
            .map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn save_app_state(app: AppHandle, value: String) -> Result<()> {
    let path = data_file(&app, "state.json")?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, value).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_skill_workspace(
    project_path: String,
    skill_id: String,
    template: String,
) -> Result<String> {
    validate_slug(&skill_id)?;
    let project = fs::canonicalize(&project_path).map_err(|e| {
        format!("Workspace directory is missing or inaccessible ({project_path}): {e}")
    })?;
    if !project.is_dir() {
        return Err(format!("Workspace path is not a directory: {project_path}"));
    }
    let base = project;
    let target = base.join(&skill_id);
    if target.exists() {
        return Err("A workspace with this skill ID already exists.".into());
    }
    fs::create_dir(&target).map_err(|e| {
        format!(
            "Could not create skill directory ({}): {e}",
            target.display()
        )
    })?;
    if let Err(error) = fs::write(target.join("SKILL.md"), template) {
        let _ = fs::remove_dir_all(&target);
        return Err(format!("Could not write SKILL.md: {error}"));
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn discover_skill_workspaces(project_path: String) -> Result<Vec<WorkspaceSkill>> {
    let project = fs::canonicalize(&project_path).map_err(|e| {
        format!("Workspace directory is missing or inaccessible ({project_path}): {e}")
    })?;
    let base = project;
    if !base.exists() {
        return Ok(Vec::new());
    }
    let directories = fs::read_dir(&base)
        .map_err(|e| {
            format!(
                "Could not read project skills directory ({}): {e}",
                base.display()
            )
        })?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| path.is_dir());
    let mut skills = Vec::new();
    for directory in directories {
        let skill_file = directory.join("SKILL.md");
        if !skill_file.is_file() {
            continue;
        }
        let id = directory
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("local-skill")
            .to_string();
        skills.push(WorkspaceSkill {
            id,
            path: directory.to_string_lossy().into_owned(),
            content: fs::read_to_string(skill_file).map_err(|e| e.to_string())?,
        });
    }
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(skills)
}

#[tauri::command]
fn list_workspace(root: String) -> Result<Vec<WorkspaceEntry>> {
    let canonical = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    fn walk(base: &Path, current: &Path, output: &mut Vec<WorkspaceEntry>) -> Result<()> {
        for item in fs::read_dir(current).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let path = item.path();
            let relative = path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            output.push(WorkspaceEntry {
                path: relative,
                name: item.file_name().to_string_lossy().into_owned(),
                is_dir: path.is_dir(),
            });
            if path.is_dir() {
                walk(base, &path, output)?;
            }
        }
        Ok(())
    }
    let mut output = Vec::new();
    walk(&canonical, &canonical, &mut output)?;
    Ok(output)
}

#[tauri::command]
fn read_workspace_file(root: String, path: String) -> Result<String> {
    let target = safe_path(&root, &path)?;
    if !target.is_file() {
        return Err("Workspace file does not exist.".into());
    }
    fs::read_to_string(target).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_workspace_file(root: String, path: String, content: String) -> Result<()> {
    let target = safe_path(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_workspace_entry(root: String, path: String, is_dir: bool) -> Result<()> {
    let target = safe_path(&root, &path)?;
    if target.exists() {
        return Err("Workspace entry already exists.".into());
    }
    if is_dir {
        fs::create_dir_all(target).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(target, []).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn move_workspace_entry(root: String, from: String, to: String) -> Result<()> {
    let source = safe_path(&root, &from)?;
    let target = safe_path(&root, &to)?;
    if !source.exists() || target.exists() {
        return Err("Invalid workspace move.".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(source, target).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_workspace_entry(root: String, path: String) -> Result<()> {
    if path == "SKILL.md" {
        return Err("Remove the skill workspace instead of deleting SKILL.md.".into());
    }
    let target = safe_path(&root, &path)?;
    if !target.exists() {
        return Err("Workspace entry does not exist.".into());
    }
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn delete_skill_workspace(root: String) -> Result<()> {
    let target = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    if !target.is_dir() || !target.join("SKILL.md").is_file() {
        return Err("Only a skill workspace containing SKILL.md can be deleted.".into());
    }
    fs::remove_dir_all(target).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<()> {
    const ALLOWED_HOSTS: &[&str] = &[
        "aider.chat",
        "aistudio.google.com",
        "ampcode.com",
        "chatgpt.com",
        "cline.bot",
        "continue.dev",
        "cursor.com",
        "github.com",
        "githubnext.com",
        "opencode.ai",
        "openai.com",
        "roo.ai",
        "skills.sh",
        "windsurf.com",
        "www.anthropic.com",
        "www.jetbrains.com",
        "www.npmjs.com",
        "www.sourcegraph.com",
        "www.tabnine.com",
        "www.warp.dev",
    ];
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https"
        || parsed.username() != ""
        || parsed.password().is_some()
        || !parsed
            .host_str()
            .is_some_and(|host| ALLOWED_HOSTS.contains(&host))
    {
        return Err("External URL is not allowed.".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

fn provider_url(config: &ProviderConfig, path: &str) -> Result<String> {
    let parsed = url::Url::parse(&config.base_url).map_err(|e| e.to_string())?;
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if config.provider == "ollama" && (!local || parsed.scheme() != "http") {
        return Err("Ollama is restricted to HTTP localhost.".into());
    }
    if config.provider == "openai-compatible" && !local && parsed.scheme() != "https" {
        return Err("Remote model endpoints must use HTTPS.".into());
    }
    if !matches!(config.provider.as_str(), "ollama" | "openai-compatible") {
        return Err("Unsupported model provider.".into());
    }
    Ok(format!("{}{}", config.base_url.trim_end_matches('/'), path))
}

fn is_gemini_endpoint(config: &ProviderConfig) -> bool {
    url::Url::parse(&config.base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .is_some_and(|host| host == "generativelanguage.googleapis.com")
}

async fn provider_request(
    config: &ProviderConfig,
    path: &str,
    body: Option<Value>,
) -> Result<Value> {
    provider_request_url(config, provider_url(config, path)?, body, true).await
}

fn provider_auth_values(
    config: &ProviderConfig,
    include_bearer: bool,
) -> (Option<String>, Option<String>) {
    let key = config
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_owned);
    let bearer = include_bearer.then(|| key.clone()).flatten();
    let google_api_key = is_gemini_endpoint(config).then(|| key).flatten();
    (bearer, google_api_key)
}

async fn provider_request_url(
    config: &ProviderConfig,
    url: String,
    body: Option<Value>,
    include_bearer: bool,
) -> Result<Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(
            config.timeout_ms.clamp(1_000, 300_000),
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = if let Some(body) = body {
        client.post(url).json(&body)
    } else {
        client.get(url)
    };
    let (bearer, google_api_key) = provider_auth_values(config, include_bearer);
    if let Some(key) = bearer {
        request = request.bearer_auth(key);
    }
    if let Some(key) = google_api_key {
        request = request.header("x-goog-api-key", key);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RESPONSE_SIZE {
        return Err("Provider response exceeded 4 MiB.".into());
    }
    if !status.is_success() {
        return Err(format!(
            "Provider returned HTTP {}: {}",
            status,
            String::from_utf8_lossy(&bytes)
                .chars()
                .take(500)
                .collect::<String>()
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| "Provider returned invalid JSON.".into())
}

fn parse_gemini_models_page(value: &Value) -> (Vec<Value>, Option<String>) {
    let models = value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| {
            row["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|methods| methods.iter().any(|method| method == "generateContent"))
        })
        .filter_map(|row| {
            let id = row["name"].as_str()?.strip_prefix("models/")?;
            let name = row["displayName"].as_str().unwrap_or(id);
            Some(json!({ "id": id, "name": name }))
        })
        .collect();
    let next_page_token = value["nextPageToken"]
        .as_str()
        .filter(|token| !token.is_empty())
        .map(str::to_owned);
    (models, next_page_token)
}

async fn list_gemini_models(config: &ProviderConfig) -> Result<Vec<Value>> {
    if !config
        .api_key
        .as_deref()
        .is_some_and(|key| !key.trim().is_empty())
    {
        return Err("A Gemini API key is required to list models.".into());
    }
    let mut models = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..100 {
        let mut url = url::Url::parse("https://generativelanguage.googleapis.com/v1beta/models")
            .map_err(|error| error.to_string())?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("pageSize", "1000");
            if let Some(token) = page_token.as_deref() {
                query.append_pair("pageToken", token);
            }
        }
        let value = provider_request_url(config, url.into(), None, false).await?;
        let (mut page_models, next_page_token) = parse_gemini_models_page(&value);
        models.append(&mut page_models);
        page_token = next_page_token;
        if page_token.is_none() {
            models.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
            models.dedup_by(|left, right| left["id"] == right["id"]);
            return Ok(models);
        }
    }
    Err("Gemini returned too many model-list pages.".into())
}

#[tauri::command]
async fn provider_status(config: ProviderConfig) -> Result<Value> {
    let provider = config.provider.clone();
    let models = list_models_inner(&config).await?;
    Ok(
        json!({ "connected": true, "provider": provider, "message": format!("{} model available", models.len()) }),
    )
}

async fn list_models_inner(config: &ProviderConfig) -> Result<Vec<Value>> {
    if is_gemini_endpoint(config) {
        return list_gemini_models(config).await;
    }
    let ollama = config.provider == "ollama";
    let value =
        provider_request(config, if ollama { "/api/tags" } else { "/models" }, None).await?;
    let rows = if ollama {
        value["models"].as_array()
    } else {
        value["data"].as_array()
    };
    Ok(rows
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let id = if ollama {
                row["name"].as_str()
            } else {
                row["id"].as_str()
            }?;
            Some(json!({ "id": id, "name": id }))
        })
        .collect())
}

#[tauri::command]
async fn list_models(config: ProviderConfig) -> Result<Vec<Value>> {
    list_models_inner(&config).await
}

#[tauri::command]
async fn chat_model(
    config: ProviderConfig,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<ChatResult> {
    if config.model.trim().is_empty() {
        return Err("A model must be selected.".into());
    }
    let started = std::time::Instant::now();
    let ollama = config.provider == "ollama";
    let response = provider_request(&config, if ollama { "/api/chat" } else { "/chat/completions" }, Some(json!({ "model": config.model, "messages": messages, "stream": false, "temperature": temperature }))).await?;
    let content = if ollama {
        response["message"]["content"].as_str()
    } else {
        response["choices"][0]["message"]["content"].as_str()
    }
    .ok_or_else(|| "Provider response contained no message.".to_string())?
    .to_string();
    Ok(ChatResult {
        content,
        model: config.model,
        duration_ms: started.elapsed().as_millis(),
        prompt_tokens: if ollama {
            response["prompt_eval_count"].as_u64()
        } else {
            response["usage"]["prompt_tokens"].as_u64()
        },
        completion_tokens: if ollama {
            response["eval_count"].as_u64()
        } else {
            response["usage"]["completion_tokens"].as_u64()
        },
        demo: false,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_project_directory,
            detect_open_code,
            scan_project_skills,
            delete_discovered_skill,
            install_skill,
            install_local_skill,
            uninstall_skill,
            list_installed_skills,
            search_skill_catalog,
            popular_skill_catalog,
            get_catalog_skill,
            install_catalog_skill,
            remove_catalog_skill,
            update_catalog_skill,
            forget_catalog_skill,
            load_app_state,
            save_app_state,
            create_skill_workspace,
            discover_skill_workspaces,
            list_workspace,
            read_workspace_file,
            write_workspace_file,
            create_workspace_entry,
            move_workspace_entry,
            delete_workspace_entry,
            delete_skill_workspace,
            python_status,
            run_python_file,
            github_auth_status,
            github_auth_login,
            github_auth_logout,
            list_deployed_repositories,
            publish_skill_to_github,
            update_deployed_repository,
            forget_deployed_repository,
            open_external_url,
            provider_status,
            list_models,
            chat_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skill Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("skill-studio-{name}-{unique}"));
        fs::create_dir_all(&path).expect("temporary directory should be created");
        path
    }

    #[test]
    fn gemini_authentication_is_limited_to_the_google_api_host() {
        let config = ProviderConfig {
            provider: "openai-compatible".into(),
            base_url: "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            model: "gemini-3.5-flash".into(),
            timeout_ms: 60_000,
            api_key: Some("test-key".into()),
        };
        assert!(is_gemini_endpoint(&config));
        assert_eq!(
            provider_auth_values(&config, true),
            (Some("test-key".into()), Some("test-key".into()))
        );
        assert_eq!(
            provider_auth_values(&config, false),
            (None, Some("test-key".into()))
        );

        let mut other = config;
        other.base_url = "https://api.openai.com/v1".into();
        assert!(!is_gemini_endpoint(&other));
        assert_eq!(provider_auth_values(&other, false), (None, None));
    }

    #[test]
    fn gemini_model_pages_keep_only_generate_content_models() {
        let (models, token) = parse_gemini_models_page(&json!({
            "models": [
                {
                    "name": "models/gemini-3.5-flash",
                    "displayName": "Gemini 3.5 Flash",
                    "supportedGenerationMethods": ["generateContent", "countTokens"]
                },
                {
                    "name": "models/text-embedding-004",
                    "supportedGenerationMethods": ["embedContent"]
                }
            ],
            "nextPageToken": "next-page"
        }));

        assert_eq!(
            models,
            vec![json!({
                "id": "gemini-3.5-flash",
                "name": "Gemini 3.5 Flash"
            })]
        );
        assert_eq!(token.as_deref(), Some("next-page"));
    }

    #[test]
    fn catalog_install_arguments_are_separate_and_use_copy_mode() {
        assert_eq!(
            catalog_install_arguments("vercel-labs/skills", "find-skills", "universal", false,),
            vec![
                "add",
                "vercel-labs/skills",
                "--skill",
                "find-skills",
                "--agent",
                "universal",
                "--yes",
                "--copy",
            ]
        );
    }

    #[test]
    fn project_scan_finds_skill_files_at_every_depth() {
        let project = temporary_directory("scan");
        let nested = project.join("one/two/three");
        let installed = project.join(".agents/skills/example");
        fs::create_dir_all(&nested).expect("nested directory should be created");
        fs::create_dir_all(&installed).expect("installed directory should be created");
        fs::write(project.join("SKILL.md"), "root").expect("root skill should be written");
        fs::write(nested.join("SKILL.md"), "nested").expect("nested skill should be written");
        fs::write(installed.join("SKILL.md"), "---\nname: example\n---\n")
            .expect("installed skill should be written");

        let rows = scan_project_skill_files(&project).expect("project scan should succeed");

        assert_eq!(rows.len(), 3);
        assert!(rows.iter().any(|row| Path::new(&row.target_path) == nested));
        assert!(rows
            .iter()
            .any(|row| Path::new(&row.target_path) == installed));
        let identified = rows
            .iter()
            .find(|row| Path::new(&row.target_path) == installed)
            .expect("identified skill should be returned");
        assert!(identified.identity_known);
        assert_eq!(identified.name, "example");
        fs::remove_dir_all(project).expect("temporary directory should be removed");
    }

    #[test]
    fn managed_delete_removes_only_the_selected_skill_directory() {
        let root = temporary_directory("remove");
        let selected = root.join("selected");
        let retained = root.join("retained");
        fs::create_dir_all(&selected).expect("selected skill should be created");
        fs::create_dir_all(&retained).expect("retained skill should be created");
        fs::write(selected.join("SKILL.md"), "selected")
            .expect("selected marker should be written");
        fs::write(retained.join("SKILL.md"), "retained")
            .expect("retained marker should be written");

        delete_managed_skill_directory(&selected.to_string_lossy())
            .expect("selected skill should be removed");

        assert!(!selected.exists());
        assert!(retained.join("SKILL.md").is_file());
        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }

    #[test]
    fn bundled_tools_resolve_complete_resource_layout() {
        let root = temporary_directory("tools");
        for path in [
            "node/node.exe",
            "skills/package/bin/cli.mjs",
            "skills/package/dist/cli.mjs",
            "skills/package/package.json",
            "git/cmd/git.exe",
            "gh/bin/gh.exe",
        ] {
            let path = root.join(path);
            fs::create_dir_all(path.parent().expect("tool should have a parent"))
                .expect("tool parent should be created");
            fs::write(path, []).expect("tool placeholder should be written");
        }

        let skills = bundled_tool(&root, EmbeddedTool::Skills)
            .expect("skills resolution should succeed")
            .expect("skills should resolve");
        assert_eq!(skills.program, root.join("node/node.exe"));
        assert_eq!(
            skills.prefix_arguments,
            vec![root.join("skills/package/bin/cli.mjs").into_os_string()]
        );
        let git = bundled_tool(&root, EmbeddedTool::Git)
            .expect("Git resolution should succeed")
            .expect("Git should resolve");
        assert_eq!(git.program, root.join("git/cmd/git.exe"));
        let gh = bundled_tool(&root, EmbeddedTool::Gh)
            .expect("GitHub CLI resolution should succeed")
            .expect("GitHub CLI should resolve");
        assert_eq!(gh.program, root.join("gh/bin/gh.exe"));

        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }

    #[test]
    fn incomplete_bundled_tools_do_not_fall_back_to_path() {
        let root = temporary_directory("incomplete-tools");
        fs::create_dir_all(root.join("node")).expect("node directory should be created");
        fs::write(root.join("node/node.exe"), []).expect("node placeholder should be written");

        let error = bundled_tool(&root, EmbeddedTool::Skills)
            .err()
            .expect("incomplete tools should fail");
        assert!(error.contains("incomplete"));

        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }

    #[test]
    fn missing_packaged_tools_fail_closed() {
        let resource_dir = temporary_directory("missing-packaged-tools");
        let error = packaged_tool(&resource_dir, EmbeddedTool::Skills)
            .err()
            .expect("missing packaged tools should fail");
        assert!(error.contains("bundled skills CLI runtime is missing"));
        assert!(!error.contains("npx"));
        fs::remove_dir_all(resource_dir).expect("temporary directory should be removed");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn process_paths_remove_the_windows_verbatim_prefix() {
        assert_eq!(
            process_path(Path::new(
                r"\\?\C:\Program Files\Skill Studio\skill-studio.exe"
            )),
            PathBuf::from(r"C:\Program Files\Skill Studio\skill-studio.exe")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn bundled_node_preserves_windows_arguments_and_working_directory() {
        let root = temporary_directory("windows-command-with-spaces");
        let project = root.join("Project With Spaces");
        fs::create_dir_all(&project).expect("project directory should be created");
        let project = fs::canonicalize(project).expect("project should canonicalize");
        let probe = root.join("argument probe.mjs");
        fs::write(
            &probe,
            "console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));",
        )
        .expect("probe should be written");
        let probe = fs::canonicalize(probe).expect("probe should canonicalize");
        assert!(probe.to_string_lossy().starts_with(r"\\?\"));
        let node = fs::canonicalize(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/tools/windows-x64/node/node.exe"),
        )
        .expect("bundled Node should canonicalize");
        let output = background_command(process_path(&node))
            .arg(process_path(&probe))
            .args(catalog_install_arguments(
                "vercel-labs/skills",
                "find-skills",
                "universal",
                false,
            ))
            .current_dir(process_path(&project))
            .output()
            .expect("Node argument probe should run");
        assert!(output.status.success());
        let value: Value =
            serde_json::from_slice(&output.stdout).expect("Node argument probe should return JSON");
        assert_eq!(value["argv"][0], "add");
        assert_eq!(value["argv"][1], "vercel-labs/skills");
        assert!(!value["argv"]
            .as_array()
            .expect("argv should be an array")
            .iter()
            .any(|argument| argument == "C:"));
        assert_eq!(
            fs::canonicalize(value["cwd"].as_str().expect("cwd should be a string"))
                .expect("reported cwd should canonicalize"),
            project
        );
        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }
}
