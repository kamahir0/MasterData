import {
  AlertCircle,
  Braces,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderPlus,
  FolderOpen,
  GripVertical,
  ListFilter,
  Plus,
  Table2,
} from "lucide-react";
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "../store";
import type { DirectoryNode, EditorDiagnostic, FileNode } from "../types";
import { basename, capitalize, dirname, joinPath, shortPath } from "../editorUtils";

type SortMode = "name" | "modified";
type SortDirection = "asc" | "desc";
type CreateMenuState = { directory: string; x?: number; y?: number };

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
    diagnostics,
    dirty,
    isBusy,
    movePath,
    project,
    setActivePath
  } = useEditorStore();
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [createMenu, setCreateMenu] = useState<CreateMenuState>();
  const tree = useMemo(
    () => buildTree(project?.files ?? [], project?.directories ?? [], diagnostics, sortMode, sortDirection),
    [diagnostics, project?.directories, project?.files, sortDirection, sortMode]
  );
  const rootDrop = useDroppable({ id: dropId("") });

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

  const createFolderIn = (directory: string) => {
    setCreateMenu(undefined);
    const path = window.prompt("New folder", uniqueCreatePath(project, directory, "NewFolder"));
    if (path) void createDirectory(path);
  };

  const createFileIn = (kind: "table" | "enum" | "struct", directory: string) => {
    setCreateMenu(undefined);
    const suggestedName = kind === "table" ? "NewMaster.yaml" : `New${capitalize(kind)}.yaml`;
    const path = window.prompt(`New ${kind} YAML`, uniqueCreatePath(project, directory, suggestedName));
    if (path) void createDefinition(kind, path);
  };

  const createFolder = () => createFolderIn(createMenu?.directory ?? "");

  const createFile = (kind: "table" | "enum" | "struct") => createFileIn(kind, createMenu?.directory ?? "");

  const openCreateMenu = (directory: string, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (event && "__TAURI_INTERNALS__" in window) {
      const x = event.clientX;
      const y = event.clientY;
      const position = new LogicalPosition(x, y);
      void Menu.new({
        items: [
          {
            text: "Create",
            items: [
              { text: "Folder", action: () => createFolderIn(directory) },
              { text: "Table", action: () => createFileIn("table", directory) },
              { text: "Enum", action: () => createFileIn("enum", directory) },
              { text: "Struct", action: () => createFileIn("struct", directory) }
            ]
          }
        ]
      })
        .then((menu) => menu.popup(position))
        .catch(() => setCreateMenu({ directory, x, y }));
      return;
    }
    setCreateMenu({ directory, x: event?.clientX, y: event?.clientY });
  };

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
        <Table2 size={15} />
        Master
        <div className="tree-actions">
          <button
            className="icon-button tree-create-button"
            title="Create"
            disabled={!project || isBusy}
            onClick={(event) => {
              event.stopPropagation();
              setCreateMenu((current) => (current && current.directory === "" && current.x == null ? undefined : { directory: "" }));
            }}
          >
            <Plus size={15} />
          </button>
          {createMenu && createMenu.x == null && <CreateMenu onCreateFile={createFile} onCreateFolder={createFolder} />}
        </div>
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
      <DndContext onDragEnd={handleDragEnd}>
        <div className="tree-list" onContextMenu={(event) => openCreateMenu("", event)}>
          <div
            className={clsx("tree-row directory root-directory", rootDrop.isOver && "drop-target")}
            ref={rootDrop.setNodeRef}
            style={{ "--tree-indent": "0px" } as React.CSSProperties}
            onContextMenu={(event) => openCreateMenu("", event)}
          >
            <div className="tree-spacer" />
            <div className="tree-item directory-item" title={project?.masterRoot ?? "Master root"}>
              <FolderOpen size={14} />
              <span className="tree-name">master</span>
            </div>
          </div>
          {tree.children.map((node) => (
            <TreeNodeView
              activePath={activePath}
              collapsedDirectories={collapsedDirectories}
              dirty={dirty}
              key={node.path}
              node={node}
              onOpenCreateMenu={openCreateMenu}
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
    >
      <div className="tree-menu-title">Create</div>
      <button className="tree-menu-child" onClick={onCreateFolder}>
        <FolderPlus size={14} />
        Folder
      </button>
      <button className="tree-menu-child" onClick={() => onCreateFile("table")}>
        <Table2 size={14} />
        Table
      </button>
      <button className="tree-menu-child" onClick={() => onCreateFile("enum")}>
        <ListFilter size={14} />
        Enum
      </button>
      <button className="tree-menu-child" onClick={() => onCreateFile("struct")}>
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
  onOpenCreateMenu,
  onSelectFile,
  onToggleDirectory
}: {
  activePath?: string;
  collapsedDirectories: Set<string>;
  dirty: Record<string, boolean>;
  level: number;
  node: TreeNode;
  onOpenCreateMenu: (directory: string, event: React.MouseEvent) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  if (node.nodeKind === "directory") {
    const collapsed = collapsedDirectories.has(node.path);
    return (
      <>
        <DirectoryItem
          collapsed={collapsed}
          level={level}
          node={node}
          onOpenCreateMenu={onOpenCreateMenu}
          onToggle={() => onToggleDirectory(node.path)}
        />
        {!collapsed &&
          node.children.map((child) => (
            <TreeNodeView
              activePath={activePath}
              collapsedDirectories={collapsedDirectories}
              dirty={dirty}
              key={child.path}
              level={level + 1}
              node={child}
              onOpenCreateMenu={onOpenCreateMenu}
              onSelectFile={onSelectFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
      </>
    );
  }

  return (
    <FileItem
      active={activePath === node.file.relativePath}
      dirty={Boolean(dirty[node.file.relativePath])}
      level={level}
      node={node}
      onSelect={() => onSelectFile(node.file.relativePath)}
    />
  );
}

function DirectoryItem({
  collapsed,
  level,
  node,
  onOpenCreateMenu,
  onToggle
}: {
  collapsed: boolean;
  level: number;
  node: DirectoryTreeNode;
  onOpenCreateMenu: (directory: string, event: React.MouseEvent) => void;
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
        droppable.setNodeRef(element);
      }}
      style={
        {
          "--tree-indent": `${level * 14}px`,
          transform: CSS.Translate.toString(draggable.transform)
        } as React.CSSProperties
      }
      onContextMenu={(event) => onOpenCreateMenu(node.path, event)}
    >
      <button
        className="tree-disclosure"
        onClick={onToggle}
        title={collapsed ? "Expand folder" : "Collapse folder"}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>
      <button className="tree-item directory-item" onClick={onToggle} title={title}>
        {collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
        <span className="tree-name">{node.name}</span>
        {node.hasError && <AlertCircle size={13} className="error-icon" />}
      </button>
      <button
        className="tree-drag-handle"
        title="Move folder"
        ref={draggable.setActivatorNodeRef}
        {...draggable.listeners}
        {...draggable.attributes}
      >
        <GripVertical size={13} />
      </button>
    </div>
  );
}

function FileItem({
  active,
  dirty,
  level,
  node,
  onSelect
}: {
  active: boolean;
  dirty: boolean;
  level: number;
  node: FileTreeNode;
  onSelect: () => void;
}) {
  const draggable = useDraggable({ id: dragId("file", node.file.relativePath) });
  const diagnosticTitle = diagnosticTooltip(node.diagnostics);

  return (
    <div
      className={clsx("tree-row file", active && "active")}
      ref={draggable.setNodeRef}
      style={
        {
          "--tree-indent": `${level * 14}px`,
          transform: CSS.Translate.toString(draggable.transform)
        } as React.CSSProperties
      }
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="tree-spacer" />
      <button className="tree-item" onClick={onSelect} title={node.file.relativePath}>
        <KindIcon kind={node.file.kind} />
        <span className="tree-name">{node.name}</span>
        {dirty && <span className="dirty-dot" />}
        {node.hasError && (
          <span className="error-icon" title={diagnosticTitle}>
            <AlertCircle size={13} />
          </span>
        )}
      </button>
      <button
        className="tree-drag-handle"
        title="Move file"
        ref={draggable.setActivatorNodeRef}
        {...draggable.listeners}
        {...draggable.attributes}
      >
        <GripVertical size={13} />
      </button>
    </div>
  );
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
