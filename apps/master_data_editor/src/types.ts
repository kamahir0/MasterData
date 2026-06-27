export type DefinitionKind = "enum" | "struct" | "table";

export type ScalarValue = string | number | boolean | null;
export type MasterValue = ScalarValue | MasterValue[] | { [key: string]: MasterValue };

export interface ProjectSnapshot {
  root: string;
  masterRoot: string;
  config: MasterDataConfig;
  directories: DirectoryNode[];
  files: FileNode[];
  documents: DefinitionDocument[];
  diagnostics: EditorDiagnostic[];
  availableTags: string[];
  buildProfiles: string[];
}

export interface MasterDataConfig {
  tool: { version: string };
  csharp: {
    namespace: string;
    output?: string;
    templates?: Record<string, string>;
    staticDatabaseAccessor?: Record<string, unknown>;
  };
  master: { input?: string };
  memory: { output?: string; fileName?: string };
  tags?: { allowed?: string[] };
  buildProfiles?: Record<string, BuildProfile>;
  sync?: { cs?: string; memory?: string };
}

export interface BuildProfile {
  includeTags?: string[];
  excludeTags?: string[];
  includeUntagged?: boolean;
}

export interface FileNode {
  path: string;
  relativePath: string;
  name: string;
  kind: DefinitionKind | "invalid";
  typeName?: string;
  hasError: boolean;
  modifiedMillis: number;
}

export interface DirectoryNode {
  path: string;
  relativePath: string;
  name: string;
  modifiedMillis: number;
}

export interface DefinitionDocument {
  path: string;
  relativePath: string;
  kind: DefinitionKind;
  typeName: string;
  definition: Definition;
  sidecar: TableViewConfig;
}

export type Definition =
  | ({ kind: "enum" } & EnumDefinition)
  | ({ kind: "struct" } & StructDefinition)
  | ({ kind: "table" } & TableDefinition);

export interface EnumDefinition {
  name: string;
  underlyingType?: string;
  flags?: boolean;
  members: Array<string | { name: string; value: number }>;
}

export interface StructDefinition {
  name: string;
  fields: FieldDefinition[];
}

export interface TableDefinition {
  table: string;
  typeName: string;
  keys: KeyDefinitions;
  fields: FieldDefinition[];
  refs?: MasterRefDefinition[];
  rows: RowDefinition[];
}

export interface RowDefinition {
  data: Record<string, MasterValue>;
  meta?: RowMeta;
}

export interface RowMeta {
  tags?: string[];
}

export interface FieldDefinition {
  name: string;
  type: string;
  fixedIndex?: number;
}

export interface KeyDefinitions {
  primary: { fields: string[] };
  secondary?: Array<{ fields: string[]; unique?: boolean }>;
}

export interface MasterRefDefinition {
  name: string;
  target: string;
  targetKey: { primary?: boolean; fields?: string[] };
  fields: Array<{ local: string; target: string }>;
}

export interface TableViewConfig {
  columnWidths?: Record<string, number>;
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnColors?: Record<string, string>;
  rowHeights?: Record<string, number>;
  cellColors?: Record<string, string>;
  freezeColumns?: number;
  lastFilter?: unknown;
}

export interface EditorDiagnostic {
  severity: "error" | "warning" | string;
  code: string;
  path?: string;
  message: string;
}

export interface CommandResult {
  ok: boolean;
  message: string;
  diagnostics: EditorDiagnostic[];
}

export interface EditorPreferences {
  recentProjects: string[];
  theme: "system" | "light" | "dark" | string;
  zoom: number;
  gridFontSize: number;
  defaultProfile?: string;
  sidebarVisible?: boolean;
  bottomPanelVisible?: boolean;
  bottomPanelHeight?: number;
  bottomPanelActiveTab?: BottomPanelTab;
}

export type BottomPanelTab = "problems" | "buildLog";

export type ActiveView = "document" | "projectSettings" | "editorSettings";

export interface TagFilter {
  include: string[];
  exclude: string[];
  showUntagged: boolean;
}
