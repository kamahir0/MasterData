import { enablePatches, applyPatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import { api } from "./api";
import type {
  CommandResult,
  Definition,
  DefinitionDocument,
  EditorDiagnostic,
  ActiveView,
  MasterDataConfig,
  MasterValue,
  BottomPanelTab,
  ProjectSnapshot,
  TagFilter
} from "./types";

enablePatches();

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  group?: string;
}

interface DocumentUpdateOptions {
  historyGroup?: string;
}

type FileHistoryEntry =
  | {
      label: string;
      redo: { kind: "create"; path: string; definition: Definition };
      undo: { kind: "delete"; path: string };
    }
  | {
      label: string;
      redo: { kind: "delete"; path: string };
      undo: { kind: "create"; path: string; definition: Definition };
    }
  | {
      label: string;
      redo: { kind: "move"; from: string; to: string };
      undo: { kind: "move"; from: string; to: string };
    };

interface EditorState {
  project?: ProjectSnapshot;
  projectSettingsDraft?: MasterDataConfig;
  projectSettingsDirty: boolean;
  documents: Record<string, DefinitionDocument>;
  activePath?: string;
  activeView: ActiveView;
  dirty: Record<string, boolean>;
  undoStacks: Record<string, HistoryEntry[]>;
  redoStacks: Record<string, HistoryEntry[]>;
  projectUndoStack: FileHistoryEntry[];
  projectRedoStack: FileHistoryEntry[];
  diagnostics: EditorDiagnostic[];
  buildLog: string[];
  tagFilter: TagFilter;
  profilePreview?: string;
  theme: string;
  zoom: number;
  gridFontSize: number;
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  bottomPanelHeight: number;
  bottomPanelActiveTab: BottomPanelTab;
  recentProjects: string[];
  projectPathInput: string;
  isBusy: boolean;
  error?: string;
  loadPreferences: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  createProject: (path: string) => Promise<void>;
  reloadProject: (activePath?: string) => Promise<void>;
  setActivePath: (path: string) => void;
  setActiveView: (view: ActiveView) => void;
  updateProjectSettings: (label: string, recipe: (config: MasterDataConfig) => void) => void;
  saveProjectSettings: () => Promise<void>;
  updateDocument: (
    path: string,
    label: string,
    recipe: (document: DefinitionDocument) => void,
    options?: DocumentUpdateOptions
  ) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  createDirectory: (relativePath: string) => Promise<void>;
  createDefinition: (kind: "table" | "enum" | "struct", relativePath: string) => Promise<void>;
  renameEntry: (from: string, to: string) => Promise<void>;
  moveEntry: (from: string, to: string) => Promise<void>;
  movePath: (from: string, to: string) => Promise<void>;
  duplicateEntry: (from: string, to: string) => Promise<void>;
  deleteEntry: (relativePath: string) => Promise<void>;
  saveActive: () => Promise<void>;
  validate: () => Promise<void>;
  build: () => Promise<void>;
  generate: () => Promise<void>;
  sync: () => Promise<void>;
  clean: () => Promise<void>;
  setProjectPathInput: (path: string) => void;
  setTagFilter: (filter: Partial<TagFilter>) => void;
  setProfilePreview: (profile?: string) => void;
  setTheme: (theme: string) => void;
  setGridFontSize: (fontSize: number) => void;
  setZoom: (zoom: number) => void;
  setSidebarVisible: (visible: boolean) => void;
  setBottomPanelVisible: (visible: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  setBottomPanelActiveTab: (tab: BottomPanelTab) => void;
  openDiagnostic: (diagnostic: EditorDiagnostic) => void;
  updateCell: (path: string, rowIndex: number, fieldName: string, value: MasterValue, options?: DocumentUpdateOptions) => void;
  addRow: (path: string) => void;
  deleteRow: (path: string, rowIndex: number) => void;
}

const defaultTagFilter: TagFilter = {
  include: [],
  exclude: [],
  showUntagged: true
};

export const useEditorStore = create<EditorState>((set, get) => ({
  projectSettingsDirty: false,
  documents: {},
  activeView: "document",
  dirty: {},
  undoStacks: {},
  redoStacks: {},
  projectUndoStack: [],
  projectRedoStack: [],
  diagnostics: [],
  buildLog: [],
  tagFilter: defaultTagFilter,
  theme: "system",
  zoom: 1,
  gridFontSize: 13,
  sidebarVisible: true,
  bottomPanelVisible: false,
  bottomPanelHeight: 160,
  bottomPanelActiveTab: "problems",
  recentProjects: [],
  projectPathInput: "",
  isBusy: false,
  async loadPreferences() {
    try {
      const preferences = await api.getPreferences();
      set({
        theme: normalizeTheme(preferences.theme),
        zoom: preferences.zoom ?? 1,
        gridFontSize: preferences.gridFontSize ?? 13,
        sidebarVisible: preferences.sidebarVisible ?? true,
        bottomPanelVisible: preferences.bottomPanelVisible ?? false,
        bottomPanelHeight: preferences.bottomPanelHeight ?? 160,
        bottomPanelActiveTab: preferences.bottomPanelActiveTab ?? "problems",
        recentProjects: preferences.recentProjects ?? [],
        projectPathInput: preferences.recentProjects?.[0] ?? ""
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  async openProject(path) {
    set({ isBusy: true, error: undefined });
    try {
      const project = await api.openProject(path);
      const documents = Object.fromEntries(project.documents.map((doc) => [doc.relativePath, doc]));
      const recentProjects = mergeRecentProjects(project.root, get().recentProjects);
      set({
        project,
        projectSettingsDraft: cloneConfig(project.config),
        projectSettingsDirty: false,
        documents,
        diagnostics: project.diagnostics,
        activeView: "document",
        activePath: project.documents[0]?.relativePath,
        dirty: {},
        undoStacks: {},
        redoStacks: {},
        projectPathInput: project.root,
        recentProjects,
        buildLog: [`Opened ${project.root}`]
      });
      void persistPreferences();
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ isBusy: false });
    }
  },
  async createProject(path) {
    set({ isBusy: true, error: undefined });
    try {
      const project = await api.createProject(path);
      const documents = Object.fromEntries(project.documents.map((doc) => [doc.relativePath, doc]));
      const recentProjects = mergeRecentProjects(project.root, get().recentProjects);
      set({
        project,
        projectSettingsDraft: cloneConfig(project.config),
        projectSettingsDirty: false,
        documents,
        diagnostics: project.diagnostics,
        activeView: "projectSettings",
        activePath: project.documents[0]?.relativePath,
        dirty: {},
        undoStacks: {},
        redoStacks: {},
        projectPathInput: project.root,
        recentProjects,
        buildLog: [`Created ${project.root}`]
      });
      void persistPreferences();
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ isBusy: false });
    }
  },
  async reloadProject(activePath) {
    const project = get().project;
    if (!project) return;
    set({ isBusy: true, error: undefined });
    try {
      const nextProject = await api.reloadProject(project.root);
      const documents = Object.fromEntries(nextProject.documents.map((doc) => [doc.relativePath, doc]));
      const nextActivePath =
        activePath && documents[activePath]
          ? activePath
          : get().activePath && documents[get().activePath!]
            ? get().activePath
            : nextProject.documents[0]?.relativePath;
      set({
        project: nextProject,
        projectSettingsDraft: cloneConfig(nextProject.config),
        projectSettingsDirty: false,
        documents,
        diagnostics: nextProject.diagnostics,
        activePath: nextActivePath,
        dirty: {},
        undoStacks: {},
        redoStacks: {}
      });
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ isBusy: false });
    }
  },
  setActivePath(path) {
    set({ activePath: path, activeView: "document" });
  },
  setActiveView(view) {
    set({ activeView: view });
  },
  updateProjectSettings(_label, recipe) {
    const current = get().projectSettingsDraft;
    if (!current) return;
    const [next] = produceWithPatches(current, recipe);
    set({ projectSettingsDraft: next, projectSettingsDirty: true });
  },
  async saveProjectSettings() {
    const project = get().project;
    const config = get().projectSettingsDraft;
    if (!project || !config) return;
    set({ isBusy: true, error: undefined });
    try {
      const nextProject = await api.saveProjectSettings(project.root, config);
      const documents = Object.fromEntries(nextProject.documents.map((doc) => [doc.relativePath, doc]));
      set((state) => ({
        project: nextProject,
        projectSettingsDraft: cloneConfig(nextProject.config),
        projectSettingsDirty: false,
        documents,
        diagnostics: nextProject.diagnostics,
        activePath: state.activePath && documents[state.activePath] ? state.activePath : nextProject.documents[0]?.relativePath,
        buildLog: [...state.buildLog, "Saved project-settings.yaml"]
      }));
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ isBusy: false });
    }
  },
  updateDocument(path, label, recipe, options) {
    const current = get().documents[path];
    if (!current) return;
    const [next, patches, inversePatches] = produceWithPatches(current, recipe);
    if (patches.length === 0) return;
    set((state) => ({
      documents: { ...state.documents, [path]: next },
      dirty: { ...state.dirty, [path]: true },
      undoStacks: {
        ...state.undoStacks,
        [path]: appendHistoryEntry(state.undoStacks[path] ?? [], {
          label,
          patches,
          inversePatches,
          group: options?.historyGroup
        })
      },
      redoStacks: { ...state.redoStacks, [path]: [] }
    }));
  },
  async undo() {
    const path = get().activePath;
    if (path) {
      const stack = get().undoStacks[path] ?? [];
      const entry = stack.at(-1);
      const current = get().documents[path];
      if (entry && current) {
        const next = applyPatches(current, entry.inversePatches) as DefinitionDocument;
        set((state) => ({
          documents: { ...state.documents, [path]: next },
          dirty: { ...state.dirty, [path]: true },
          undoStacks: { ...state.undoStacks, [path]: stack.slice(0, -1) },
          redoStacks: {
            ...state.redoStacks,
            [path]: [...(state.redoStacks[path] ?? []), entry]
          }
        }));
        return;
      }
    }
    const projectEntry = get().projectUndoStack.at(-1);
    if (!projectEntry) return;
    await applyFileOperation(projectEntry.undo);
    set((state) => ({
      projectUndoStack: state.projectUndoStack.slice(0, -1),
      projectRedoStack: [...state.projectRedoStack, projectEntry]
    }));
    const activeAfterUndo = projectEntry.undo.kind === "create" ? projectEntry.undo.path : undefined;
    await get().reloadProject(activeAfterUndo);
  },
  async redo() {
    const path = get().activePath;
    if (path) {
      const stack = get().redoStacks[path] ?? [];
      const entry = stack.at(-1);
      const current = get().documents[path];
      if (entry && current) {
        const next = applyPatches(current, entry.patches) as DefinitionDocument;
        set((state) => ({
          documents: { ...state.documents, [path]: next },
          dirty: { ...state.dirty, [path]: true },
          redoStacks: { ...state.redoStacks, [path]: stack.slice(0, -1) },
          undoStacks: {
            ...state.undoStacks,
            [path]: [...(state.undoStacks[path] ?? []), entry]
          }
        }));
        return;
      }
    }
    const projectEntry = get().projectRedoStack.at(-1);
    if (!projectEntry) return;
    await applyFileOperation(projectEntry.redo);
    set((state) => ({
      projectRedoStack: state.projectRedoStack.slice(0, -1),
      projectUndoStack: [...state.projectUndoStack, projectEntry]
    }));
    const activeAfterRedo =
      projectEntry.redo.kind === "create"
        ? projectEntry.redo.path
        : projectEntry.redo.kind === "move"
          ? projectEntry.redo.to
          : undefined;
    await get().reloadProject(activeAfterRedo);
  },
  async createDirectory(relativePath) {
    const project = get().project;
    if (!project) return;
    const path = normalizeRelativePath(relativePath);
    if (!path) return;
    ensureTargetDoesNotExist(path);
    set({ isBusy: true, error: undefined });
    try {
      await api.createDirectory(project.root, path);
      set((state) => ({ buildLog: [...state.buildLog, `Create folder ${path}`] }));
      await get().reloadProject();
    } catch (error) {
      set((state) => ({
        error: String(error),
        buildLog: [...state.buildLog, `Create folder ${path}: ${String(error)}`]
      }));
    } finally {
      set({ isBusy: false });
    }
  },
  async createDefinition(kind, relativePath) {
    const project = get().project;
    if (!project) return;
    const path = normalizeRelativeYamlPath(relativePath);
    const definition = createDefaultDefinition(kind, path);
    await runFileTransaction({
      label: `Create ${path}`,
      redo: { kind: "create", path, definition },
      undo: { kind: "delete", path }
    });
    await get().reloadProject(path);
  },
  async renameEntry(from, to) {
    await get().moveEntry(from, to);
  },
  async moveEntry(from, to) {
    const nextPath = normalizeRelativeYamlPath(to);
    if (from === nextPath) return;
    ensureFileCanMove(from, nextPath);
    await runFileTransaction({
      label: `Move ${from}`,
      redo: { kind: "move", from, to: nextPath },
      undo: { kind: "move", from: nextPath, to: from }
    });
    await get().reloadProject(nextPath);
  },
  async movePath(from, to) {
    const sourcePath = normalizeRelativePath(from);
    const nextPath = normalizeRelativePath(to);
    if (!sourcePath || !nextPath || sourcePath === nextPath) return;
    ensurePathCanMove(sourcePath, nextPath);
    const activePath = get().activePath;
    const activeAfterMove = remapMovedPath(activePath, sourcePath, nextPath);
    await runFileTransaction({
      label: `Move ${sourcePath}`,
      redo: { kind: "move", from: sourcePath, to: nextPath },
      undo: { kind: "move", from: nextPath, to: sourcePath }
    });
    await get().reloadProject(activeAfterMove);
  },
  async duplicateEntry(from, to) {
    const source = get().documents[from];
    if (!source) return;
    const nextPath = normalizeRelativeYamlPath(to);
    ensureTargetDoesNotExist(nextPath);
    const definition = cloneDefinition(source.definition);
    await runFileTransaction({
      label: `Duplicate ${from}`,
      redo: { kind: "create", path: nextPath, definition },
      undo: { kind: "delete", path: nextPath }
    });
    await get().reloadProject(nextPath);
  },
  async deleteEntry(relativePath) {
    const source = get().documents[relativePath];
    if (!source) {
      const project = get().project;
      const path = normalizeRelativePath(relativePath);
      if (!project || !path) return;
      ensurePathIsClean(path);
      set({ isBusy: true, error: undefined });
      try {
        await api.deleteEntry(project.root, path);
        set((state) => ({ buildLog: [...state.buildLog, `Delete ${path}`] }));
        await get().reloadProject();
      } catch (error) {
        set((state) => ({
          error: String(error),
          buildLog: [...state.buildLog, `Delete ${path}: ${String(error)}`]
        }));
      } finally {
        set({ isBusy: false });
      }
      return;
    }
    ensureFileIsClean(relativePath);
    const definition = cloneDefinition(source.definition);
    await runFileTransaction({
      label: `Delete ${relativePath}`,
      redo: { kind: "delete", path: relativePath },
      undo: { kind: "create", path: relativePath, definition }
    });
    await get().reloadProject();
  },
  async saveActive() {
    if (get().activeView === "projectSettings") {
      await get().saveProjectSettings();
      return;
    }
    const path = get().activePath;
    const project = get().project;
    if (!path || !project) return;
    const document = get().documents[path];
    if (!document) return;
    set({ isBusy: true, error: undefined });
    try {
      const saved = await api.saveDefinition(project.root, path, document.definition);
      set((state) => ({
        documents: { ...state.documents, [path]: saved },
        dirty: { ...state.dirty, [path]: false },
        buildLog: [...state.buildLog, `Saved ${path}`]
      }));
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ isBusy: false });
    }
  },
  async validate() {
    const project = get().project;
    if (!project) return;
    await runCommand("validate", () => api.validateProject(project.root, get().profilePreview));
  },
  async build() {
    const project = get().project;
    if (!project) return;
    await runCommand("build", () => api.buildProject(project.root, get().profilePreview));
  },
  async generate() {
    const project = get().project;
    if (!project) return;
    await runCommand("generate", () => api.generateProject(project.root));
  },
  async sync() {
    const project = get().project;
    if (!project) return;
    await runCommand("sync", () => api.syncProject(project.root, true));
  },
  async clean() {
    const project = get().project;
    if (!project) return;
    await runCommand("clean", () => api.cleanProject(project.root));
  },
  setProjectPathInput(path) {
    set({ projectPathInput: path });
  },
  setTagFilter(filter) {
    set((state) => ({ tagFilter: { ...state.tagFilter, ...filter } }));
  },
  setProfilePreview(profile) {
    set({ profilePreview: profile || undefined });
  },
  setTheme(theme) {
    set({ theme: normalizeTheme(theme) });
    void persistPreferences();
  },
  setGridFontSize(fontSize) {
    set({ gridFontSize: Math.round(Math.max(10, Math.min(22, fontSize))) });
    void persistPreferences();
  },
  setZoom(zoom) {
    set({ zoom: Math.min(1.8, Math.max(0.75, zoom)) });
    void persistPreferences();
  },
  setSidebarVisible(visible) {
    set({ sidebarVisible: visible });
    void persistPreferences();
  },
  setBottomPanelVisible(visible) {
    set({ bottomPanelVisible: visible });
    void persistPreferences();
  },
  setBottomPanelHeight(height) {
    set({ bottomPanelHeight: Math.round(Math.max(96, Math.min(window.innerHeight * 0.45, height))) });
    void persistPreferences();
  },
  setBottomPanelActiveTab(tab) {
    set({ bottomPanelActiveTab: tab });
    void persistPreferences();
  },
  openDiagnostic(diagnostic) {
    const relativePath = relativePathForDiagnostic(diagnostic);
    if (!relativePath) return;
    set({
      activePath: relativePath,
      sidebarVisible: true,
      bottomPanelVisible: true,
      bottomPanelActiveTab: "problems"
    });
    void persistPreferences();
  },
  updateCell(path, rowIndex, fieldName, value, options) {
    get().updateDocument(path, `Edit ${fieldName}`, (document) => {
      if (document.definition.kind !== "table") return;
      document.definition.rows[rowIndex].data[fieldName] = value;
    }, options);
  },
  addRow(path) {
    get().updateDocument(path, "Add Record", (document) => {
      if (document.definition.kind !== "table") return;
      const data: Record<string, MasterValue> = {};
      for (const field of document.definition.fields) {
        data[field.name] = defaultValueForType(field.type);
      }
      document.definition.rows.push({ data });
    });
  },
  deleteRow(path, rowIndex) {
    get().updateDocument(path, "Delete Record", (document) => {
      if (document.definition.kind !== "table") return;
      document.definition.rows.splice(rowIndex, 1);
    });
  }
}));

