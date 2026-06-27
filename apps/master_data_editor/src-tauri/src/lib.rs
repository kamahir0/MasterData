use anyhow::{Context, Result};
use directories::ProjectDirs;
use indexmap::IndexMap;
use master_data_core::{
    build_project, clean_project, generate_project, scan_yaml_files, sync_project,
    validate_project, Definition, DiagnosticBag, MasterDataConfig, SourceDefinition,
    CONFIG_FILE_NAME,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshot {
    root: PathBuf,
    master_root: PathBuf,
    config: MasterDataConfig,
    directories: Vec<DirectoryNode>,
    files: Vec<FileNode>,
    documents: Vec<DefinitionDocument>,
    diagnostics: Vec<EditorDiagnostic>,
    available_tags: Vec<String>,
    build_profiles: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    path: PathBuf,
    relative_path: PathBuf,
    name: String,
    kind: String,
    type_name: Option<String>,
    has_error: bool,
    modified_millis: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryNode {
    path: PathBuf,
    relative_path: PathBuf,
    name: String,
    modified_millis: u128,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DefinitionDocument {
    path: PathBuf,
    relative_path: PathBuf,
    kind: String,
    type_name: String,
    definition: Definition,
    sidecar: TableViewConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableViewConfig {
    #[serde(default)]
    column_widths: IndexMap<String, u32>,
    #[serde(default)]
    column_order: Vec<String>,
    #[serde(default)]
    hidden_columns: Vec<String>,
    #[serde(default)]
    column_colors: IndexMap<String, String>,
    #[serde(default)]
    row_heights: IndexMap<String, u32>,
    #[serde(default)]
    cell_colors: IndexMap<String, String>,
    #[serde(default)]
    freeze_columns: usize,
    #[serde(default)]
    last_filter: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct EditorPreferences {
    recent_projects: Vec<PathBuf>,
    theme: String,
    zoom: f32,
    grid_font_size: u32,
    default_profile: Option<String>,
    sidebar_visible: bool,
    bottom_panel_visible: bool,
    bottom_panel_height: u32,
    bottom_panel_active_tab: String,
}

impl Default for EditorPreferences {
    fn default() -> Self {
        Self {
            recent_projects: Vec::new(),
            theme: "system".to_string(),
            zoom: 1.0,
            grid_font_size: 13,
            default_profile: Some("production".to_string()),
            sidebar_visible: true,
            bottom_panel_visible: false,
            bottom_panel_height: 160,
            bottom_panel_active_tab: "problems".to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorDiagnostic {
    severity: String,
    code: String,
    path: Option<PathBuf>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    ok: bool,
    message: String,
    diagnostics: Vec<EditorDiagnostic>,
}

#[tauri::command]
fn open_project(path: String) -> Result<ProjectSnapshot, String> {
    load_project_snapshot(resolve_project_root(PathBuf::from(path)).map_err(to_string)?)
        .map_err(to_string)
}

#[tauri::command]
fn reload_project(project_root: String) -> Result<ProjectSnapshot, String> {
    load_project_snapshot(canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?)
        .map_err(to_string)
}

#[tauri::command]
fn validate_editor_project(
    project_root: String,
    profile: Option<String>,
) -> Result<CommandResult, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    match validate_project(&root, profile.as_deref()).map_err(to_string)? {
        Ok(_) => Ok(CommandResult {
            ok: true,
            message: "validation succeeded".to_string(),
            diagnostics: Vec::new(),
        }),
        Err(diagnostics) => Ok(CommandResult {
            ok: false,
            message: "validation failed".to_string(),
            diagnostics: map_diagnostics(&diagnostics),
        }),
    }
}

#[tauri::command]
fn generate_editor_project(project_root: String) -> Result<CommandResult, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    match generate_project(&root).map_err(to_string)? {
        Ok(_) => Ok(ok_result("generation succeeded")),
        Err(diagnostics) => Ok(failed_result("generation failed", &diagnostics)),
    }
}

#[tauri::command]
fn build_editor_project(
    project_root: String,
    profile: Option<String>,
) -> Result<CommandResult, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    match build_project(&root, profile.as_deref()).map_err(to_string)? {
        Ok(_) => Ok(ok_result("build succeeded")),
        Err(diagnostics) => Ok(failed_result("build failed", &diagnostics)),
    }
}

#[tauri::command]
fn sync_editor_project(project_root: String, init: bool) -> Result<CommandResult, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    sync_project(&root, init).map_err(to_string)?;
    Ok(ok_result("sync succeeded"))
}

#[tauri::command]
fn clean_editor_project(project_root: String) -> Result<CommandResult, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    clean_project(&root).map_err(to_string)?;
    Ok(ok_result("clean succeeded"))
}

#[tauri::command]
fn save_definition(
    project_root: String,
    relative_path: String,
    mut definition: Definition,
) -> Result<DefinitionDocument, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    let config = MasterDataConfig::load(&root).map_err(to_string)?;
    let master_root = canonicalize_existing(root.join(&config.master.input)).map_err(to_string)?;
    let path = safe_join(&master_root, &relative_path).map_err(to_string)?;
    ensure_yaml_path(&path).map_err(to_string)?;
    normalize_definition_fixed_indexes(&mut definition);
    let text = canonical_definition_yaml(&definition).map_err(to_string)?;
    atomic_write(&path, text.as_bytes()).map_err(to_string)?;
    document_from_definition(&master_root, &path, definition).map_err(to_string)
}

#[tauri::command]
fn save_project_settings(
    project_root: String,
    config: MasterDataConfig,
) -> Result<ProjectSnapshot, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    let path = root.join(CONFIG_FILE_NAME);
    let text = config.to_yaml_string().map_err(to_string)?;
    atomic_write(&path, text.as_bytes()).map_err(to_string)?;
    load_project_snapshot(root).map_err(to_string)
}

#[tauri::command]
fn create_definition(
    project_root: String,
    relative_path: String,
    mut definition: Definition,
) -> Result<DefinitionDocument, String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    let config = MasterDataConfig::load(&root).map_err(to_string)?;
    let master_root = canonicalize_existing(root.join(&config.master.input)).map_err(to_string)?;
    let path = safe_join(&master_root, &relative_path).map_err(to_string)?;
    ensure_yaml_path(&path).map_err(to_string)?;
    if path.exists() {
        return Err(format!("file already exists: {}", path.display()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    normalize_definition_fixed_indexes(&mut definition);
    let text = canonical_definition_yaml(&definition).map_err(to_string)?;
    atomic_write(&path, text.as_bytes()).map_err(to_string)?;
    document_from_definition(&master_root, &path, definition).map_err(to_string)
}

#[tauri::command]
fn create_directory(project_root: String, relative_path: String) -> Result<(), String> {
    if relative_path.trim().is_empty() {
        return Err("directory path is empty".to_string());
    }
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    let config = MasterDataConfig::load(&root).map_err(to_string)?;
    let master_root = canonicalize_existing(root.join(&config.master.input)).map_err(to_string)?;
    let path = safe_join(&master_root, &relative_path).map_err(to_string)?;
    if path.exists() {
        return Err(format!("directory already exists: {}", path.display()));
    }
    fs::create_dir_all(&path).map_err(to_string)
}

#[tauri::command]
fn rename_entry(project_root: String, from: String, to: String) -> Result<(), String> {
    move_entry(project_root, from, to)
}

#[tauri::command]
fn move_entry(project_root: String, from: String, to: String) -> Result<(), String> {
    let (master_root, source, destination) =
        resolve_master_paths(&project_root, &from, &to).map_err(to_string)?;
    ensure_inside(&master_root, &source).map_err(to_string)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    fs::rename(&source, &destination).map_err(to_string)?;

    let source_sidecar = sidecar_path(&source);
    if source_sidecar.exists() {
        let destination_sidecar = sidecar_path(&destination);
        fs::rename(source_sidecar, destination_sidecar).map_err(to_string)?;
    }
    Ok(())
}

#[tauri::command]
fn delete_entry(project_root: String, relative_path: String) -> Result<(), String> {
    let root = canonicalize_existing(PathBuf::from(project_root)).map_err(to_string)?;
    let config = MasterDataConfig::load(&root).map_err(to_string)?;
    let master_root = canonicalize_existing(root.join(&config.master.input)).map_err(to_string)?;
    let path = safe_join(&master_root, &relative_path).map_err(to_string)?;
    ensure_inside(&master_root, &path).map_err(to_string)?;
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(to_string)?;
    } else {
        fs::remove_file(&path).map_err(to_string)?;
        let sidecar = sidecar_path(&path);
        if sidecar.exists() {
            fs::remove_file(sidecar).map_err(to_string)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn read_sidecar(project_root: String, relative_path: String) -> Result<TableViewConfig, String> {
    let path = resolve_master_file(&project_root, &relative_path).map_err(to_string)?;
    read_sidecar_path(&path).map_err(to_string)
}

#[tauri::command]
fn write_sidecar(
    project_root: String,
    relative_path: String,
    config: TableViewConfig,
) -> Result<(), String> {
    let path = resolve_master_file(&project_root, &relative_path).map_err(to_string)?;
    let sidecar = sidecar_path(&path);
    let text = serde_json::to_vec_pretty(&config).map_err(to_string)?;
    atomic_write(&sidecar, &text).map_err(to_string)?;
    Ok(())
}

#[tauri::command]
fn get_preferences() -> Result<EditorPreferences, String> {
    let path = preferences_path().map_err(to_string)?;
    if !path.exists() {
        return Ok(EditorPreferences::default());
    }
    let text = fs::read_to_string(path).map_err(to_string)?;
    serde_json::from_str(&text).map_err(to_string)
}

#[tauri::command]
fn save_preferences(preferences: EditorPreferences) -> Result<(), String> {
    let path = preferences_path().map_err(to_string)?;
    let text = serde_json::to_vec_pretty(&preferences).map_err(to_string)?;
    atomic_write(&path, &text).map_err(to_string)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_project,
            reload_project,
            validate_editor_project,
            generate_editor_project,
            build_editor_project,
            sync_editor_project,
            clean_editor_project,
            save_definition,
            save_project_settings,
            create_definition,
            create_directory,
            rename_entry,
            move_entry,
            delete_entry,
            read_sidecar,
            write_sidecar,
            get_preferences,
            save_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Lilja.MasterData editor");
}

fn load_project_snapshot(root: PathBuf) -> Result<ProjectSnapshot> {
    let config = MasterDataConfig::load(&root)?;
    let master_root = canonicalize_existing(root.join(&config.master.input))?;
    let directories = scan_master_directories(&master_root)?;
    let sources = scan_yaml_files(&root, &config.master.input)?;
    let mut documents = Vec::new();
    let mut files = Vec::new();
    let diagnostics = match validate_project(&root, None)? {
        Ok(_) => Vec::new(),
        Err(diagnostics) => map_diagnostics(&diagnostics),
    };

    for source in sources {
        let path = source.path.clone();
        let relative_path = source.relative_path.clone();
        let parsed = SourceDefinition::parse(source);
        match parsed {
            Ok(source_definition) => {
                let mut definition = source_definition.definition;
                normalize_definition_fixed_indexes(&mut definition);
                let kind = definition.kind().to_string();
                let type_name = definition.type_name().to_string();
                let sidecar = read_sidecar_path(&path).unwrap_or_default();
                files.push(FileNode {
                    name: path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    path: path.clone(),
                    relative_path: relative_path.clone(),
                    kind: kind.clone(),
                    type_name: Some(type_name.clone()),
                    has_error: diagnostics.iter().any(|diagnostic| {
                        diagnostic
                            .path
                            .as_ref()
                            .map(|diagnostic_path| diagnostic_path == &path)
                            .unwrap_or(false)
                    }),
                    modified_millis: modified_millis(&path),
                });
                documents.push(DefinitionDocument {
                    path,
                    relative_path,
                    kind,
                    type_name,
                    definition,
                    sidecar,
                });
            }
            Err(_) => files.push(FileNode {
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
                path: path.clone(),
                relative_path,
                kind: "invalid".to_string(),
                type_name: None,
                has_error: true,
                modified_millis: modified_millis(&path),
            }),
        }
    }

    Ok(ProjectSnapshot {
        root,
        master_root,
        directories,
        available_tags: config.tags.allowed.clone(),
        build_profiles: config.build_profiles.keys().cloned().collect(),
        config,
        files,
        documents,
        diagnostics,
    })
}

fn document_from_definition(
    master_root: &Path,
    path: &Path,
    definition: Definition,
) -> Result<DefinitionDocument> {
    let relative_path = path.strip_prefix(master_root).unwrap_or(path).to_path_buf();
    Ok(DefinitionDocument {
        path: path.to_path_buf(),
        relative_path,
        kind: definition.kind().to_string(),
        type_name: definition.type_name().to_string(),
        sidecar: read_sidecar_path(path).unwrap_or_default(),
        definition,
    })
}

fn scan_master_directories(master_root: &Path) -> Result<Vec<DirectoryNode>> {
    let mut directories = Vec::new();
    for entry in walkdir::WalkDir::new(master_root).min_depth(1) {
        let entry = entry?;
        if !entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path().to_path_buf();
        let relative_path = path
            .strip_prefix(master_root)
            .unwrap_or(&path)
            .to_path_buf();
        directories.push(DirectoryNode {
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            modified_millis: modified_millis(&path),
            path,
            relative_path,
        });
    }
    Ok(directories)
}

fn normalize_definition_fixed_indexes(definition: &mut Definition) {
    match definition {
        Definition::Struct(value) => normalize_field_fixed_indexes(&mut value.fields),
        Definition::Table(value) => normalize_field_fixed_indexes(&mut value.fields),
        Definition::Enum(_) => {}
    }
}

fn normalize_field_fixed_indexes(fields: &mut [master_data_core::FieldDefinition]) {
    let mut used: Vec<usize> = fields
        .iter()
        .filter_map(|field| field.fixed_index)
        .collect();
    let mut next = used
        .iter()
        .copied()
        .max()
        .map(|value| value + 1)
        .unwrap_or(0);
    for (index, field) in fields.iter_mut().enumerate() {
        if field.fixed_index.is_some() {
            continue;
        }
        if !used.contains(&index) {
            field.fixed_index = Some(index);
            used.push(index);
            continue;
        }
        while used.contains(&next) {
            next += 1;
        }
        field.fixed_index = Some(next);
        used.push(next);
    }
}

fn canonical_definition_yaml(definition: &Definition) -> Result<String> {
    let mut text = serde_yaml::to_string(definition)?;
    if !text.ends_with('\n') {
        text.push('\n');
    }
    Ok(text)
}

fn resolve_project_root(start: PathBuf) -> Result<PathBuf> {
    let start = if start.is_file() {
        start.parent().unwrap_or(&start).to_path_buf()
    } else {
        start
    };
    let mut current = canonicalize_existing(start)?;
    loop {
        if current.join(CONFIG_FILE_NAME).exists() {
            return Ok(current);
        }
        if !current.pop() {
            anyhow::bail!("{CONFIG_FILE_NAME} was not found");
        }
    }
}

fn resolve_master_file(project_root: &str, relative_path: &str) -> Result<PathBuf> {
    let root = canonicalize_existing(PathBuf::from(project_root))?;
    let config = MasterDataConfig::load(&root)?;
    let master_root = canonicalize_existing(root.join(&config.master.input))?;
    let path = safe_join(&master_root, relative_path)?;
    ensure_inside(&master_root, &path)?;
    Ok(path)
}

fn resolve_master_paths(
    project_root: &str,
    from: &str,
    to: &str,
) -> Result<(PathBuf, PathBuf, PathBuf)> {
    let root = canonicalize_existing(PathBuf::from(project_root))?;
    let config = MasterDataConfig::load(&root)?;
    let master_root = canonicalize_existing(root.join(&config.master.input))?;
    let source = safe_join(&master_root, from)?;
    let destination = safe_join(&master_root, to)?;
    Ok((master_root, source, destination))
}

fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        anyhow::bail!("path must stay inside the master directory");
    }
    Ok(root.join(relative))
}

fn ensure_inside(root: &Path, path: &Path) -> Result<()> {
    let root = canonicalize_existing(root.to_path_buf())?;
    let path = if path.exists() {
        canonicalize_existing(path.to_path_buf())?
    } else {
        canonicalize_existing(path.parent().unwrap_or(path).to_path_buf())?
    };
    if !path.starts_with(root) {
        anyhow::bail!("path is outside the project");
    }
    Ok(())
}

fn ensure_yaml_path(path: &Path) -> Result<()> {
    match path.extension().and_then(|value| value.to_str()) {
        Some("yaml") | Some("yml") => Ok(()),
        _ => anyhow::bail!("definition path must be .yaml or .yml"),
    }
}

fn canonicalize_existing(path: PathBuf) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to resolve path: {}", path.display()))
}

fn sidecar_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("table");
    path.with_file_name(format!("{stem}.config.json"))
}

fn read_sidecar_path(path: &Path) -> Result<TableViewConfig> {
    let sidecar = sidecar_path(path);
    if !sidecar.exists() {
        return Ok(TableViewConfig::default());
    }
    let text = fs::read_to_string(sidecar)?;
    serde_json::from_str(&text).with_context(|| "failed to parse sidecar config")
}

fn modified_millis(path: &Path) -> u128 {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn preferences_path() -> Result<PathBuf> {
    let dirs = ProjectDirs::from("com", "kamahir0", "LiljaMasterDataEditor")
        .with_context(|| "failed to resolve app config directory")?;
    let dir = dirs.config_dir();
    fs::create_dir_all(dir)?;
    Ok(dir.join("preferences.json"))
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!(
        "{}tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| format!("{value}."))
            .unwrap_or_default()
    ));
    fs::write(&temp, content)?;
    fs::rename(temp, path)?;
    Ok(())
}

fn ok_result(message: &str) -> CommandResult {
    CommandResult {
        ok: true,
        message: message.to_string(),
        diagnostics: Vec::new(),
    }
}

fn failed_result(message: &str, diagnostics: &DiagnosticBag) -> CommandResult {
    CommandResult {
        ok: false,
        message: message.to_string(),
        diagnostics: map_diagnostics(diagnostics),
    }
}

fn map_diagnostics(diagnostics: &DiagnosticBag) -> Vec<EditorDiagnostic> {
    diagnostics
        .items()
        .iter()
        .map(|diagnostic| EditorDiagnostic {
            severity: format!("{:?}", diagnostic.severity).to_ascii_lowercase(),
            code: diagnostic.code.to_string(),
            path: diagnostic.path.clone(),
            message: diagnostic.message.clone(),
        })
        .collect()
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
