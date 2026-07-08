import {
  AlertCircle,
  CheckCircle2,
  Database,
  FolderPlus,
  FolderOpen,
  History,
  Hammer,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  Play,
  Redo2,
  RotateCcw,
  Save,
  SaveAll,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { BottomPanel, StatusStrip } from "./BottomPanel";
import { EditorHost } from "./EditorHost";
import { FileExplorer } from "./FileExplorer";

const BASE_GRID_ROW_HEIGHT = 34;
const BASE_GRID_HEADER_HEIGHT = 92;
const BASE_GRID_INPUT_HEIGHT = 26;
type UnsavedChangesAction = "saveAll" | "discard" | "cancel";

export function AppShell() {
  const allowCloseRef = useRef(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const {
    activePath,
    activeView,
    bottomPanelHeight,
    bottomPanelVisible,
    build,
    clean,
    closeProject,
    createProject,
    dirty,
    error,
    generate,
    gridFontSize,
    isBusy,
    loadPreferences,
    openProject,
    project,
    projectSettingsDirty,
    redo,
    recentProjects,
    removeRecentProject,
    saveActive,
    saveAll,
    setBottomPanelVisible,
    setActiveView,
    setSidebarVisible,
    sidebarVisible,
    sync,
    theme,
    undo,
    validate,
    zoom,
    setZoom
  } = useEditorStore();
  const canSave =
    activeView === "projectSettings" ? projectSettingsDirty : activeView === "document" && Boolean(activePath && dirty[activePath]);
  const hasUnsavedChanges = projectSettingsDirty || Object.values(dirty).some(Boolean);
  const canSaveAll = hasUnsavedChanges;

  const chooseProjectSettingsFile = useCallback(async () => {
    try {
      const selected = await open({
        directory: false,
        filters: [{ name: "MasterData Project Settings", extensions: ["yaml", "yml"] }],
        multiple: false,
        title: "Open project-settings.yaml"
      });
      if (typeof selected === "string") {
        await openProject(selected);
        return;
      }
    } catch {
      const path = window.prompt("project-settings.yaml path");
      if (path) await openProject(path);
    }
  }, [openProject]);

  const chooseNewProjectDirectory = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Create MasterData Project"
      });
      if (typeof selected === "string") {
        await createProject(selected);
        return;
      }
    } catch {
      const path = window.prompt("New project directory");
      if (path) await createProject(path);
    }
  }, [createProject]);

  const chooseUnsavedChangesAction = useCallback(async (): Promise<UnsavedChangesAction> => {
    if (!hasUnsavedChanges) return "discard";
    if ("__TAURI_INTERNALS__" in window) {
      const result = await message("Save all changes before closing?", {
        title: "Unsaved Changes",
        kind: "warning",
        buttons: {
          yes: "Save All",
          no: "Discard",
          cancel: "Cancel"
        }
      });
      if (result === "Save All") return "saveAll";
      if (result === "Discard") return "discard";
      return "cancel";
    }
    return window.confirm("Discard unsaved changes?") ? "discard" : "cancel";
  }, [hasUnsavedChanges]);

  const closeCurrentProject = useCallback(async () => {
    if (!project) return;
    const action = await chooseUnsavedChangesAction();
    if (action === "cancel") return;
    if (action === "saveAll" && !(await saveAll())) return;
    closeProject();
  }, [chooseUnsavedChangesAction, closeProject, project, saveAll]);

  const requestApplicationExit = useCallback(async () => {
    allowCloseRef.current = true;
    if ("__TAURI_INTERNALS__" in window) {
      await invoke("request_app_exit");
      return;
    }
    window.close();
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const effectiveTheme = theme === "dark" || (theme === "system" && media.matches) ? "dark" : "light";
      document.documentElement.dataset.theme = effectiveTheme;
      document.documentElement.dataset.themePreference = theme;
      document.documentElement.style.colorScheme = effectiveTheme;
    };
    applyTheme();
    if (theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlistenOpen: (() => void) | undefined;
    let unlistenNew: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    void listen("menu-new-project", () => {
      void chooseNewProjectDirectory();
    }).then((dispose) => {
      unlistenNew = dispose;
    });
    void listen("menu-open-project", () => {
      void chooseProjectSettingsFile();
    }).then((dispose) => {
      unlistenOpen = dispose;
    });
    void listen("menu-close-project", () => {
      void closeCurrentProject();
    }).then((dispose) => {
      unlistenClose = dispose;
    });
    return () => {
      unlistenOpen?.();
      unlistenNew?.();
      unlistenClose?.();
    };
  }, [chooseNewProjectDirectory, chooseProjectSettingsFile, closeCurrentProject]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen("app-exit-requested", async () => {
      const action = await chooseUnsavedChangesAction();
      if (action === "cancel") return;
      if (action === "saveAll" && !(await saveAll())) return;
      allowCloseRef.current = true;
      await invoke("request_app_exit");
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [chooseUnsavedChangesAction, saveAll]);

  useEffect(() => {
    if (!overflowOpen) return;
    const closeOverflow = (event: PointerEvent) => {
      if (!overflowRef.current?.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOverflow);
    return () => window.removeEventListener("pointerdown", closeOverflow);
  }, [overflowOpen]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowCloseRef.current) return;
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void appWindow
      .onCloseRequested(async (event) => {
        if (allowCloseRef.current) return;
        const state = useEditorStore.getState();
        const dirtyDocuments = Object.values(state.dirty).some(Boolean);
        if (!state.projectSettingsDirty && !dirtyDocuments) return;
        event.preventDefault();
        const action = await chooseUnsavedChangesAction();
        if (action === "cancel") return;
        if (action === "saveAll" && !(await saveAll())) return;
        await requestApplicationExit();
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        unlisten = undefined;
      });
    return () => unlisten?.();
  }, [chooseUnsavedChangesAction, requestApplicationExit, saveAll]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (!command) return;
      if (event.key.toLowerCase() === "z") {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
      }
      if (event.key.toLowerCase() === "y") {
        if (isEditableElement(event.target)) return;
        event.preventDefault();
        void redo();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) void saveAll();
        else void saveActive();
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoom(zoom + 0.1);
      }
      if (event.key === "-") {
        event.preventDefault();
        setZoom(zoom - 0.1);
      }
      if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, saveActive, saveAll, setZoom, undo, zoom]);

  return (
    <div
      className="app-shell"
      style={
        {
          "--zoom": zoom,
          "--grid-font-size": `${gridFontSize}px`,
          "--grid-row-height": `${Math.round(BASE_GRID_ROW_HEIGHT * zoom)}px`,
          "--grid-header-height": `${Math.round(BASE_GRID_HEADER_HEIGHT * zoom)}px`,
          "--grid-input-height": `${Math.max(20, Math.round(BASE_GRID_INPUT_HEIGHT * zoom))}px`,
          "--bottom-height": `${bottomPanelVisible ? bottomPanelHeight : 26}px`,
          "--sidebar-width": sidebarVisible ? "292px" : "0px"
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <IconButton
          label={sidebarVisible ? "Hide Explorer" : "Show Explorer"}
          onClick={() => setSidebarVisible(!sidebarVisible)}
          icon={<PanelLeft size={16} />}
        />
        <div className="brand">
          <Database size={18} />
          <span>MasterData Editor</span>
        </div>
        <div className="toolbar">
          <div className="toolbar-group primary-command-group">
            <CommandButton label="Save" onClick={() => void saveActive()} disabled={!canSave} icon={<Save size={16} />} />
            <CommandButton
              label="Save All"
              onClick={() => void saveAll()}
              disabled={!canSaveAll}
              icon={<SaveAll size={16} />}
              className="save-all-command"
            />
          </div>
          <div className="toolbar-separator" />
          <div className="toolbar-group build-command-group">
            <CommandButton
              label="Validate"
              onClick={() => void validate()}
              disabled={!project}
              icon={<CheckCircle2 size={16} />}
              className="optional-command validate-command"
            />
            <CommandButton label="Build" onClick={() => void build()} disabled={!project} icon={<Hammer size={16} />} />
            <CommandButton
              label="Sync"
              onClick={() => void sync()}
              disabled={!project}
              icon={<Play size={16} />}
              className="optional-command sync-command"
            />
          </div>
          <div className="toolbar-separator optional-separator" />
          <div className="toolbar-group edit-command-group">
            <IconButton label="Undo" onClick={() => void undo()} icon={<Undo2 size={16} />} />
            <IconButton label="Redo" onClick={() => void redo()} icon={<Redo2 size={16} />} />
          </div>
          <div className="toolbar-separator view-separator" />
          <div className="toolbar-group view-command-group">
            <IconButton
              label="Project Settings"
              onClick={() => setActiveView("projectSettings")}
              disabled={!project}
              icon={<SlidersHorizontal size={16} />}
            />
            <IconButton label="Editor Settings" onClick={() => setActiveView("editorSettings")} icon={<Settings size={16} />} />
            <IconButton label="Zoom out" onClick={() => setZoom(zoom - 0.1)} icon={<ZoomOut size={16} />} />
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <IconButton label="Zoom in" onClick={() => setZoom(zoom + 0.1)} icon={<ZoomIn size={16} />} />
            <IconButton
              label={bottomPanelVisible ? "Hide Panel" : "Show Panel"}
              onClick={() => setBottomPanelVisible(!bottomPanelVisible)}
              icon={<PanelBottom size={16} />}
            />
          </div>
          <div className="toolbar-overflow" ref={overflowRef}>
            <IconButton
              label="More commands"
              onClick={() => setOverflowOpen(!overflowOpen)}
              icon={<MoreHorizontal size={16} />}
            />
            {overflowOpen && (
              <div className="toolbar-overflow-menu">
                <OverflowButton
                  label="Validate"
                  disabled={!project}
                  icon={<CheckCircle2 size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    void validate();
                  }}
                />
                <OverflowButton
                  label="Sync"
                  disabled={!project}
                  icon={<Play size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    void sync();
                  }}
                />
                <OverflowButton
                  label="Generate"
                  disabled={!project}
                  icon={<Sparkles size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    void generate();
                  }}
                />
                <OverflowButton
                  label="Clean"
                  disabled={!project}
                  icon={<RotateCcw size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    void clean();
                  }}
                />
                <div className="overflow-separator" />
                <OverflowButton
                  label="Project Settings"
                  disabled={!project}
                  icon={<SlidersHorizontal size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    setActiveView("projectSettings");
                  }}
                />
                <OverflowButton
                  label="Editor Settings"
                  icon={<Settings size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    setActiveView("editorSettings");
                  }}
                />
                <OverflowButton
                  label={bottomPanelVisible ? "Hide Panel" : "Show Panel"}
                  icon={<PanelBottom size={15} />}
                  onClick={() => {
                    setOverflowOpen(false);
                    setBottomPanelVisible(!bottomPanelVisible);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </header>
      <div className={error ? "error-strip" : "error-strip empty"}>
        {error && (
          <>
          <AlertCircle size={16} />
          {error}
          </>
        )}
      </div>
      <main className="workbench">
        {sidebarVisible && (
          <aside className="sidebar">
            <FileExplorer />
          </aside>
        )}
        <section className="editor-pane">
          {project || activeView === "editorSettings" ? (
            <EditorHost />
          ) : (
            <WelcomePage
              isBusy={isBusy}
              onNewProject={chooseNewProjectDirectory}
              onOpenProject={chooseProjectSettingsFile}
              onOpenRecent={(path) => void openProject(path)}
              onRemoveRecent={removeRecentProject}
              recentProjects={recentProjects}
            />
          )}
        </section>
      </main>
      {bottomPanelVisible ? <BottomPanel /> : <StatusStrip />}
    </div>
  );
}

