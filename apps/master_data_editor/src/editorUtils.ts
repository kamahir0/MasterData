import type {
  DefinitionDocument,
  FieldDefinition,
  MasterValue,
  TableDefinition
} from "./types";

export const BUILTIN_TYPES = ["bool", "int", "long", "float", "double", "string"];
export const RESERVED_UNTAGGED_TAG = "untagged";

export interface TypeOptionGroup {
  label: string;
  options: string[];
}

export function availableTypeOptions(documents: Record<string, DefinitionDocument>, current?: string) {
  return availableTypeOptionGroups(documents, current).flatMap((group) => group.options);
}

export function availableTypeOptionGroups(documents: Record<string, DefinitionDocument>, current?: string): TypeOptionGroup[] {
  const currentBase = unwrapListType(current ?? "");
  const custom = Object.values(documents)
    .filter((document) => document.definition.kind === "enum" || document.definition.kind === "struct");
  const enums = custom
    .filter((document) => document.definition.kind === "enum")
    .map((document) => document.typeName)
    .sort();
  const structs = custom
    .filter((document) => document.definition.kind === "struct")
    .map((document) => document.typeName)
    .sort();
  const groups: TypeOptionGroup[] = [
    { label: "Primitive", options: BUILTIN_TYPES },
    { label: "Enum", options: enums },
    { label: "Struct", options: structs }
  ].filter((group) => group.options.length > 0);
  const known = new Set(groups.flatMap((group) => group.options));
  if (currentBase && !known.has(currentBase)) groups.unshift({ label: "Current", options: [currentBase] });
  return groups;
}

export function isListType(type: string) {
  return /^.+\[\]$/.test(type.trim());
}

export function unwrapListType(type: string) {
  const trimmed = type.trim();
  return isListType(trimmed) ? trimmed.slice(0, -"[]".length).trim() : trimmed;
}

export function setListType(type: string, list: boolean) {
  const base = unwrapListType(type);
  return list ? `${base}[]` : base;
}

export function formatTypeLabel(type: string): string {
  const trimmed = type.trim();
  if (!isListType(trimmed)) return trimmed;
  return `${formatTypeLabel(unwrapListType(trimmed))}[]`;
}

export function messagePackKey(field: FieldDefinition, fallbackIndex: number) {
  return field.fixedIndex ?? fallbackIndex;
}

export function duplicateMessagePackKeys(fields: FieldDefinition[]) {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  fields.forEach((field, index) => {
    const key = messagePackKey(field, index);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  });
  return duplicates;
}

export function duplicatePrimaryKeys(table: TableDefinition) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of table.rows) {
    const key = table.keys.primary.fields.map((field) => String(row.data[field] ?? "")).join("|");
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

export function replaceFieldName(fields: string[], oldName: string, nextName: string) {
  const index = fields.indexOf(oldName);
  if (index >= 0) fields[index] = nextName;
}

export function removeFieldName(fields: string[], name: string) {
  let index = fields.indexOf(name);
  while (index >= 0) {
    fields.splice(index, 1);
    index = fields.indexOf(name);
  }
}

export function moveFieldToIndex(fields: FieldDefinition[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= fields.length || to >= fields.length || from === to) return;
  const [field] = fields.splice(from, 1);
  fields.splice(to, 0, field);
}

export function moveFieldToGap(fields: FieldDefinition[], from: number, gap: number) {
  if (from < 0 || from >= fields.length) return;
  const clampedGap = Math.max(0, Math.min(fields.length, gap));
  const to = clampedGap > from ? clampedGap - 1 : clampedGap;
  moveFieldToIndex(fields, from, to);
}

export function createField(fields: FieldDefinition[], preferredName: string, type: string): FieldDefinition {
  return {
    name: uniqueFieldName(fields, preferredName),
    type,
    fixedIndex: nextFixedIndex(fields)
  };
}

export function uniqueFieldName(fields: FieldDefinition[], preferredName: string) {
  const names = new Set(fields.map((field) => field.name));
  if (!names.has(preferredName)) return preferredName;
  for (let index = 2; ; index += 1) {
    const candidate = `${preferredName}${index}`;
    if (!names.has(candidate)) return candidate;
  }
}

export function nextFixedIndex(fields: FieldDefinition[]) {
  if (fields.length === 0) return 0;
  return Math.max(...fields.map((field, index) => messagePackKey(field, index))) + 1;
}

export function cloneMasterValue(value: MasterValue | undefined): MasterValue {
  if (value === undefined) return "";
  return JSON.parse(JSON.stringify(value)) as MasterValue;
}

export function formatValue(value: MasterValue | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null ? "" : String(value);
}

export function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function dirname(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function joinPath(directory: string, name: string) {
  return [directory, name].filter(Boolean).join("/");
}

export function copyPath(path: string) {
  const directory = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const copiedName = dot >= 0 ? `${name.slice(0, dot)}Copy${name.slice(dot)}` : `${name}Copy`;
  return joinPath(directory, copiedName);
}

export function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function shortPath(path: string) {
  return path.split(/[\\/]/).slice(-2).join("/");
}

export function matchesTagRule(tags: string[], includeTags: string[], excludeTags: string[]) {
  const isUntagged = tags.length === 0;
  if (excludeTags.includes(RESERVED_UNTAGGED_TAG) && isUntagged) return false;
  if (tags.some((tag) => excludeTags.includes(tag))) return false;
  if (includeTags.length === 0) return true;
  if (includeTags.includes(RESERVED_UNTAGGED_TAG) && isUntagged) return true;
  return tags.some((tag) => includeTags.includes(tag));
}
