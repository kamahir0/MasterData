import {
  AlertCircle,
  Braces,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderPlus,
  FolderOpen,
  ListFilter,
  Plus,
  Table2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useEditorStore } from "../store";
import type { DirectoryNode, EditorDiagnostic, FileNode } from "../types";
import { basename, capitalize, dirname, joinPath, shortPath } from "../editorUtils";

type SortMode = "name" | "modified";
type SortDirection = "asc" | "desc";
type CreateMenuState = { directory: string; x?: number; y?: number };
type CreateKind = "folder" | "table" | "enum" | "struct";
type EntryKind = "file" | "directory";
type InlineEditState =
  | { mode: "create"; kind: CreateKind; directory: string; name: string }
  | { mode: "rename"; target: EntryKind; path: string; name: string };
type MasterCreateEvent = { kind: CreateKind; directory: string };
type MasterEntryEvent = { action: "copy_path" | "delete" | "rename" | "reveal"; kind: EntryKind; path: string };

type TreeNode = DirectoryTreeNode | FileTreeNode;

interface DirectoryTreeNode {
  nodeKind: "directory";
  name: string;
  path: string;
  children: TreeNode[];
  hasError: boolean;
  modifiedMillis: number;
}

interface FileTreeNode {
  nodeKind: "file";
  file: FileNode;
  name: string;
  path: string;
  diagnostics: EditorDiagnostic[];
  hasError: boolean;
  modifiedMillis: number;
}