async function runCommand(label: string, command: () => Promise<CommandResult>) {
  useEditorStore.setState({ isBusy: true, error: undefined });
  try {
    const result = await command();
    useEditorStore.setState((state) => ({
      diagnostics: result.diagnostics,
      buildLog: [...state.buildLog, `${label}: ${result.message}`],
      bottomPanelVisible: true,
      bottomPanelActiveTab: result.diagnostics.length > 0 ? "problems" : "buildLog"
    }));
  } catch (error) {
    useEditorStore.setState((state) => ({
      error: String(error),
      buildLog: [...state.buildLog, `${label}: ${String(error)}`],
      bottomPanelVisible: true,
      bottomPanelActiveTab: "buildLog"
    }));
  } finally {
    useEditorStore.setState({ isBusy: false });
    void persistPreferences();
  }
}

function appendHistoryEntry(stack: HistoryEntry[], entry: HistoryEntry) {
  const last = stack.at(-1);
  if (!entry.group || !last || last.group !== entry.group) {
    return [...stack, entry];
  }
  return [
    ...stack.slice(0, -1),
    {
      label: entry.label,
      group: entry.group,
      patches: [...last.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...last.inversePatches]
    }
  ];
}

async function persistPreferences() {
  const state = useEditorStore.getState();
  try {
    await api.savePreferences({
      recentProjects: state.recentProjects,
      theme: state.theme,
      zoom: state.zoom,
      gridFontSize: state.gridFontSize,
      defaultProfile: state.profilePreview,
      sidebarVisible: state.sidebarVisible,
      bottomPanelVisible: state.bottomPanelVisible,
      bottomPanelHeight: state.bottomPanelHeight,
      bottomPanelActiveTab: state.bottomPanelActiveTab
    });
  } catch {
    // Preference writes should not interrupt editing.
  }
}

