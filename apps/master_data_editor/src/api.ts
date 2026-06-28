import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  Definition,
  DefinitionDocument,
  EditorPreferences,
  MasterDataConfig,
  ProjectSnapshot,
  TableViewConfig
} from "./types";

export const api = {
  openProject(path: string) {
    return invoke<ProjectSnapshot>("open_project", { path });
  },
  createProject(projectRoot: string) {
    return invoke<ProjectSnapshot>("create_editor_project", { projectRoot });
  },
  reloadProject(projectRoot: string) {
    return invoke<ProjectSnapshot>("reload_project", { projectRoot });
  },
  validateProject(projectRoot: string, profile?: string) {
    return invoke<CommandResult>("validate_editor_project", { projectRoot, profile });
  },
  generateProject(projectRoot: string) {
    return invoke<CommandResult>("generate_editor_project", { projectRoot });
  },
  buildProject(projectRoot: string, profile?: string) {
    return invoke<CommandResult>("build_editor_project", { projectRoot, profile });
  },
  syncProject(projectRoot: string, init = false) {
    return invoke<CommandResult>("sync_editor_project", { projectRoot, init });
  },
  cleanProject(projectRoot: string) {
    return invoke<CommandResult>("clean_editor_project", { projectRoot });
  },
  saveDefinition(projectRoot: string, relativePath: string, definition: Definition) {
    return invoke<DefinitionDocument>("save_definition", {
      projectRoot,
      relativePath,
      definition
    });
  },
  saveProjectSettings(projectRoot: string, config: MasterDataConfig) {
    return invoke<ProjectSnapshot>("save_project_settings", { projectRoot, config });
  },
  createDefinition(projectRoot: string, relativePath: string, definition: Definition) {
    return invoke<DefinitionDocument>("create_definition", {
      projectRoot,
      relativePath,
      definition
    });
  },
  createDirectory(projectRoot: string, relativePath: string) {
    return invoke<void>("create_directory", { projectRoot, relativePath });
  },
  renameEntry(projectRoot: string, from: string, to: string) {
    return invoke<void>("rename_entry", { projectRoot, from, to });
  },
  moveEntry(projectRoot: string, from: string, to: string) {
    return invoke<void>("move_entry", { projectRoot, from, to });
  },
  deleteEntry(projectRoot: string, relativePath: string) {
    return invoke<void>("delete_entry", { projectRoot, relativePath });
  },
  readSidecar(projectRoot: string, relativePath: string) {
    return invoke<TableViewConfig>("read_sidecar", { projectRoot, relativePath });
  },
  writeSidecar(projectRoot: string, relativePath: string, config: TableViewConfig) {
    return invoke<void>("write_sidecar", { projectRoot, relativePath, config });
  },
  getPreferences() {
    return invoke<EditorPreferences>("get_preferences");
  },
  savePreferences(preferences: EditorPreferences) {
    return invoke<void>("save_preferences", { preferences });
  }
};