export function FileExplorer() {
  const {
    activePath,
    createDirectory,
    createDefinition,
    deleteEntry,
    diagnostics,
    dirty,
    isBusy,
    movePath,
    project,
    renameEntry,
    setActivePath
  } = useEditorStore();
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [createMenu, setCreateMenu] = useState<CreateMenuState>();
  const [inlineEdit, setInlineEdit] = useState<InlineEditState>();
  const tree = useMemo(
    () => buildTree(project?.files ?? [], project?.directories ?? [], diagnostics, sortMode, sortDirection),
    [diagnostics, project?.directories, project?.files, sortDirection, sortMode]
  );
  const rootDrop = useDroppable({ id: dropId("") });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!createMenu) return;
    const close = () => setCreateMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [createMenu]);

  const beginCreate = useCallback((kind: CreateKind, directory: string) => {
    setCreateMenu(undefined);
    if (directory) {
      setCollapsedDirectories((current) => {
        const next = new Set(current);
        next.delete(directory);
        return next;
      });
    }
    const path = uniqueCreatePath(project, directory, createRelativeName(kind, defaultCreateName(kind)));
    const name = kind === "folder" ? basename(path) : displayFileName(basename(path));
    setInlineEdit({ mode: "create", kind, directory, name });
  }, [project]);

  const beginRename = useCallback((target: EntryKind, path: string) => {
    setCreateMenu(undefined);
    setInlineEdit({
      mode: "rename",
      target,
      path,
      name: target === "file" ? displayFileName(basename(path)) : basename(path)
    });
  }, []);

  const copyEntryPath = useCallback(async (path: string) => {
    if (!project) return;
    try {
      const absolutePath = await api.resolveMasterEntryPath(project.root, path);
      await navigator.clipboard?.writeText(absolutePath);
    } catch (error) {
      console.error("Failed to copy path", error);
    }
  }, [project]);

  const revealEntry = useCallback(async (path: string) => {
    if (!project) return;
    try {
      await api.revealMasterEntry(project.root, path);
    } catch (error) {
      console.error("Failed to reveal entry", error);
    }
  }, [project]);

  const createFolder = () => beginCreate("folder", createMenu?.directory ?? "");

  const createFile = (kind: "table" | "enum" | "struct") => beginCreate(kind, createMenu?.directory ?? "");

  const commitInlineEdit = () => {
    if (!inlineEdit) return;
    const name = inlineEdit.name.trim();
    setInlineEdit(undefined);
    if (!name) return;
    if (inlineEdit.mode === "create") {
      const path = joinPath(inlineEdit.directory, createRelativeName(inlineEdit.kind, name));
      if (inlineEdit.kind === "folder") void createDirectory(path);
      else void createDefinition(inlineEdit.kind, path);
      return;
    }
    const targetPath = joinPath(dirname(inlineEdit.path), renameRelativeName(inlineEdit.target, name));
    if (targetPath === inlineEdit.path) return;
    if (inlineEdit.target === "directory") void movePath(inlineEdit.path, targetPath);
    else void renameEntry(inlineEdit.path, targetPath);
  };

  const cancelInlineEdit = () => setInlineEdit(undefined);

  const openEntryMenu = (kind: EntryKind, path: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("popup_master_entry_menu", {
        kind,
        path,
        x: event.clientX,
        y: event.clientY
      });
    }
  };

  const openCreateMenu = (directory: string, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (event && "__TAURI_INTERNALS__" in window) {
      const x = event.clientX;
      const y = event.clientY;
      void invoke("popup_master_create_menu", { directory, x, y })
        .catch(() => setCreateMenu({ directory, x, y }));
      return;
    }
    setCreateMenu({ directory, x: event?.clientX, y: event?.clientY });
  };

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<MasterCreateEvent>("master-create-entry", (event) => {
      const { directory, kind } = event.payload;
      beginCreate(kind, directory);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [beginCreate]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<MasterEntryEvent>("master-entry-action", (event) => {
      const { action, kind, path } = event.payload;
      if (action === "copy_path") {
        void copyEntryPath(path);
        return;
      }
      if (action === "reveal") {
        void revealEntry(path);
        return;
      }
      if (action === "rename") {
        beginRename(kind, path);
        return;
      }
      if (window.confirm(`Delete ${path}?`)) void deleteEntry(path);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [beginRename, copyEntryPath, deleteEntry, revealEntry]);

  const toggleDirectory = (path: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = parseDragId(String(event.active.id));
    const targetDirectory = parseDropId(event.over?.id ? String(event.over.id) : undefined);
    if (!active || targetDirectory == null) return;
    if (active.kind === "directory" && (targetDirectory === active.path || targetDirectory.startsWith(`${active.path}/`))) return;
    const to = joinPath(targetDirectory, basename(active.path));
    if (to !== active.path) void movePath(active.path, to);
  };

  return (
    <div className="file-tree">
      <div className="panel-title">
        <button
          className="icon-button tree-create-button"
          title="Create"
          disabled={!project || isBusy}
          onClick={(event) => openCreateMenu("", event)}
        >
          <Plus size={15} />
        </button>
        <Table2 size={15} />
        Master
      </div>
      <div className="tree-sortbar">
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
          <option value="name">File Name</option>
          <option value="modified">Updated</option>
        </select>
        <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
          <option value="asc">Asc</option>
          <option value="desc">Desc</option>
        </select>
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div
          className={clsx("tree-list", rootDrop.isOver && "drop-target")}
          ref={rootDrop.setNodeRef}
          onContextMenu={(event) => openCreateMenu("", event)}
        >
          {inlineEdit?.mode === "create" && inlineEdit.directory === "" && (
            <InlineEditRow
              edit={inlineEdit}
              level={0}
              onCancel={cancelInlineEdit}
              onChange={(name) => setInlineEdit({ ...inlineEdit, name })}
              onCommit={commitInlineEdit}
            />
          )}
          {tree.children.map((node) => (
            <TreeNodeView
              activePath={activePath}
              collapsedDirectories={collapsedDirectories}
              dirty={dirty}
              inlineEdit={inlineEdit}
              key={node.path}
              node={node}
              onCancelInlineEdit={cancelInlineEdit}
              onChangeInlineEdit={(name) => inlineEdit && setInlineEdit({ ...inlineEdit, name })}
              onCommitInlineEdit={commitInlineEdit}
              onOpenEntryMenu={openEntryMenu}
              onSelectFile={setActivePath}
              onToggleDirectory={toggleDirectory}
              level={0}
            />
          ))}
        </div>
      </DndContext>
      {createMenu && createMenu.x != null && (
        <CreateMenu
          fixed
          x={createMenu.x}
          y={createMenu.y ?? 0}
          onCreateFile={createFile}
          onCreateFolder={createFolder}
        />
      )}
    </div>
  );
}

function CreateMenu({
  fixed,
  onCreateFile,
  onCreateFolder,
  x,
  y
}: {
  fixed?: boolean;
  onCreateFile: (kind: "table" | "enum" | "struct") => void;
  onCreateFolder: () => void;
  x?: number;
  y?: number;
}) {
  return (
    <div
      className={clsx("tree-create-menu", fixed && "tree-context-menu")}
      style={fixed ? { left: x, top: y } : undefined}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="tree-menu-title">New Folder</div>
      <button type="button" onClick={onCreateFolder}>
        <FolderPlus size={14} />
        Folder
      </button>
      <hr />
      <div className="tree-menu-title">New File</div>
      <button type="button" onClick={() => onCreateFile("table")}>
        <Table2 size={14} />
        Table
      </button>
      <button type="button" onClick={() => onCreateFile("enum")}>
        <ListFilter size={14} />
        Enum
      </button>
      <button type="button" onClick={() => onCreateFile("struct")}>
        <Braces size={14} />
        Struct
      </button>
    </div>
  );
}

function TreeNodeView({
  activePath,
  collapsedDirectories,
  dirty,
  level,
  node,
  inlineEdit,
  onCancelInlineEdit,
  onChangeInlineEdit,
  onCommitInlineEdit,
  onOpenEntryMenu,
  onSelectFile,
  onToggleDirectory
}: {
  activePath?: string;
  collapsedDirectories: Set<string>;
  dirty: Record<string, boolean>;
  level: number;
  node: TreeNode;
  inlineEdit?: InlineEditState;
  onCancelInlineEdit: () => void;
  onChangeInlineEdit: (name: string) => void;
  onCommitInlineEdit: () => void;
  onOpenEntryMenu: (kind: EntryKind, path: string, event: React.MouseEvent) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  if (node.nodeKind === "directory") {
    const collapsed = collapsedDirectories.has(node.path);
    const renaming = inlineEdit?.mode === "rename" && inlineEdit.path === node.path;
    if (renaming) {
      return (
        <InlineEditRow
          edit={inlineEdit}
          level={level}
          onCancel={onCancelInlineEdit}
          onChange={onChangeInlineEdit}
          onCommit={onCommitInlineEdit}
        />
      );
    }
    return (
      <>
        <DirectoryItem
          collapsed={collapsed}
          level={level}
          node={node}
          onOpenEntryMenu={onOpenEntryMenu}
          onToggle={() => onToggleDirectory(node.path)}
        />
        {!collapsed && inlineEdit?.mode === "create" && inlineEdit.directory === node.path && (
          <InlineEditRow
            edit={inlineEdit}
            level={level + 1}
            onCancel={onCancelInlineEdit}
            onChange={onChangeInlineEdit}
            onCommit={onCommitInlineEdit}
          />
        )}
        {!collapsed &&
          node.children.map((child) => (
            <TreeNodeView
              activePath={activePath}
              collapsedDirectories={collapsedDirectories}
              dirty={dirty}
              inlineEdit={inlineEdit}
              key={child.path}
              level={level + 1}
              node={child}
              onCancelInlineEdit={onCancelInlineEdit}
              onChangeInlineEdit={onChangeInlineEdit}
              onCommitInlineEdit={onCommitInlineEdit}
              onOpenEntryMenu={onOpenEntryMenu}
              onSelectFile={onSelectFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
      </>
    );
  }

  if (inlineEdit?.mode === "rename" && inlineEdit.path === node.file.relativePath) {
    return (
      <InlineEditRow
        edit={inlineEdit}
        level={level}
        onCancel={onCancelInlineEdit}
        onChange={onChangeInlineEdit}
        onCommit={onCommitInlineEdit}
      />
    );
  }

  return (
    <FileItem
      active={activePath === node.file.relativePath}
      dirty={Boolean(dirty[node.file.relativePath])}
      level={level}
      node={node}
      onOpenEntryMenu={onOpenEntryMenu}
      onSelect={() => onSelectFile(node.file.relativePath)}
    />
  );
}

function DirectoryItem({
  collapsed,
  level,
  node,
  onOpenEntryMenu,
  onToggle
}: {
  collapsed: boolean;
  level: number;
  node: DirectoryTreeNode;
  onOpenEntryMenu: (kind: EntryKind, path: string, event: React.MouseEvent) => void;
  onToggle: () => void;
}) {
  const draggable = useDraggable({ id: dragId("directory", node.path) });
  const droppable = useDroppable({ id: dropId(node.path) });
  const title = node.hasError ? `Folder contains errors: ${node.path}` : node.path;

  return (
    <div
      className={clsx("tree-row directory", droppable.isOver && "drop-target")}
      ref={(element) => {
        draggable.setNodeRef(element);
        draggable.setActivatorNodeRef(element);
        droppable.setNodeRef(element);
      }}
      style={
        {
          "--tree-indent": `${level * 14}px`,
          transform: CSS.Translate.toString(draggable.transform)
        } as React.CSSProperties
      }
      {...draggable.attributes}
      {...draggable.listeners}
      onContextMenu={(event) => onOpenEntryMenu("directory", node.path, event)}
      onClick={onToggle}
      onKeyDown={(event) => activateWithKeyboard(event, onToggle)}
      tabIndex={0}
      role="treeitem"
      aria-expanded={!collapsed}
    >
      <span
        className="tree-disclosure"
        title={collapsed ? "Expand folder" : "Collapse folder"}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </span>
      <div
        className="tree-item directory-item"
        title={title}
      >
        {collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
        <span className="tree-name">{node.name}</span>
        {node.hasError && <AlertCircle size={13} className="error-icon" />}
      </div>
    </div>
  );
}

function FileItem({
  active,
  dirty,
  level,
  node,
  onOpenEntryMenu,
  onSelect
}: {
  active: boolean;
  dirty: boolean;
  level: number;
  node: FileTreeNode;
  onOpenEntryMenu: (kind: EntryKind, path: string, event: React.MouseEvent) => void;
  onSelect: () => void;
}) {
  const draggable = useDraggable({ id: dragId("file", node.file.relativePath) });
  const diagnosticTitle = diagnosticTooltip(node.diagnostics);

  return (
    <div
      className={clsx("tree-row file", active && "active")}
      ref={(element) => {
        draggable.setNodeRef(element);
        draggable.setActivatorNodeRef(element);
      }}
      style={
        {
          "--tree-indent": `${level * 14}px`,
          transform: CSS.Translate.toString(draggable.transform)
        } as React.CSSProperties
      }
      {...draggable.attributes}
      {...draggable.listeners}
      onContextMenu={(event) => onOpenEntryMenu("file", node.file.relativePath, event)}
      onClick={onSelect}
      onKeyDown={(event) => activateWithKeyboard(event, onSelect)}
      tabIndex={0}
      role="treeitem"
      aria-selected={active}
    >
      <div className="tree-spacer" />
      <div
        className="tree-item"
        title={node.file.relativePath}
      >
        <KindIcon kind={node.file.kind} />
        <span className="tree-name">{displayFileName(node.name)}</span>
        {dirty && <span className="dirty-dot" />}
        {node.hasError && (
          <span className="error-icon" title={diagnosticTitle}>
            <AlertCircle size={13} />
          </span>
        )}
      </div>
    </div>
  );
}

function InlineEditRow({
  edit,
  level,
  onCancel,
  onChange,
  onCommit
}: {
  edit: InlineEditState;
  level: number;
  onCancel: () => void;
  onChange: (name: string) => void;
  onCommit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commitOnce = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit();
  };

  const kind = edit.mode === "rename" ? edit.target : edit.kind;

  return (
    <form
      className="tree-row inline-edit-row"
      style={{ "--tree-indent": `${level * 14}px` } as React.CSSProperties}
      onSubmit={(event) => {
        event.preventDefault();
        commitOnce();
      }}
    >
      <div className="tree-spacer" />
      <div className="tree-item inline-edit-item">
        {kind === "directory" || kind === "folder" ? <Folder size={14} /> : <KindIcon kind={kind} />}
        <input
          ref={inputRef}
          value={edit.name}
          onBlur={commitOnce}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              committed.current = true;
              onCancel();
            }
          }}
        />
      </div>
    </form>
  );
}

function activateWithKeyboard(event: React.KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function displayFileName(name: string) {
  return name.replace(/\.ya?ml$/i, "");
}

function defaultCreateName(kind: CreateKind) {
  if (kind === "folder") return "NewFolder";
  return `New${capitalize(kind)}`;
}

function createRelativeName(kind: CreateKind, name: string) {
  const clean = cleanInlineName(name);
  if (kind === "folder") return clean;
  return ensureYamlExtension(clean);
}

function renameRelativeName(target: EntryKind, name: string) {
  const clean = cleanInlineName(name);
  if (target === "directory") return clean;
  return ensureYamlExtension(clean);
}

function cleanInlineName(name: string) {
  return name.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function ensureYamlExtension(name: string) {
  return /\.ya?ml$/i.test(name) ? name : `${name}.yaml`;
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "table") return <Table2 size={14} />;
  if (kind === "enum") return <ListFilter size={14} />;
  if (kind === "struct") return <Braces size={14} />;
  return <FileCode2 size={14} />;
}

function buildTree(
  files: FileNode[],
  directoryNodes: DirectoryNode[],
  diagnostics: EditorDiagnostic[],
  sortMode: SortMode,
  sortDirection: SortDirection
): DirectoryTreeNode {
  const root: DirectoryTreeNode = {
    nodeKind: "directory",
    name: "master",
    path: "",
    children: [],
    hasError: false,
    modifiedMillis: 0
  };
  const directoryMap = new Map<string, DirectoryTreeNode>([["", root]]);
  const diagnosticsByPath = diagnosticsForFiles(files, diagnostics);

  for (const directory of directoryNodes) {
    ensureDirectory(root, directoryMap, directory.relativePath, directory.modifiedMillis);
  }

  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";
    for (const part of parts.slice(0, -1)) {
      currentPath = joinPath(currentPath, part);
      current = ensureDirectory(root, directoryMap, currentPath, 0);
    }
    const fileDiagnostics = diagnosticsByPath.get(file.relativePath) ?? [];
    current.children.push({
      nodeKind: "file",
      file,
      name: parts.at(-1) ?? file.name,
      path: file.relativePath,
      diagnostics: fileDiagnostics,
      hasError: file.hasError || fileDiagnostics.length > 0,
      modifiedMillis: file.modifiedMillis
    });
  }

  finalizeDirectory(root, sortMode, sortDirection);
  return root;
}

function ensureDirectory(
  root: DirectoryTreeNode,
  directories: Map<string, DirectoryTreeNode>,
  path: string,
  modifiedMillis: number
) {
  const normalized = path.split("/").filter(Boolean).join("/");
  if (!normalized) return root;
  const existing = directories.get(normalized);
  if (existing) {
    existing.modifiedMillis = Math.max(existing.modifiedMillis, modifiedMillis);
    return existing;
  }
  const parentPath = dirname(normalized);
  const parent = ensureDirectory(root, directories, parentPath, 0);
  const directory: DirectoryTreeNode = {
    nodeKind: "directory",
    name: basename(normalized),
    path: normalized,
    children: [],
    hasError: false,
    modifiedMillis
  };
  directories.set(normalized, directory);
  parent.children.push(directory);
  return directory;
}

function finalizeDirectory(directory: DirectoryTreeNode, sortMode: SortMode, sortDirection: SortDirection) {
  for (const child of directory.children) {
    if (child.nodeKind === "directory") finalizeDirectory(child, sortMode, sortDirection);
  }
  directory.hasError = directory.children.some((child) => child.hasError);
  directory.modifiedMillis = directory.children.reduce((max, child) => Math.max(max, child.modifiedMillis), directory.modifiedMillis);
  directory.children.sort((a, b) => compareNodes(a, b, sortMode, sortDirection));
}

function compareNodes(a: TreeNode, b: TreeNode, sortMode: SortMode, sortDirection: SortDirection) {
  if (a.nodeKind !== b.nodeKind) return a.nodeKind === "directory" ? -1 : 1;
  const raw =
    sortMode === "name"
      ? a.name.localeCompare(b.name)
      : a.modifiedMillis - b.modifiedMillis || a.name.localeCompare(b.name);
  return sortDirection === "asc" ? raw : -raw;
}

function diagnosticsForFiles(files: FileNode[], diagnostics: EditorDiagnostic[]) {
  const byPath = new Map<string, EditorDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.path) continue;
    const normalizedPath = diagnostic.path.replaceAll("\\", "/");
    const file = files.find((entry) => {
      const absolute = entry.path.replaceAll("\\", "/");
      const relative = entry.relativePath.replaceAll("\\", "/");
      return absolute === normalizedPath || relative === normalizedPath || normalizedPath.endsWith(`/${relative}`);
    });
    if (!file) continue;
    const current = byPath.get(file.relativePath) ?? [];
    current.push(diagnostic);
    byPath.set(file.relativePath, current);
  }
  return byPath;
}

function diagnosticTooltip(diagnostics: EditorDiagnostic[]) {
  if (diagnostics.length === 0) return "This file has errors.";
  return diagnostics
    .map((diagnostic) => `${diagnostic.code} ${shortPath(diagnostic.path ?? "")}: ${diagnostic.message}`)
    .join("\n");
}

function uniqueCreatePath(
  project: { files: FileNode[]; directories: DirectoryNode[] } | undefined,
  directory: string,
  preferredName: string
) {
  const existing = new Set([
    ...(project?.files ?? []).map((file) => file.relativePath),
    ...(project?.directories ?? []).map((item) => item.relativePath)
  ]);
  const normalizedDirectory = directory.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const slashName = preferredName.replaceAll("\\", "/").replace(/^\/+/, "");
  const dot = slashName.lastIndexOf(".");
  const stem = dot >= 0 ? slashName.slice(0, dot) : slashName;
  const extension = dot >= 0 ? slashName.slice(dot) : "";

  for (let index = 1; ; index += 1) {
    const name = index === 1 ? slashName : `${stem}${index}${extension}`;
    const candidate = joinPath(normalizedDirectory, name);
    if (!existing.has(candidate)) return candidate;
  }
}

function dragId(kind: "directory" | "file", path: string) {
  return `${kind}:${path}`;
}

function dropId(path: string) {
  return `drop:${path}`;
}

function parseDragId(id: string) {
  const separator = id.indexOf(":");
  if (separator < 0) return undefined;
  const kind = id.slice(0, separator);
  const path = id.slice(separator + 1);
  if ((kind !== "directory" && kind !== "file") || !path) return undefined;
  return { kind, path } as const;
}

function parseDropId(id: string | undefined) {
  if (!id?.startsWith("drop:")) return undefined;
  return id.slice("drop:".length);
}
