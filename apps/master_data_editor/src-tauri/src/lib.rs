use anyhow::{Context, Result};
use directories::ProjectDirs;
use indexmap::IndexMap;
use master_data_core::{
    build_project, clean_project, default_project_config, generate_project, init_project,
    scan_yaml_files, sync_project, validate_project, Definition, DiagnosticBag, InitProjectOptions,
    MasterDataConfig, SourceDefinition, CONFIG_FILE_NAME, TOOL_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, LogicalPosition, Window};

const MENU_OPEN_PROJECT: &str = "file_open_project";
const MENU_NEW_PROJECT: &str = "file_new_project";
const MENU_MASTER_CREATE_PREFIX: &str = "master_create:";
const MENU_MASTER_ENTRY_PREFIX: &str = "master_entry:";
const MENU_TABLE_CREATE_PREFIX: &str = "table_create:";
const MENU_TABLE_COLUMN_PREFIX: &str = "table_column:";
const MENU_TABLE_RECORD_PREFIX: &str = "table_record:";
const EVENT_OPEN_PROJECT: &str = "menu-open-project";
const EVENT_NEW_PROJECT: &str = "menu-new-project";
const EVENT_MASTER_CREATE_ENTRY: &str = "master-create-entry";
const EVENT_MASTER_ENTRY_ACTION: &str = "master-entry-action";
const EVENT_TABLE_CREATE_ENTRY: &str = "table-create-entry";
const EVENT_TABLE_COLUMN_ACTION: &str = "table-column-action";
const EVENT_TABLE_RECORD_ACTION: &str = "table-record-action";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterCreateMenuPayload {
    kind: String,
    directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterEntryMenuPayload {
    action: String,
    kind: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TableCreateMenuPayload {
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TableIndexedMenuPayload {
    action: String,
    index: usize,
}

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
fn request_app_exit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn popup_master_create_menu(
    window: Window,
    directory: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let new_folder = MenuItem::with_id(
        &window,
        format!("master_create_new_folder:{directory}"),
        "New Folder",
        false,
        None::<&str>,
    )
    .map_err(to_string)?;
    let folder = MenuItem::with_id(
        &window,
        format!("{MENU_MASTER_CREATE_PREFIX}folder:{directory}"),
        "Folder",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let new_file = MenuItem::with_id(
        &window,
        format!("master_create_new_file:{directory}"),
        "New File",
        false,
        None::<&str>,
    )
    .map_err(to_string)?;
    let table = MenuItem::with_id(
        &window,
        format!("{MENU_MASTER_CREATE_PREFIX}table:{directory}"),
        "Table",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let enum_file = MenuItem::with_id(
        &window,
        format!("{MENU_MASTER_CREATE_PREFIX}enum:{directory}"),
        "Enum",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let struct_file = MenuItem::with_id(
        &window,
        format!("{MENU_MASTER_CREATE_PREFIX}struct:{directory}"),
        "Struct",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let separator = PredefinedMenuItem::separator(&window).map_err(to_string)?;
    let menu = Menu::with_items(
        &window,
        &[
            &new_folder,
            &folder,
            &separator,
            &new_file,
            &table,
            &enum_file,
            &struct_file,
        ],
    )
    .map_err(to_string)?;
    menu.popup_at(window, LogicalPosition::new(x, y))
        .map_err(to_string)
}

#[tauri::command]
fn popup_master_entry_menu(
    window: Window,
    kind: String,
    path: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let rename = MenuItem::with_id(
        &window,
        format!("{MENU_MASTER_ENTRY_PREFIX}rename:{kind}:{path}"),
        "Rename",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let delete = MenuItem::with_id(
        &window,
        format!("{MENU_MASTER_ENTRY_PREFIX}delete:{kind}:{path}"),
        "Delete",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    if kind == "directory" {
        let new_folder = MenuItem::with_id(
            &window,
            format!("master_create_new_folder:{path}"),
            "New Folder",
            false,
            None::<&str>,
        )
        .map_err(to_string)?;
        let folder = MenuItem::with_id(
            &window,
            format!("{MENU_MASTER_CREATE_PREFIX}folder:{path}"),
            "Folder",
            true,
            None::<&str>,
        )
        .map_err(to_string)?;
        let new_file = MenuItem::with_id(
            &window,
            format!("master_create_new_file:{path}"),
            "New File",
            false,
            None::<&str>,
        )
        .map_err(to_string)?;
        let table = MenuItem::with_id(
            &window,
            format!("{MENU_MASTER_CREATE_PREFIX}table:{path}"),
            "Table",
            true,
            None::<&str>,
        )
        .map_err(to_string)?;
        let enum_file = MenuItem::with_id(
            &window,
            format!("{MENU_MASTER_CREATE_PREFIX}enum:{path}"),
            "Enum",
            true,
            None::<&str>,
        )
        .map_err(to_string)?;
        let struct_file = MenuItem::with_id(
            &window,
            format!("{MENU_MASTER_CREATE_PREFIX}struct:{path}"),
            "Struct",
            true,
            None::<&str>,
        )
        .map_err(to_string)?;
        let separator1 = PredefinedMenuItem::separator(&window).map_err(to_string)?;
        let separator2 = PredefinedMenuItem::separator(&window).map_err(to_string)?;
        let menu = Menu::with_items(
            &window,
            &[
                &new_folder,
                &folder,
                &separator1,
                &new_file,
                &table,
                &enum_file,
                &struct_file,
                &separator2,
                &rename,
                &delete,
            ],
        )
        .map_err(to_string)?;
        return menu
            .popup_at(window, LogicalPosition::new(x, y))
            .map_err(to_string);
    }

    let menu = Menu::with_items(&window, &[&rename, &delete]).map_err(to_string)?;
    menu.popup_at(window, LogicalPosition::new(x, y))
        .map_err(to_string)
}

#[tauri::command]
fn popup_table_create_menu(window: Window, x: f64, y: f64) -> Result<(), String> {
    let field = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_CREATE_PREFIX}field"),
        "Field",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let record = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_CREATE_PREFIX}record"),
        "Record",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let menu = Menu::with_items(&window, &[&field, &record]).map_err(to_string)?;
    menu.popup_at(window, LogicalPosition::new(x, y))
        .map_err(to_string)
}

#[tauri::command]
fn popup_table_column_menu(
    window: Window,
    index: usize,
    can_move_left: bool,
    can_move_right: bool,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let move_left = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}move_left:{index}"),
        "Move Left",
        can_move_left,
        None::<&str>,
    )
    .map_err(to_string)?;
    let move_right = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}move_right:{index}"),
        "Move Right",
        can_move_right,
        None::<&str>,
    )
    .map_err(to_string)?;
    let move_first = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}move_first:{index}"),
        "Move to First",
        can_move_left,
        None::<&str>,
    )
    .map_err(to_string)?;
    let move_last = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}move_last:{index}"),
        "Move to Last",
        can_move_right,
        None::<&str>,
    )
    .map_err(to_string)?;
    let insert_left = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}insert_left:{index}"),
        "Insert Field Left",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let insert_right = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}insert_right:{index}"),
        "Insert Field Right",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let duplicate = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}duplicate:{index}"),
        "Duplicate Field",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let delete = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}delete:{index}"),
        "Delete Field",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let edit_key = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_COLUMN_PREFIX}edit_key:{index}"),
        "Advanced: Edit MessagePack Key",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let separator1 = PredefinedMenuItem::separator(&window).map_err(to_string)?;
    let separator2 = PredefinedMenuItem::separator(&window).map_err(to_string)?;
    let menu = Menu::with_items(
        &window,
        &[
            &move_left,
            &move_right,
            &move_first,
            &move_last,
            &separator1,
            &insert_left,
            &insert_right,
            &duplicate,
            &delete,
            &separator2,
            &edit_key,
        ],
    )
    .map_err(to_string)?;
    menu.popup_at(window, LogicalPosition::new(x, y))
        .map_err(to_string)
}