function isEditableElement(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function IconButton({
  className,
  disabled,
  icon,
  label,
  onClick
}: {
  className?: string;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`icon-button${className ? ` ${className}` : ""}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

function CommandButton({
  className,
  disabled,
  icon,
  label,
  onClick
}: {
  className?: string;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`command-button${className ? ` ${className}` : ""}`} title={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function OverflowButton({
  disabled,
  icon,
  label,
  onClick
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="overflow-button"
      disabled={disabled}
      onClick={() => {
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WelcomePage({
  isBusy,
  onNewProject,
  onOpenProject,
  onOpenRecent,
  onRemoveRecent,
  recentProjects
}: {
  isBusy: boolean;
  onNewProject: () => Promise<void>;
  onOpenProject: () => Promise<void>;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  recentProjects: string[];
}) {
  return (
    <div className="welcome-page">
      <div className="welcome-card">
        <Database size={38} />
        <h1>MasterData Editor</h1>
        <p>Open the project root containing project-settings.yaml.</p>
        <div className="welcome-actions">
          <button className="primary-action" onClick={() => void onNewProject()} disabled={isBusy}>
            <FolderPlus size={16} />
            New Project...
          </button>
          <button onClick={() => void onOpenProject()} disabled={isBusy}>
            <FolderOpen size={16} />
            Open Project...
          </button>
        </div>
      </div>
      <div className="recent-projects">
        <div className="section-heading">
          <History size={15} />
          Recent Projects
        </div>
        {recentProjects.length === 0 && <p className="muted">No recent projects.</p>}
        {recentProjects.map((path) => (
          <div className="recent-project-row" key={path}>
            <button className="recent-project" onClick={() => onOpenRecent(path)} title={path}>
              <FolderOpen size={16} />
              <span>{path}</span>
            </button>
            <button
              className="icon-button recent-remove-button"
              title="Remove from recent projects"
              onClick={() => onRemoveRecent(path)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