function normalizeTheme(theme: string | undefined) {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

async function runFileTransaction(entry: FileHistoryEntry) {
  useEditorStore.setState({ isBusy: true, error: undefined });
  try {
    await applyFileOperation(entry.redo);
    useEditorStore.setState((state) => ({
      projectUndoStack: [...state.projectUndoStack, entry],
      projectRedoStack: [],
      buildLog: [...state.buildLog, entry.label]
    }));
  } catch (error) {
    useEditorStore.setState((state) => ({
      error: String(error),
      buildLog: [...state.buildLog, `${entry.label}: ${String(error)}`]
    }));
    throw error;
  } finally {
    useEditorStore.setState({ isBusy: false });
  }
}

async function applyFileOperation(operation: FileHistoryEntry["redo"] | FileHistoryEntry["undo"]) {
  const project = useEditorStore.getState().project;
  if (!project) return;
  if (operation.kind === "create") {
    await api.createDefinition(project.root, operation.path, operation.definition);
    return;
  }
  if (operation.kind === "delete") {
    await api.deleteEntry(project.root, operation.path);
    return;
  }
  await api.moveEntry(project.root, operation.from, operation.to);
}

function ensureFileCanMove(from: string, to: string) {
  ensureFileIsClean(from);
  ensureTargetDoesNotExist(to);
}

function ensurePathCanMove(from: string, to: string) {
  ensurePathIsClean(from);
  ensureTargetDoesNotExist(to);
  if (to.startsWith(`${from}/`)) {
    throw new Error(`Cannot move ${from} into itself.`);
  }
}

function ensureFileIsClean(path: string) {
  if (useEditorStore.getState().dirty[path]) {
    throw new Error(`Save ${path} before changing files.`);
  }
}

function ensurePathIsClean(path: string) {
  const dirty = useEditorStore.getState().dirty;
  const hasDirtyChild = Object.keys(dirty).some((dirtyPath) => dirty[dirtyPath] && isSameOrChildPath(dirtyPath, path));
  if (hasDirtyChild) {
    throw new Error(`Save files under ${path} before moving them.`);
  }
}

function ensureTargetDoesNotExist(path: string) {
  const normalized = normalizeRelativePath(path);
  const project = useEditorStore.getState().project;
  const fileExists = project?.files.some((file) => isSameOrChildPath(file.relativePath, normalized));
  const directoryExists = project?.directories.some((directory) => isSameOrChildPath(directory.relativePath, normalized));
  const exists = fileExists || directoryExists;
  if (exists) throw new Error(`${path} already exists.`);
}

function normalizeRelativePath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeRelativeYamlPath(path: string) {
  const normalized = normalizeRelativePath(path);
  if (!normalized.endsWith(".yaml") && !normalized.endsWith(".yml")) return `${normalized}.yaml`;
  return normalized;
}

function isSameOrChildPath(candidate: string, parent: string) {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function remapMovedPath(path: string | undefined, from: string, to: string) {
  if (!path || !isSameOrChildPath(path, from)) return path;
  return `${to}${path.slice(from.length)}`;
}

function relativePathForDiagnostic(diagnostic: EditorDiagnostic) {
  if (!diagnostic.path) return undefined;
  const project = useEditorStore.getState().project;
  if (!project) return undefined;
  const normalizedPath = diagnostic.path.replaceAll("\\", "/");
  const file = project.files.find((entry) => {
    const absolute = entry.path.replaceAll("\\", "/");
    const relative = entry.relativePath.replaceAll("\\", "/");
    return absolute === normalizedPath || relative === normalizedPath || normalizedPath.endsWith(`/${relative}`);
  });
  return file?.relativePath;
}

function mergeRecentProjects(projectRoot: string, previous: string[]) {
  return [projectRoot, ...previous.filter((path) => path !== projectRoot)].slice(0, 12);
}

function cloneConfig(config: MasterDataConfig): MasterDataConfig {
  return JSON.parse(JSON.stringify(config)) as MasterDataConfig;
}

function createDefaultDefinition(kind: "table" | "enum" | "struct", path: string): Definition {
  const baseName = pascalCase(path.split("/").at(-1)?.replace(/\.(ya?ml)$/i, "") ?? "NewMaster");
  if (kind === "enum") return { kind, name: baseName, members: [] };
  if (kind === "struct") return { kind, name: baseName, fields: [] };
  const table = baseName.endsWith("Master") ? baseName.slice(0, -"Master".length) : baseName;
  return {
    kind,
    table,
    typeName: `${table}Master`,
    keys: { primary: { fields: ["Id"] } },
    fields: [
      { name: "Id", type: "int", fixedIndex: 0 },
      { name: "Name", type: "string", fixedIndex: 1 }
    ],
    rows: []
  };
}

function pascalCase(value: string) {
  const converted = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return converted || "NewMaster";
}

function cloneDefinition(definition: Definition): Definition {
  return JSON.parse(JSON.stringify(definition)) as Definition;
}

function defaultValueForType(type: string): MasterValue {
  if (type === "bool") return false;
  if (type === "int" || type === "long" || type === "float" || type === "double") return 0;
  if (type.startsWith("list<")) return [];
  return "";
}

export function coerceValue(type: string, raw: string): MasterValue {
  if (type === "bool") return raw === "true" || raw === "1";
  if (type === "int" || type === "long") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (type === "float" || type === "double") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (type.startsWith("list<")) {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return raw;
}