#[tauri::command]
fn popup_table_record_menu(
    window: Window,
    index: usize,
    can_paste: bool,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let copy = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_RECORD_PREFIX}copy:{index}"),
        "Copy Record",
        true,
        None::<&str>,
    )
    .map_err(to_string)?;
    let paste = MenuItem::with_id(
        &window,
        format!("{MENU_TABLE_RECORD_PREFIX}paste:{index}"),
        "Paste Record",
        can_paste,
        None::<&str>,
    )
    .map_err(to_string)?;
    let menu = Menu::with_items(&window, &[&copy, &paste]).map_err(to_string)?;
    menu.popup_at(window, LogicalPosition::new(x, y))
        .map_err(to_string)
}

#[tauri::command]
fn open_project(path: String) -> Result<ProjectSnapshot, String> {
    load_project_snapshot(resolve_project_root(PathBuf::from(path)).map_err(to_string)?)
        .map_err(to_string)
}

#[tauri::command]
fn create_editor_project(project_root: String) -> Result<ProjectSnapshot, String> {
    let root = resolve_new_project_root(PathBuf::from(project_root)).map_err(to_string)?;
    init_project(
        &root,
        &InitProjectOptions {
            config: default_project_config(TOOL_VERSION),
            force: false,
            create_converter_dir: true,
        },
    )
    .map_err(to_string)?;
    load_project_snapshot(root).map_err(to_string)
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
        .menu(|app| {
            let menu = Menu::default(app)?;
            let new_project = MenuItem::with_id(
                app,
                MENU_NEW_PROJECT,
                "New Project...",
                true,
                Some("CmdOrCtrl+N"),
            )?;
            let open_project = MenuItem::with_id(
                app,
                MENU_OPEN_PROJECT,
                "Open Project...",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            for item in menu.items()? {
                let Some(submenu) = item.as_submenu() else {
                    continue;
                };
                if submenu.text()? == "File" {
                    submenu.prepend_items(&[&new_project, &open_project, &separator])?;
                    break;
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == MENU_NEW_PROJECT {
                let _ = app.emit(EVENT_NEW_PROJECT, ());
                return;
            }
            if event.id() == MENU_OPEN_PROJECT {
                let _ = app.emit(EVENT_OPEN_PROJECT, ());
                return;
            }
            let id = event.id().as_ref();
            if let Some(payload) = id.strip_prefix(MENU_MASTER_CREATE_PREFIX) {
                let mut parts = payload.splitn(2, ':');
                let kind = parts.next().unwrap_or_default();
                let directory = parts.next().unwrap_or_default();
                let _ = app.emit(
                    EVENT_MASTER_CREATE_ENTRY,
                    MasterCreateMenuPayload {
                        kind: kind.to_string(),
                        directory: directory.to_string(),
                    },
                );
                return;
            }
            if let Some(payload) = id.strip_prefix(MENU_MASTER_ENTRY_PREFIX) {
                let mut parts = payload.splitn(3, ':');
                let action = parts.next().unwrap_or_default();
                let kind = parts.next().unwrap_or_default();
                let path = parts.next().unwrap_or_default();
                let _ = app.emit(
                    EVENT_MASTER_ENTRY_ACTION,
                    MasterEntryMenuPayload {
                        action: action.to_string(),
                        kind: kind.to_string(),
                        path: path.to_string(),
                    },
                );
                return;
            }
            if let Some(kind) = id.strip_prefix(MENU_TABLE_CREATE_PREFIX) {
                let _ = app.emit(
                    EVENT_TABLE_CREATE_ENTRY,
                    TableCreateMenuPayload {
                        kind: kind.to_string(),
                    },
                );
                return;
            }
            if let Some(payload) = id.strip_prefix(MENU_TABLE_COLUMN_PREFIX) {
                let mut parts = payload.splitn(2, ':');
                let action = parts.next().unwrap_or_default();
                let index = parts
                    .next()
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or_default();
                let _ = app.emit(
                    EVENT_TABLE_COLUMN_ACTION,
                    TableIndexedMenuPayload {
                        action: action.to_string(),
                        index,
                    },
                );
                return;
            }
            if let Some(payload) = id.strip_prefix(MENU_TABLE_RECORD_PREFIX) {
                let mut parts = payload.splitn(2, ':');
                let action = parts.next().unwrap_or_default();
                let index = parts
                    .next()
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or_default();
                let _ = app.emit(
                    EVENT_TABLE_RECORD_ACTION,
                    TableIndexedMenuPayload {
                        action: action.to_string(),
                        index,
                    },
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            request_app_exit,
            popup_master_create_menu,
            popup_master_entry_menu,
            popup_table_create_menu,
            popup_table_column_menu,
            popup_table_record_menu,
            create_editor_project,
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

fn resolve_new_project_root(path: PathBuf) -> Result<PathBuf> {
    if path.exists() {
        let root = canonicalize_existing(path)?;
        if root.join(CONFIG_FILE_NAME).exists() {
            anyhow::bail!("{} already exists", root.join(CONFIG_FILE_NAME).display());
        }
        return Ok(root);
    }

    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let parent = canonicalize_existing(parent)?;
    let file_name = path
        .file_name()
        .with_context(|| format!("invalid project path: {}", path.display()))?;
    Ok(parent.join(file_name))
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
