import { AlertCircle, ChevronDown, ChevronRight, GripVertical, Plus, Table2, Tags, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { coerceValue, useEditorStore } from "../store";
import {
  cloneMasterValue,
  createField,
  duplicateMessagePackKeys,
  duplicatePrimaryKeys,
  formatTypeLabel,
  formatValue,
  isListType,
  matchesTagRule,
  messagePackKey,
  moveFieldToGap,
  moveFieldToIndex,
  removeFieldName,
  replaceFieldName,
  unwrapListType
} from "../editorUtils";
import type { DefinitionDocument, FieldDefinition, MasterRefDefinition, MasterValue, RowDefinition, StructDefinition, TableDefinition } from "../types";
import { EditorHeader } from "./EditorHost";
import { BoolToggleInput, FieldTypeControl, ListValueEditorPanel, MasterValueInput, ValuePopoverScope, enumInfoForType, type EnumInfo } from "./MasterValueEditor";
import { isValidTagName, TagTokenInput, uniqueTags } from "./TagTokenInput";

const ROW_NUMBER_WIDTH = 64;
const META_TAGS_WIDTH = 180;
const FIELD_WIDTH = 190;
const ADD_FIELD_WIDTH = 44;
const ROW_HEIGHT = 34;
const SECONDARY_BADGE_VARIANTS = 5;

type VisibleRow = { row: RowDefinition; originalIndex: number; filteredOut: boolean };
type GridField = number | "tags";
type ActiveCell = { visibleRowIndex: number; field: GridField };
type ActiveCellState = ActiveCell & { mode: "select" | "edit" };
type SelectedRowState = { visibleRowIndex: number; originalIndex: number };
type TableCreateEvent = { kind: "field" | "record" };
type TableIndexedMenuEvent = { action: string; index: number };
type SelectedStructCell = {
  fieldIndex: number;
  originalIndex: number;
  typeName: string;
  visibleRowIndex: number;
};
type SelectedFlagsCell = {
  fieldIndex: number;
  originalIndex: number;
  typeName: string;
  visibleRowIndex: number;
};
type SelectedListCell = {
  elementType: string;
  fieldIndex: number;
  originalIndex: number;
  visibleRowIndex: number;
};
type PopoverPosition = { left: number; top: number };

export function TableEditor({ document }: { document: DefinitionDocument }) {
  const table = document.definition as TableDefinition & { kind: "table" };
  const rows = useFilteredRows(table);

  return (
    <div className="table-editor">
      <EditorHeader document={document} showFilters />
      <TableSettingsFoldout document={document} table={table} />
      <RecordsGrid document={document} table={table} rows={rows} />
    </div>
  );
}

function TableSettingsFoldout({ document, table }: { document: DefinitionDocument; table: TableDefinition }) {
  const { documents, updateDocument } = useEditorStore();
  const [open, setOpen] = useState(false);
  const tableDocuments = useMemo(
    () =>
      Object.values(documents).filter(
        (item): item is DefinitionDocument & { definition: TableDefinition & { kind: "table" } } =>
          item.definition.kind === "table"
      ),
    [documents]
  );
  const fieldOptions = table.fields.map((field) => ({ name: field.name, type: field.type }));
  const fields = fieldOptions.map((field) => field.name);
  const allDocuments = useMemo(() => Object.values(documents), [documents]);
  const settingsIssues = useMemo(() => tableSettingsIssues(table, allDocuments, tableDocuments), [allDocuments, table, tableDocuments]);
  const refTargets = useMemo(
    () => tableDocuments.filter((item) => item.definition.typeName !== table.typeName && targetKeyOptions(item.definition).length > 0),
    [table.typeName, tableDocuments]
  );

  const updatePrimary = (nextFields: string[]) => {
    updateDocument(document.relativePath, "Edit primary key", (draft) => {
      if (draft.definition.kind !== "table") return;
      draft.definition.keys.primary.fields = nextFields;
    });
  };

  const updateSecondary = (index: number, recipe: (key: { fields: string[]; unique?: boolean }) => void) => {
    updateDocument(document.relativePath, "Edit secondary key", (draft) => {
      if (draft.definition.kind !== "table") return;
      const key = draft.definition.keys.secondary?.[index];
      if (key) recipe(key);
    });
  };

  const addSecondary = () => {
    updateDocument(document.relativePath, "Add secondary key", (draft) => {
      if (draft.definition.kind !== "table") return;
      draft.definition.keys.secondary ??= [];
      draft.definition.keys.secondary.push({ fields: [draft.definition.fields[0]?.name ?? ""], unique: true });
    });
  };

  const deleteSecondary = (index: number) => {
    updateDocument(document.relativePath, "Delete secondary key", (draft) => {
      if (draft.definition.kind !== "table") return;
      draft.definition.keys.secondary?.splice(index, 1);
    });
  };

  const addRef = () => {
    const target = refTargets[0]?.definition;
    if (!target) return;
    const targetKey = targetKeyOptions(target)[0];
    const targetField = targetKey?.fields[0] ?? "";
    updateDocument(document.relativePath, "Add MasterRef", (draft) => {
      if (draft.definition.kind !== "table") return;
      const draftTable = draft.definition;
      draftTable.refs ??= [];
      draftTable.refs.push({
        name: uniqueRefName(draftTable, `${target.table}Ref`),
        target: target.typeName,
        targetKey: targetKey?.targetKey ?? { primary: true, fields: [] },
        fields: targetField ? [{
          local: localFieldForTarget(draftTable.fields, targetField),
          target: targetField
        }] : []
      });
    });
  };

  return (
    <section className="table-settings">
      <button className="table-settings-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        Table Settings
      </button>
      {open && (
        <div className="table-settings-body">
          <div className="table-settings-section">
            <div className="settings-section-title compact-title">
              <h3>Primary Key</h3>
            </div>
            <KeyFieldsEditor availableFields={fieldOptions} fields={table.keys.primary.fields} onChange={updatePrimary} />
            <SettingsIssueList issues={settingsIssues.primary} />
          </div>

          <div className="table-settings-section">
            <div className="settings-section-title compact-title">
              <h3>Secondary Keys</h3>
            </div>
            <div className="secondary-key-list">
              {(table.keys.secondary ?? []).map((key, index) => (
                <div className="secondary-key-row" key={index}>
                  <label className={clsx("check-row", (key.unique ?? true) && "checked")}>
                    <input
                      checked={key.unique ?? true}
                      type="checkbox"
                      onChange={(event) => updateSecondary(index, (target) => void (target.unique = event.target.checked))}
                    />
                    Unique
                  </label>
                  <KeyFieldsEditor
                    availableFields={fieldOptions}
                    fields={key.fields}
                    onChange={(nextFields) => updateSecondary(index, (target) => void (target.fields = nextFields))}
                  />
                  <SettingsIssueList issues={settingsIssues.secondary[index] ?? []} />
                  <button className="icon-button danger-icon" title="Delete secondary key" onClick={() => deleteSecondary(index)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(table.keys.secondary ?? []).length === 0 && <span className="muted">No secondary keys.</span>}
              <div className="list-add-row">
                <button className="secondary-button compact list-add-button" onClick={addSecondary}>
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="table-settings-section">
            <div className="settings-section-title compact-title">
              <h3>MasterRef</h3>
            </div>
            <div className="master-ref-list">
              {(table.refs ?? []).map((reference, index) => (
                <MasterRefEditor
                  document={document}
                  key={`${reference.name}-${index}`}
                  reference={reference}
                  refIndex={index}
                  table={table}
                  tableDocuments={tableDocuments}
                  issues={settingsIssues.refs[index] ?? []}
                />
              ))}
              {(table.refs ?? []).length === 0 && <span className="muted">No MasterRef definitions.</span>}
              <div className="list-add-row">
                <button className="secondary-button compact list-add-button" disabled={refTargets.length === 0} onClick={addRef}>
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function KeyFieldsEditor({
  availableFields,
  fields,
  onChange
}: {
  availableFields: Array<{ name: string; type: string }>;
  fields: string[];
  onChange: (fields: string[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number>();
  const [dropGap, setDropGap] = useState<number>();
  const dragIndexRef = useRef<number | undefined>(undefined);
  const dropGapRef = useRef<number | undefined>(undefined);
  const editorRef = useRef<HTMLDivElement>(null);

  const setField = (index: number, value: string) => onChange(fields.map((field, fieldIndex) => (fieldIndex === index ? value : field)));

  const moveToGap = useCallback((index: number, gap: number) => {
    let nextIndex = Math.max(0, Math.min(gap, fields.length));
    if (index < nextIndex) nextIndex -= 1;
    if (nextIndex === index) return;
    const next = [...fields];
    const [field] = next.splice(index, 1);
    next.splice(nextIndex, 0, field);
    onChange(next);
  }, [fields, onChange]);

  const startDrag = (event: React.PointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragIndexRef.current = index;
    dropGapRef.current = index;
    setDragIndex(index);
    setDropGap(index);
  };

  useEffect(() => {
    if (dragIndex == null) return;
    const updateGap = (clientY: number) => {
      const rows = Array.from(editorRef.current?.querySelectorAll<HTMLElement>("[data-key-field-index]") ?? []);
      let nextGap = fields.length;
      for (const row of rows) {
        const index = Number(row.dataset.keyFieldIndex);
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          nextGap = index;
          break;
        }
      }
      dropGapRef.current = nextGap;
      setDropGap(nextGap);
    };
    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      updateGap(event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      event.preventDefault();
      const sourceIndex = dragIndexRef.current;
      const targetGap = dropGapRef.current;
      if (sourceIndex != null && targetGap != null) moveToGap(sourceIndex, targetGap);
      dragIndexRef.current = undefined;
      dropGapRef.current = undefined;
      setDragIndex(undefined);
      setDropGap(undefined);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragIndex, fields, moveToGap]);

  return (
    <div className="key-fields-editor" ref={editorRef}>
      {fields.map((field, index) => (
        <div className="key-field-row-wrap" key={`${field}-${index}`}>
          {dropGap === index && <div className="key-drop-marker" />}
          <div
            className={clsx("key-field-row", dragIndex === index && "dragging")}
            data-key-field-index={index}
          >
            <button className="icon-button key-field-drag-handle" title="Drag to reorder key field" onPointerDown={(event) => startDrag(event, index)}>
              <GripVertical size={13} />
            </button>
            <select value={field} onChange={(event) => setField(index, event.target.value)}>
              {availableFields.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {`${candidate.name}\u00a0\u00a0(${formatTypeLabel(candidate.type)})`}
                </option>
              ))}
            </select>
            <button className="icon-button danger-icon" disabled={fields.length <= 1} title="Remove field" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
      {dropGap === fields.length && <div className="key-drop-marker" />}
      <div className="list-add-row">
        <button className="secondary-button compact list-add-button" disabled={availableFields.length === 0} onClick={() => onChange([...fields, availableFields[0].name])}>
          <Plus size={13} />
          Add
        </button>
      </div>
    </div>
  );
}

function MasterRefEditor({
  document,
  issues,
  reference,
  refIndex,
  table,
  tableDocuments
}: {
  document: DefinitionDocument;
  issues: string[];
  reference: MasterRefDefinition;
  refIndex: number;
  table: TableDefinition;
  tableDocuments: Array<DefinitionDocument & { definition: TableDefinition & { kind: "table" } }>;
}) {
  const { updateDocument } = useEditorStore();
  const targetDocument = tableDocuments.find((item) => item.definition.typeName === reference.target) ?? tableDocuments[0];
  const keyOptions = targetDocument ? targetKeyOptions(targetDocument.definition) : [];
  const selectedKey = selectedTargetKeyId(reference, keyOptions);
  const selectedKeyOption = keyOptions.find((item) => item.id === selectedKey);
  const selectableTargets = tableDocuments.filter((item) => item.definition.typeName !== table.typeName);
  const targetOptions =
    targetDocument && targetDocument.definition.typeName === table.typeName
      ? [targetDocument, ...selectableTargets]
      : selectableTargets;
  const localField = reference.fields[0]?.local ?? table.fields[0]?.name ?? "";

  const updateRef = (recipe: (reference: MasterRefDefinition, draftTable: TableDefinition) => void) => {
    updateDocument(document.relativePath, "Edit MasterRef", (draft) => {
      if (draft.definition.kind !== "table") return;
      const target = draft.definition.refs?.[refIndex];
      if (target) recipe(target, draft.definition);
    });
  };

  const applyTarget = (targetTypeName: string) => {
    const nextTarget = tableDocuments.find((item) => item.definition.typeName === targetTypeName)?.definition;
    if (!nextTarget) return;
    const key = targetKeyOptions(nextTarget)[0];
    updateRef((target) => {
      target.target = nextTarget.typeName;
      target.targetKey = key?.targetKey ?? { primary: true, fields: [] };
      const targetField = key?.fields[0] ?? "";
      target.fields = targetField
        ? [{
            local: localFieldForTarget(table.fields, targetField),
            target: targetField
          }]
        : [];
    });
  };

  const applyTargetKey = (keyId: string) => {
    const option = keyOptions.find((item) => item.id === keyId);
    if (!option) return;
    updateRef((target) => {
      target.targetKey = option.targetKey;
      const targetField = option.fields[0] ?? "";
      target.fields = targetField
        ? [{
            local: target.fields[0]?.local ?? localFieldForTarget(table.fields, targetField),
            target: targetField
          }]
        : [];
    });
  };

  const applyLocalField = (fieldName: string) => {
    updateRef((target) => {
      const targetField = selectedKeyOption?.fields[0] ?? target.fields[0]?.target ?? "";
      target.fields = targetField ? [{ local: fieldName, target: targetField }] : [];
    });
  };

  const deleteRef = () => {
    updateDocument(document.relativePath, "Delete MasterRef", (draft) => {
      if (draft.definition.kind !== "table") return;
      draft.definition.refs?.splice(refIndex, 1);
    });
  };

  return (
    <div className="master-ref-row">
      <div className="master-ref-property-row">
        <label className="master-ref-field">
          <span>Property Name</span>
          <input value={reference.name} onChange={(event) => updateRef((target) => void (target.name = event.target.value))} />
        </label>
        <button className="icon-button danger-icon" title="Delete MasterRef" onClick={deleteRef}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="master-ref-control-row">
        <label className="master-ref-field">
          <span>Field</span>
          <select value={localField} onChange={(event) => applyLocalField(event.target.value)}>
            {table.fields.map((field) => (
              <option key={field.name} value={field.name}>
                {`${field.name}\u00a0\u00a0(${formatTypeLabel(field.type)})`}
              </option>
            ))}
          </select>
        </label>
        <span className="master-ref-arrow" aria-hidden="true">→</span>
        <label className="master-ref-field">
          <span>Master</span>
          <select value={targetDocument?.definition.typeName ?? ""} onChange={(event) => applyTarget(event.target.value)}>
            {targetOptions.map((item) => (
              <option key={item.definition.typeName} value={item.definition.typeName}>
                {item.definition.typeName}
                {item.definition.typeName === table.typeName ? " (self)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="master-ref-field">
          <span>Key</span>
          <select value={selectedKey} onChange={(event) => applyTargetKey(event.target.value)}>
            {!selectedKey && <option value="">Unsupported key</option>}
            {keyOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SettingsIssueList issues={issues} />
    </div>
  );
}

function targetKeyOptions(table: TableDefinition) {
  return allTargetKeyOptions(table).filter((option) => option.fields.length === 1);
}

function allTargetKeyOptions(table: TableDefinition) {
  return [
    {
      id: "primary",
      label: `Primary: ${table.keys.primary.fields.join(", ")}`,
      fields: table.keys.primary.fields,
      targetKey: { primary: true, fields: [] },
      unique: true
    },
    ...(table.keys.secondary ?? []).map((key, index) => ({
      id: `secondary:${index}`,
      label: `SK${index + 1} ${key.unique === false ? "non-unique" : "unique"}: ${key.fields.join(", ")}`,
      fields: key.fields,
      targetKey: { primary: false, fields: [...key.fields] },
      unique: key.unique !== false
    }))
  ];
}

function selectedTargetKeyId(reference: MasterRefDefinition, options: ReturnType<typeof targetKeyOptions>) {
  if (reference.targetKey.primary) return options.some((option) => option.id === "primary") ? "primary" : "";
  const found = options.find((option) => sameFields(option.fields, reference.targetKey.fields ?? []));
  return found?.id ?? "";
}

function sameFields(left: string[], right: string[]) {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function localFieldForTarget(fields: FieldDefinition[], targetField: string) {
  return fields.find((field) => field.name === targetField)?.name ?? fields[0]?.name ?? "";
}

function uniqueRefName(table: TableDefinition, preferredName: string) {
  const names = new Set([...(table.refs ?? []).map((reference) => reference.name), ...table.fields.map((field) => field.name)]);
  if (!names.has(preferredName)) return preferredName;
  for (let index = 2; ; index += 1) {
    const candidate = `${preferredName}${index}`;
    if (!names.has(candidate)) return candidate;
  }
}

function SettingsIssueList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="settings-issue-list">
      {issues.map((issue) => (
        <div className="settings-issue" key={issue}>
          <AlertCircle size={13} />
          <span>{issue}</span>
        </div>
      ))}
    </div>
  );
}

function tableSettingsIssues(
  table: TableDefinition,
  documents: DefinitionDocument[],
  tableDocuments: Array<DefinitionDocument & { definition: TableDefinition & { kind: "table" } }>
) {
  const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
  const primary = keyDefinitionIssues("Primary key", table.keys.primary.fields, fieldMap, documents);
  const secondary = (table.keys.secondary ?? []).map((key, index) =>
    keyDefinitionIssues(`SK${index + 1}`, key.fields, fieldMap, documents)
  );
  const keySignatures = new Map<string, string>();
  registerKeySignature("Primary key", table.keys.primary.fields, keySignatures, primary);
  (table.keys.secondary ?? []).forEach((key, index) => {
    registerKeySignature(`SK${index + 1}`, key.fields, keySignatures, secondary[index]);
  });

  const refs = (table.refs ?? []).map((reference, index) =>
    masterRefIssues(reference, index, table, tableDocuments)
  );
  return { primary, secondary, refs };
}

function keyDefinitionIssues(
  label: string,
  fields: string[],
  fieldMap: Map<string, FieldDefinition>,
  documents: DefinitionDocument[]
) {
  const issues: string[] = [];
  if (fields.length === 0) issues.push(`${label} must contain at least one field.`);
  const seen = new Set<string>();
  for (const fieldName of fields) {
    if (seen.has(fieldName)) issues.push(`${label} contains duplicate field "${fieldName}".`);
    seen.add(fieldName);
    const field = fieldMap.get(fieldName);
    if (!field) {
      issues.push(`${label} references unknown field "${fieldName}".`);
      continue;
    }
    if (!isKeyCompatibleField(field, documents)) {
      issues.push(`${label} field "${fieldName}" cannot be used as a key.`);
    }
  }
  return issues;
}

function registerKeySignature(label: string, fields: string[], signatures: Map<string, string>, issues: string[]) {
  const signature = fields.join("\u0000");
  if (!signature) return;
  const previous = signatures.get(signature);
  if (previous) {
    issues.push(`${label} duplicates ${previous}.`);
    return;
  }
  signatures.set(signature, label);
}

function masterRefIssues(
  reference: MasterRefDefinition,
  refIndex: number,
  table: TableDefinition,
  tableDocuments: Array<DefinitionDocument & { definition: TableDefinition & { kind: "table" } }>
) {
  const issues: string[] = [];
  const targetDocument = tableDocuments.find((item) => item.definition.typeName === reference.target);
  const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
  const duplicateNames = new Set<string>();
  const memberNames = new Set(table.fields.map((field) => field.name));

  for (const [index, item] of (table.refs ?? []).entries()) {
    if (index === refIndex) continue;
    if (item.name === reference.name) duplicateNames.add(item.name);
  }
  if (!reference.name.trim()) issues.push("Property Name is required.");
  if (memberNames.has(reference.name)) issues.push(`Property Name "${reference.name}" conflicts with a field.`);
  if (duplicateNames.has(reference.name)) issues.push(`Property Name "${reference.name}" duplicates another MasterRef.`);
  if (!targetDocument) {
    issues.push(`Master "${reference.target}" does not exist.`);
    return issues;
  }
  if (targetDocument.definition.typeName === table.typeName) issues.push("Self MasterRef is not allowed.");

  const allKey = selectedTargetKey(reference, targetDocument.definition);
  const selectableKey = targetKeyOptions(targetDocument.definition).find((option) => sameFields(option.fields, allKey?.fields ?? []));
  if (!allKey) {
    issues.push("Selected key does not exist on target master.");
    return issues;
  }
  if (allKey.fields.length !== 1) {
    issues.push("Composite keys cannot be used by MasterRef in the editor.");
    return issues;
  }
  if (!selectableKey) issues.push("Selected key is not selectable.");
  if (reference.fields.length !== 1) issues.push("MasterRef must map exactly one field.");

  const mapping = reference.fields[0];
  const targetFieldName = allKey.fields[0];
  const targetField = targetDocument.definition.fields.find((field) => field.name === targetFieldName);
  if (!mapping) return issues;
  if (mapping.target !== targetFieldName) issues.push(`Mapped target field must be "${targetFieldName}".`);

  const localField = fieldMap.get(mapping.local);
  if (!localField) issues.push(`Field "${mapping.local}" does not exist.`);
  if (!targetField) issues.push(`Target key field "${targetFieldName}" does not exist.`);
  if (localField && targetField && comparableFieldType(localField.type) !== targetField.type) {
    issues.push(`Field type ${formatTypeLabel(localField.type)} does not match target key type ${formatTypeLabel(targetField.type)}.`);
  }
  if (localField && isListType(localField.type) && allKey.unique === false) {
    issues.push("Array-valued MasterRef field must target a unique key.");
  }
  return issues;
}

function selectedTargetKey(reference: MasterRefDefinition, table: TableDefinition) {
  if (reference.targetKey.primary) return allTargetKeyOptions(table)[0];
  return allTargetKeyOptions(table).find((option) => sameFields(option.fields, reference.targetKey.fields ?? []));
}

function isKeyCompatibleField(field: FieldDefinition, documents: DefinitionDocument[]) {
  if (isListType(field.type)) return false;
  if (field.type === "int" || field.type === "long" || field.type === "string") return true;
  return documents.some((document) => document.definition.kind === "enum" && document.typeName === field.type);
}

function comparableFieldType(type: string) {
  return isListType(type) ? unwrapListType(type) : type;
}

function RecordsGrid({
  document,
  rows,
  table
}: {
  document: DefinitionDocument;
  rows: VisibleRow[];
  table: TableDefinition;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addRow, deleteRow, documents, project, updateCell, updateDocument, zoom } = useEditorStore();
  const rowHeight = scaledSize(ROW_HEIGHT, zoom);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12
  });
  const gridTemplateColumns = useMemo(() => gridColumns(table.fields.length, zoom), [table.fields.length, zoom]);
  const primaryFields = new Set(table.keys.primary.fields);
  const secondaryFieldIndexes = useMemo(() => {
    const indexes = new Map<string, number[]>();
    (table.keys.secondary ?? []).forEach((key, keyIndex) => {
      for (const fieldName of key.fields) {
        const fieldIndexes = indexes.get(fieldName) ?? [];
        fieldIndexes.push(keyIndex);
        indexes.set(fieldName, fieldIndexes);
      }
    });
    return indexes;
  }, [table.keys.secondary]);
  const secondaryFields = new Set(secondaryFieldIndexes.keys());
  const refFields = new Set((table.refs ?? []).flatMap((ref) => ref.fields.map((field) => field.local)));
  const duplicateKeys = useMemo(() => duplicatePrimaryKeys(table), [table]);
  const duplicateKeyIndexes = useMemo(() => duplicateMessagePackKeys(table.fields), [table.fields]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number }>();
  const [activeCell, setActiveCell] = useState<ActiveCellState>();
  const [structCell, setStructCell] = useState<SelectedStructCell>();
  const [flagsCell, setFlagsCell] = useState<SelectedFlagsCell>();
  const [listCell, setListCell] = useState<SelectedListCell>();
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>();
  const structDefinitions = useMemo(() => structDefinitionMap(documents), [documents]);
  const availableTags = project?.availableTags ?? [];
  const rowTagSuggestions = useMemo(
    () => uniqueTags([...availableTags, ...table.rows.flatMap((row) => row.meta?.tags ?? [])]),
    [availableTags, table.rows]
  );
  const allowCustomRowTags = availableTags.length === 0;
  const drag = useGapDrag(scrollRef, (from, gap) => {
    updateDocument(document.relativePath, "Reorder field", (draft) => {
      if (draft.definition.kind !== "table") return;
      moveFieldToGap(draft.definition.fields, from, gap);
    });
  });
  const [selectedRow, setSelectedRow] = useState<SelectedRowState>();
  const [rowClipboard, setRowClipboard] = useState<RowDefinition>();
  const [rowContextMenu, setRowContextMenu] = useState<{ x: number; y: number; visibleRowIndex: number; originalIndex: number }>();
  const [recordsCreateMenu, setRecordsCreateMenu] = useState<{ x: number; y: number }>();
  const inputGroups = useRef<Record<string, string | undefined>>({});
  const inputGroupSeq = useRef(0);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!rowContextMenu) return;
    const close = () => setRowContextMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [rowContextMenu]);

  useEffect(() => {
    if (!recordsCreateMenu) return;
    const close = () => setRecordsCreateMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [recordsCreateMenu]);

  useEffect(() => {
    if (!selectedRow) return;
    if (!rows.some((entry, visibleRowIndex) => visibleRowIndex === selectedRow.visibleRowIndex && entry.originalIndex === selectedRow.originalIndex)) {
      setSelectedRow(undefined);
    }
  }, [rows, selectedRow]);

  useEffect(() => {
    const clearSelection = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          [
            ".grid-cell-shell",
            ".row-head",
            "[data-cell-popover='true']",
            ".list-value-popover",
            ".context-menu",
            ".tree-create-menu",
            ".tag-token-menu",
            ".enum-cell-menu"
          ].join(",")
        )
      ) {
        return;
      }
      setActiveCell(undefined);
      setSelectedRow(undefined);
      setStructCell(undefined);
      setFlagsCell(undefined);
      setListCell(undefined);
    };
    window.addEventListener("pointerdown", clearSelection, true);
    return () => window.removeEventListener("pointerdown", clearSelection, true);
  }, []);

  const selectRow = (visibleRowIndex: number, originalIndex: number) => {
    setSelectedRow({ visibleRowIndex, originalIndex });
    setActiveCell(undefined);
    setStructCell(undefined);
    setFlagsCell(undefined);
    setListCell(undefined);
  };

  const copyRowAt = (originalIndex: number) => {
    const source = table.rows[originalIndex];
    if (!source) return;
    setRowClipboard(cloneRowForFields(source, table.fields, documents, structDefinitions));
  };

  const pasteRowAt = (originalIndex: number) => {
    if (!rowClipboard) return;
    updateDocument(document.relativePath, "Paste record", (draft) => {
      if (draft.definition.kind !== "table") return;
      if (!draft.definition.rows[originalIndex]) return;
      draft.definition.rows[originalIndex] = cloneRowForFields(rowClipboard, draft.definition.fields, documents, structDefinitions);
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedRow || isEditableElement(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (!command) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        copyRowAt(selectedRow.originalIndex);
      }
      if (key === "v") {
        event.preventDefault();
        pasteRowAt(selectedRow.originalIndex);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [documents, rowClipboard, selectedRow, structDefinitions, table.fields, table.rows, updateDocument]);

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey || !scrollRef.current) return;
    scrollRef.current.scrollLeft += event.deltaY;
  };

  const updatePopoverPosition = () => {
    const popoverCell = structCell ?? flagsCell ?? listCell;
    if (!popoverCell) {
      setPopoverPosition(undefined);
      return;
    }
    const grid = scrollRef.current?.querySelector<HTMLElement>(".master-grid");
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-grid-cell-row="${popoverCell.visibleRowIndex}"][data-grid-cell-field="${popoverCell.fieldIndex}"]`
    );
    if (!grid || !target) {
      setPopoverPosition(undefined);
      return;
    }
    const gridRect = grid.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setPopoverPosition({
      left: targetRect.left - gridRect.left,
      top: targetRect.bottom - gridRect.top
    });
  };

  useEffect(() => {
    updatePopoverPosition();
    if ((!structCell && !flagsCell && !listCell) || !scrollRef.current) return;
    const onScroll = () => window.requestAnimationFrame(updatePopoverPosition);
    const onResize = () => window.requestAnimationFrame(updatePopoverPosition);
    const scrollElement = scrollRef.current;
    scrollElement.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [flagsCell, listCell, structCell, rows]);

  useEffect(() => {
    if (!structCell && !flagsCell && !listCell) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setStructCell(undefined);
      setFlagsCell(undefined);
      setListCell(undefined);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [flagsCell, listCell, structCell]);

  useEffect(() => {
    const popoverCell = structCell ?? flagsCell ?? listCell;
    if (!popoverCell) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const activeCellElement = scrollRef.current?.querySelector<HTMLElement>(
        `[data-grid-cell-row="${popoverCell.visibleRowIndex}"][data-grid-cell-field="${popoverCell.fieldIndex}"]`
      );
      if (activeCellElement?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-cell-popover='true']")) return;
      setStructCell(undefined);
      setFlagsCell(undefined);
      setListCell(undefined);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [flagsCell, listCell, structCell]);

  const reorderColumn = (from: number, to: number) => {
    if (from < 0 || to < 0 || from === to) return;
    updateDocument(document.relativePath, "Reorder field", (draft) => {
      if (draft.definition.kind !== "table") return;
      moveFieldToIndex(draft.definition.fields, from, to);
    });
  };

  const insertColumn = (index: number, side: "left" | "right") => {
    updateDocument(document.relativePath, "Insert field", (draft) => {
      if (draft.definition.kind !== "table") return;
      const insertIndex = side === "left" ? index : index + 1;
      const field = createField(draft.definition.fields, `Field${draft.definition.fields.length + 1}`, "string");
      draft.definition.fields.splice(insertIndex, 0, field);
      for (const row of draft.definition.rows) row.data[field.name] = "";
    });
  };

  const duplicateColumn = (index: number) => {
    updateDocument(document.relativePath, "Duplicate field", (draft) => {
      if (draft.definition.kind !== "table") return;
      const source = draft.definition.fields[index];
      if (!source) return;
      const field = createField(draft.definition.fields, `${source.name}Copy`, source.type);
      draft.definition.fields.splice(index + 1, 0, field);
      for (const row of draft.definition.rows) row.data[field.name] = cloneMasterValue(row.data[source.name]);
    });
  };

  const deleteColumn = (index: number) => {
    const field = table.fields[index];
    if (!field || !window.confirm(`Delete field ${field.name}?`)) return;
    updateDocument(document.relativePath, `Delete field ${field.name}`, (draft) => {
      if (draft.definition.kind !== "table") return;
      const [removed] = draft.definition.fields.splice(index, 1);
      if (!removed) return;
      for (const row of draft.definition.rows) delete row.data[removed.name];
      removeFieldName(draft.definition.keys.primary.fields, removed.name);
      for (const key of draft.definition.keys.secondary ?? []) removeFieldName(key.fields, removed.name);
      for (const ref of draft.definition.refs ?? []) {
        ref.fields = ref.fields.filter((mapping) => mapping.local !== removed.name);
      }
    });
  };

  const editMessagePackKey = (index: number) => {
    const field = table.fields[index];
    if (!field) return;
    if (!window.confirm("Changing MessagePack Key can break binary compatibility. Continue?")) return;
    const raw = window.prompt("MessagePack Key", String(messagePackKey(field, index)));
    if (raw == null) return;
    const next = Number.parseInt(raw, 10);
    if (!Number.isInteger(next) || next < 0) return;
    updateDocument(document.relativePath, `Edit ${field.name} MessagePack Key`, (draft) => {
      if (draft.definition.kind !== "table") return;
      draft.definition.fields[index].fixedIndex = next;
    });
  };

  const openColumnMenu = (event: React.MouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const x = event.clientX;
    const y = event.clientY;
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("popup_table_column_menu", {
        index,
        canMoveLeft: index > 0,
        canMoveRight: index < table.fields.length - 1,
        x,
        y
      }).catch(() => setContextMenu({ x, y, index }));
      return;
    }
    setContextMenu({ x, y, index });
  };

  const beginInputGroup = (key: string) => {
    inputGroups.current[key] = `${document.relativePath}:table:${key}:${inputGroupSeq.current++}`;
  };

  const endInputGroup = (key: string) => {
    inputGroups.current[key] = undefined;
  };

  const inputGroup = (key: string) => inputGroups.current[key];

  const renameField = (index: number, nextName: string, historyGroup?: string) => {
    const oldName = table.fields[index].name;
    updateDocument(document.relativePath, `Rename field ${oldName}`, (draft) => {
      if (draft.definition.kind !== "table") return;
      const field = draft.definition.fields[index];
      field.name = nextName;
      for (const row of draft.definition.rows) {
        if (Object.prototype.hasOwnProperty.call(row.data, oldName)) {
          row.data[nextName] = row.data[oldName];
          delete row.data[oldName];
        }
      }
      replaceFieldName(draft.definition.keys.primary.fields, oldName, nextName);
      for (const key of draft.definition.keys.secondary ?? []) replaceFieldName(key.fields, oldName, nextName);
      for (const ref of draft.definition.refs ?? []) {
        for (const mapping of ref.fields) {
          if (mapping.local === oldName) mapping.local = nextName;
        }
      }
    }, { historyGroup });
  };

  const addField = () => {
    updateDocument(document.relativePath, "Add field", (draft) => {
      if (draft.definition.kind !== "table") return;
      const field = createField(draft.definition.fields, `Field${draft.definition.fields.length + 1}`, "string");
      draft.definition.fields.push(field);
      for (const row of draft.definition.rows) row.data[field.name] = "";
    });
  };

  const addRecord = () => addRow(document.relativePath);

  const openRecordMenu = (event: React.MouseEvent, visibleRowIndex: number, originalIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    selectRow(visibleRowIndex, originalIndex);
    const x = event.clientX;
    const y = event.clientY;
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("popup_table_record_menu", {
        index: originalIndex,
        canPaste: Boolean(rowClipboard),
        x,
        y
      }).catch(() => setRowContextMenu({ x, y, visibleRowIndex, originalIndex }));
      return;
    }
    setRowContextMenu({ x, y, visibleRowIndex, originalIndex });
  };

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<TableIndexedMenuEvent>("table-column-action", (event) => {
      const { action, index } = event.payload;
      if (action === "move_left") reorderColumn(index, index - 1);
      if (action === "move_right") reorderColumn(index, index + 1);
      if (action === "move_first") reorderColumn(index, 0);
      if (action === "move_last") reorderColumn(index, table.fields.length - 1);
      if (action === "insert_left") insertColumn(index, "left");
      if (action === "insert_right") insertColumn(index, "right");
      if (action === "duplicate") duplicateColumn(index);
      if (action === "delete") deleteColumn(index);
      if (action === "edit_key") editMessagePackKey(index);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [document.relativePath, table.fields, table.fields.length, updateDocument]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<TableIndexedMenuEvent>("table-record-action", (event) => {
      const { action, index } = event.payload;
      if (action === "copy") copyRowAt(index);
      if (action === "paste") pasteRowAt(index);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [documents, rowClipboard, structDefinitions, table.fields, table.rows, updateDocument]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<TableCreateEvent>("table-create-entry", (event) => {
      if (event.payload.kind === "field") addField();
      if (event.payload.kind === "record") addRecord();
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, [addRow, document.relativePath, table.fields, updateDocument]);

  const openRecordsCreateMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const x = event.clientX;
    const y = event.clientY;
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("popup_table_create_menu", { x, y })
        .catch(() => setRecordsCreateMenu({ x, y }));
      return;
    }
    setRecordsCreateMenu({ x, y });
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, fieldIndex: number) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    event.preventDefault();
    const lines = text
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    updateDocument(document.relativePath, "Paste cells", (draft) => {
      if (draft.definition.kind !== "table") return;
      for (let y = 0; y < lines.length; y += 1) {
        const targetRow = draft.definition.rows[rowIndex + y];
        if (!targetRow) continue;
        for (let x = 0; x < lines[y].length; x += 1) {
          const field = draft.definition.fields[fieldIndex + x];
          if (!field) continue;
          targetRow.data[field.name] = coerceValue(field.type, lines[y][x]);
        }
      }
    });
  };

  const setActiveGridCell = (visibleRowIndex: number, field: GridField, mode: ActiveCellState["mode"]) => {
    const cell = { visibleRowIndex, field, mode };
    setActiveCell(cell);
    setSelectedRow(undefined);
    if (field === "tags") {
      setStructCell(undefined);
      setFlagsCell(undefined);
      setListCell(undefined);
      return;
    }
    const entry = rows[visibleRowIndex];
    const fieldDefinition = table.fields[field];
    if (entry && fieldDefinition && isListType(fieldDefinition.type)) {
      setListCell({ elementType: unwrapListType(fieldDefinition.type), fieldIndex: field, originalIndex: entry.originalIndex, visibleRowIndex });
      setStructCell(undefined);
      setFlagsCell(undefined);
      return;
    }
    if (entry && fieldDefinition && structDefinitions[fieldDefinition.type]) {
      setStructCell({ fieldIndex: field, originalIndex: entry.originalIndex, typeName: fieldDefinition.type, visibleRowIndex });
      setFlagsCell(undefined);
      setListCell(undefined);
      return;
    }
    const enumInfo = fieldDefinition ? enumInfoForType(documents, fieldDefinition.type) : undefined;
    if (entry && fieldDefinition && enumInfo?.flags) {
      setFlagsCell({ fieldIndex: field, originalIndex: entry.originalIndex, typeName: fieldDefinition.type, visibleRowIndex });
      setStructCell(undefined);
      setListCell(undefined);
      return;
    }
    setStructCell(undefined);
    setFlagsCell(undefined);
    setListCell(undefined);
  };

  const focusGridCell = (visibleRowIndex: number, field: GridField, edit = false) => {
    setActiveGridCell(visibleRowIndex, field, edit ? "edit" : "select");
    rowVirtualizer.scrollToIndex(visibleRowIndex, { align: "auto" });
    window.setTimeout(() => {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-grid-cell-row="${visibleRowIndex}"][data-grid-cell-field="${field}"]`
      );
      if (!target) return;
      if (edit) {
        const input = target.querySelector<HTMLElement>("input, button, select, textarea");
        input?.focus();
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.select();
      } else {
        target.focus();
      }
    }, 0);
  };

  const beginEditingCell = (visibleRowIndex: number, field: GridField) => {
    focusGridCell(visibleRowIndex, field, true);
  };

  const usesPopoverEditorField = (field: GridField) => {
    if (field === "tags") return false;
    const fieldDefinition = table.fields[field];
    if (!fieldDefinition) return false;
    return isListType(fieldDefinition.type)
      || Boolean(structDefinitions[fieldDefinition.type])
      || Boolean(enumInfoForType(documents, fieldDefinition.type)?.flags);
  };

  const clearGridCell = (visibleRowIndex: number, field: GridField) => {
    const entry = rows[visibleRowIndex];
    if (!entry) return;
    updateDocument(document.relativePath, "Clear cell", (draft) => {
      if (draft.definition.kind !== "table") return;
      const targetRow = draft.definition.rows[entry.originalIndex];
      if (!targetRow) return;
      if (field === "tags") {
        targetRow.meta = undefined;
        return;
      }
      const fieldDefinition = draft.definition.fields[field];
      if (!fieldDefinition) return;
      delete targetRow.data[fieldDefinition.name];
    });
  };

  const copyGridCellText = (visibleRowIndex: number, field: GridField) => {
    const entry = rows[visibleRowIndex];
    if (!entry) return;
    const text = gridCellDisplayText(entry.row, field);
    void navigator.clipboard?.writeText(text);
  };

  const gridCellDisplayText = (row: RowDefinition, field: GridField) => {
    if (field === "tags") {
      const tags = row.meta?.tags ?? [];
      return tags.length > 0 ? tags.join(", ") : "untagged";
    }
    const fieldDefinition = table.fields[field];
    if (!fieldDefinition) return "";
    const value = row.data[fieldDefinition.name];
    const empty = isEmptyCellValue(value);
    const baseText = empty
      ? defaultPlaceholderForType(fieldDefinition.type, documents, structDefinitions)
      : formatCellDisplayValue(fieldDefinition, value, documents, structDefinitions);
    if (!isListType(fieldDefinition.type)) return baseText;
    return `${baseText} (${listItemCount(value)})`;
  };

  const focusRelativeGridInput = (visibleRowIndex: number, field: GridField, rowDelta: number, columnDelta: number) => {
    const columnCount = table.fields.length + 1;
    const currentColumn = gridFieldToColumn(field);
    let nextVisibleRowIndex = visibleRowIndex + rowDelta;
    let nextColumn = currentColumn + columnDelta;
    if (columnDelta > 0 && nextColumn >= columnCount) {
      if (visibleRowIndex < rows.length - 1) {
        nextVisibleRowIndex = visibleRowIndex + 1;
        nextColumn = 0;
      } else {
        nextVisibleRowIndex = visibleRowIndex;
        nextColumn = columnCount - 1;
      }
    }
    if (columnDelta < 0 && nextColumn < 0) {
      if (visibleRowIndex > 0) {
        nextVisibleRowIndex = visibleRowIndex - 1;
        nextColumn = columnCount - 1;
      } else {
        nextVisibleRowIndex = visibleRowIndex;
        nextColumn = 0;
      }
    }
    nextVisibleRowIndex = clamp(nextVisibleRowIndex, 0, rows.length - 1);
    nextColumn = clamp(nextColumn, 0, columnCount - 1);
    focusGridCell(nextVisibleRowIndex, columnToGridField(nextColumn));
  };

  const handleSelectedCellKeyDown = (event: React.KeyboardEvent<HTMLElement>, visibleRowIndex: number, field: GridField) => {
    const key = event.key;
    const command = event.metaKey || event.ctrlKey;
    if (command && key.toLowerCase() === "c") {
      event.preventDefault();
      copyGridCellText(visibleRowIndex, field);
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      clearGridCell(visibleRowIndex, field);
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, field, 0, event.shiftKey ? -1 : 1);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) focusRelativeGridInput(visibleRowIndex, field, -1, 0);
      else if (usesPopoverEditorField(field)) focusGridCell(visibleRowIndex, field);
      else beginEditingCell(visibleRowIndex, field);
      return;
    }
    if (key === "F2") {
      event.preventDefault();
      if (usesPopoverEditorField(field)) focusGridCell(visibleRowIndex, field);
      else beginEditingCell(visibleRowIndex, field);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, field, -1, 0);
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, field, 1, 0);
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, field, 0, -1);
      return;
    }
    if (key !== "ArrowRight") return;
    event.preventDefault();
    focusRelativeGridInput(visibleRowIndex, field, 0, 1);
  };

  const handleEditingInputKeyDown = (event: React.KeyboardEvent<HTMLElement>, visibleRowIndex: number, field: GridField) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      focusGridCell(visibleRowIndex, field);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, field, 0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    focusRelativeGridInput(visibleRowIndex, field, event.shiftKey ? -1 : 1, 0);
  };

  const handleTagEditingKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, visibleRowIndex: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      focusGridCell(visibleRowIndex, "tags");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, "tags", 0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, "tags", -1, 0);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      focusRelativeGridInput(visibleRowIndex, "tags", event.shiftKey ? -1 : 1, 0);
    }
  };

  const flagsField = flagsCell ? table.fields[flagsCell.fieldIndex] : undefined;
  const flagsValue = flagsCell && flagsField ? formatValue(table.rows[flagsCell.originalIndex]?.data[flagsField.name]) : "";
  const listField = listCell ? table.fields[listCell.fieldIndex] : undefined;
  const listValue = listCell && listField ? table.rows[listCell.originalIndex]?.data[listField.name] : undefined;

  return (
    <section className="records-panel">
      <div className="section-heading records-heading">
        <button className="icon-button records-create-button" title="Create" onClick={openRecordsCreateMenu}>
          <Plus size={14} />
        </button>
        <Table2 size={15} />
        Records
        <span>
          {rows.filter((entry) => !entry.filteredOut).length} / {table.rows.length}
        </span>
        {recordsCreateMenu && (
          <RecordsCreateMenu
            onCreateField={addField}
            onCreateRecord={addRecord}
            x={recordsCreateMenu.x}
            y={recordsCreateMenu.y}
          />
        )}
      </div>
      <div className="records-grid" ref={scrollRef} onWheel={onWheel}>
        <div className="master-grid" style={{ minWidth: totalGridWidth(table.fields.length, zoom) }}>
          <div className="grid-header" style={{ gridTemplateColumns }}>
            {drag.state && <div className="gap-marker header-gap-marker" style={{ left: drag.state.left }} />}
            <div className="row-head">#</div>
            <div className="meta-head">
              <Tags size={13} />
              <span>tags</span>
            </div>
            {table.fields.map((field, index) => {
              const secondaryIndexes = secondaryFieldIndexes.get(field.name) ?? [];
              return (
                <div
                  className={clsx("grid-col-head", primaryFields.has(field.name) && "primary-col", secondaryIndexes.length > 0 && "secondary-col")}
                  data-field-index={index}
                  key={field.name}
                  onContextMenu={(event) => openColumnMenu(event, index)}
                >
                  <div className="col-head-title">
                    <button className="drag-handle column-drag-handle" onPointerDown={(event) => drag.start(index, event)} title="Drag to reorder field">
                      <GripVertical size={13} />
                    </button>
                    <span className={clsx("badge key", duplicateKeyIndexes.has(messagePackKey(field, index)) && "duplicate")}>
                      Key {messagePackKey(field, index)}
                    </span>
                    {primaryFields.has(field.name) && <span className="badge primary">PK</span>}
                    {secondaryIndexes.map((keyIndex) => (
                      <span
                        className={clsx("badge secondary", `secondary-${(keyIndex % SECONDARY_BADGE_VARIANTS) + 1}`)}
                        key={keyIndex}
                      >
                        SK{keyIndex + 1}
                      </span>
                    ))}
                    {refFields.has(field.name) && <span className="badge ref">REF</span>}
                  </div>
                  <input
                    className="column-name-input"
                    value={field.name}
                    onBlur={() => endInputGroup(`column-name-${index}`)}
                    onChange={(event) => renameField(index, event.target.value, inputGroup(`column-name-${index}`))}
                    onFocus={() => beginInputGroup(`column-name-${index}`)}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                  <FieldTypeControl
                    className="column-type-control"
                    documents={documents}
                    type={field.type}
                    onChange={(nextType) =>
                      updateDocument(document.relativePath, `Change ${field.name} type`, (draft) => {
                        if (draft.definition.kind !== "table") return;
                        draft.definition.fields[index].type = nextType;
                      })
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                </div>
              );
            })}
            <div className="grid-add-field-head">
              <button className="icon-button grid-header-add-field" title="Add field" onClick={addField}>
                <Plus size={14} />
              </button>
            </div>
          </div>
          {contextMenu && (
            <ColumnContextMenu
              canMoveLeft={contextMenu.index > 0}
              canMoveRight={contextMenu.index < table.fields.length - 1}
              onDelete={() => deleteColumn(contextMenu.index)}
              onDuplicate={() => duplicateColumn(contextMenu.index)}
              onEditKey={() => editMessagePackKey(contextMenu.index)}
              onInsertLeft={() => insertColumn(contextMenu.index, "left")}
              onInsertRight={() => insertColumn(contextMenu.index, "right")}
              onMoveFirst={() => reorderColumn(contextMenu.index, 0)}
              onMoveLast={() => reorderColumn(contextMenu.index, table.fields.length - 1)}
              onMoveLeft={() => reorderColumn(contextMenu.index, contextMenu.index - 1)}
              onMoveRight={() => reorderColumn(contextMenu.index, contextMenu.index + 1)}
              x={contextMenu.x}
              y={contextMenu.y}
            />
          )}
          {rowContextMenu && (
            <RowContextMenu
              canPaste={Boolean(rowClipboard)}
              onCopy={() => copyRowAt(rowContextMenu.originalIndex)}
              onPaste={() => pasteRowAt(rowContextMenu.originalIndex)}
              x={rowContextMenu.x}
              y={rowContextMenu.y}
            />
          )}
          <div className="virtual-canvas" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {drag.state && <div className="gap-marker records-gap-marker" style={{ left: drag.state.left }} />}
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = rows[virtualRow.index];
              if (!entry) return null;
              const row = entry.row;
              const rowTags = row.meta?.tags ?? [];
              const tagCell: ActiveCell = { visibleRowIndex: virtualRow.index, field: "tags" };
              const isTagActive = sameCell(activeCell, tagCell);
              const isTagEditing = isTagActive && activeCell?.mode === "edit";
              const primaryKey = table.keys.primary.fields.map((field) => String(row.data[field] ?? "")).join("|");
              const hasDuplicatePrimaryKey = duplicateKeys.has(primaryKey);
              const tagIssues = rowTagIssues(rowTags, availableTags);
              const cellIssues = table.fields.map((field) => cellIssuesForField(field, row.data[field.name], documents, structDefinitions));
              const rowIssues = [
                ...(hasDuplicatePrimaryKey ? [`Duplicate primary key: ${primaryKey || "(empty)"}`] : []),
                ...tagIssues,
                ...cellIssues.flat()
              ];
              const hasRowIssue = rowIssues.length > 0;
              const isRowSelected = selectedRow?.originalIndex === entry.originalIndex;
              return (
                <div
                  className={clsx("grid-row", entry.filteredOut && "profile-filtered", isRowSelected && "row-selected")}
                  key={virtualRow.key}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns,
                    height: rowHeight
                  }}
                >
                  <div
                    className={clsx("row-head", hasRowIssue && "row-error", isRowSelected && "selected")}
                    onClick={() => selectRow(virtualRow.index, entry.originalIndex)}
                    onContextMenu={(event) => openRecordMenu(event, virtualRow.index, entry.originalIndex)}
                    tabIndex={0}
                  >
                    <span>{entry.originalIndex + 1}</span>
                    {hasRowIssue && (
                      <span className="row-error-marker" title={rowIssues.join("\n")}>
                        <AlertCircle size={13} />
                      </span>
                    )}
                    <button
                      className="row-delete-button danger-icon"
                      title="Delete record"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteRow(document.relativePath, entry.originalIndex);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div
                    className={clsx("tag-cell", "grid-cell-shell", tagIssues.length > 0 && "invalid", isTagActive && "selected", isTagEditing && "editing")}
                    data-grid-cell-field="tags"
                    data-grid-cell-row={virtualRow.index}
                    tabIndex={0}
                    title={tagIssues.length > 0 ? tagIssues.join("\n") : undefined}
                    onDoubleClick={() => beginEditingCell(virtualRow.index, "tags")}
                    onFocus={() => {
                      setActiveGridCell(virtualRow.index, "tags", isTagEditing ? "edit" : "select");
                      setStructCell(undefined);
                      setFlagsCell(undefined);
                      setListCell(undefined);
                    }}
                    onKeyDown={(event) => handleSelectedCellKeyDown(event, virtualRow.index, "tags")}
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) focusGridCell(virtualRow.index, "tags");
                    }}
                  >
                    {isTagEditing ? (
                      <TagTokenInput
                        allowCustom={allowCustomRowTags}
                        className="tag-cell-editor"
                        dataGridField="tags"
                        dataGridRow={virtualRow.index}
                        placeholder="untagged"
                        suggestions={rowTagSuggestions}
                        value={rowTags}
                        onNavigateKeyDown={(event) => handleTagEditingKeyDown(event, virtualRow.index)}
                        onFocus={() => {
                          setStructCell(undefined);
                          setFlagsCell(undefined);
                          setListCell(undefined);
                        }}
                        onChange={(tags) =>
                          updateDocument(document.relativePath, "Edit row tags", (draft) => {
                            if (draft.definition.kind !== "table") return;
                            draft.definition.rows[entry.originalIndex].meta = tags.length > 0 ? { tags } : undefined;
                          })
                        }
                      />
                    ) : (
                      <button
                        className="tag-cell-display"
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          beginEditingCell(virtualRow.index, "tags");
                        }}
                      >
                        {rowTags.length === 0 ? (
                          <span className="tag-placeholder">untagged</span>
                        ) : (
                          rowTags.map((tag) => (
                            <span className="tag-token readonly" key={tag}>
                              {tag}
                            </span>
                          ))
                        )}
                      </button>
                    )}
                  </div>
                  {table.fields.map((field, fieldIndex) => {
                    const cell: ActiveCell = { visibleRowIndex: virtualRow.index, field: fieldIndex };
                    const isSelected = sameCell(activeCell, cell);
                    const isEditing = isSelected && activeCell?.mode === "edit";
                    const enumInfo = enumInfoForType(documents, field.type);
                    const isFlagsEnum = Boolean(enumInfo?.flags);
                    const isListField = isListType(field.type);
                    const fieldIssues = cellIssues[fieldIndex];
                    const structDefinition = structDefinitions[field.type];
                    const usesPopoverEditor = isFlagsEnum || isListField || Boolean(structDefinition);
                    const placeholder = defaultPlaceholderForType(field.type, documents, structDefinitions);
                    const displayValue = formatCellDisplayValue(field, row.data[field.name], documents, structDefinitions);
                    return (
                      <div
                        key={field.name}
                        className={clsx(
                          "grid-cell",
                          "grid-cell-shell",
                          primaryFields.has(field.name) && "primary-col",
                          secondaryFields.has(field.name) && "secondary-col",
                          fieldIssues.length > 0 && "invalid",
                          isSelected && "selected",
                          isEditing && "editing"
                        )}
                        data-grid-cell-field={fieldIndex}
                        data-grid-cell-row={virtualRow.index}
                        tabIndex={0}
                        title={fieldIssues.length > 0 ? fieldIssues.join("\n") : undefined}
                        onDoubleClick={() => (usesPopoverEditor ? focusGridCell(virtualRow.index, fieldIndex) : beginEditingCell(virtualRow.index, fieldIndex))}
                        onFocus={() => setActiveGridCell(virtualRow.index, fieldIndex, isEditing ? "edit" : "select")}
                        onKeyDown={(event) => handleSelectedCellKeyDown(event, virtualRow.index, fieldIndex)}
                        onMouseDown={(event) => {
                          if (event.target === event.currentTarget) focusGridCell(virtualRow.index, fieldIndex);
                        }}
                      >
                        {isEditing && !usesPopoverEditor ? (
                          <MasterValueInput
                            dataGridField={fieldIndex}
                            dataGridRow={virtualRow.index}
                            documents={documents}
                            placeholder={placeholder}
                            structDefinitions={structDefinitions}
                            type={field.type}
                            value={row.data[field.name]}
                            onBlur={() => endInputGroup(`cell-${entry.originalIndex}-${field.name}`)}
                            onChange={(value) =>
                              updateCell(document.relativePath, entry.originalIndex, field.name, value, {
                                historyGroup: inputGroup(`cell-${entry.originalIndex}-${field.name}`)
                              })
                            }
                            onFocus={() => {
                              beginInputGroup(`cell-${entry.originalIndex}-${field.name}`);
                              setActiveGridCell(virtualRow.index, fieldIndex, "edit");
                            }}
                            onKeyDown={(event) => handleEditingInputKeyDown(event, virtualRow.index, fieldIndex)}
                            onPaste={(event) => handlePaste(event, entry.originalIndex, fieldIndex)}
                          />
                        ) : field.type === "bool" ? (
                          <BoolToggleInput
                            className="grid-bool-display"
                            value={row.data[field.name]}
                            onChange={(value) => updateCell(document.relativePath, entry.originalIndex, field.name, value)}
                            onFocus={() => setActiveGridCell(virtualRow.index, fieldIndex, "select")}
                            onKeyDown={(event) => handleSelectedCellKeyDown(event, virtualRow.index, fieldIndex)}
                          />
                        ) : (
                          <button
                            className={clsx("grid-cell-display", isListField && "list-cell-display")}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              if (usesPopoverEditor) focusGridCell(virtualRow.index, fieldIndex);
                              else beginEditingCell(virtualRow.index, fieldIndex);
                            }}
                          >
                            <span className={clsx(isEmptyCellValue(row.data[field.name]) && "cell-placeholder")}>
                              {isEmptyCellValue(row.data[field.name])
                                ? placeholder
                                : usesPopoverEditor
                                  ? displayValue
                                  : formatValue(row.data[field.name])}
                            </span>
                            {isListField && (
                              <span className="list-cell-count">
                                ({listItemCount(row.data[field.name])})
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="grid-add-field-cell" />
                </div>
              );
            })}
          </div>
          <div className="grid-add-row-footer" style={{ gridTemplateColumns }}>
            <div className="row-head add-row-head" />
            <div className="grid-add-row-fill">
              <button className="secondary-button compact list-add-button" title="Add record" onClick={addRecord}>
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
          {structCell && popoverPosition && (
            <StructCellPopover
              document={document}
              field={table.fields[structCell.fieldIndex]}
              position={popoverPosition}
              row={table.rows[structCell.originalIndex]}
              rowIndex={structCell.originalIndex}
              structDefinition={structDefinitions[structCell.typeName]}
              structDefinitions={structDefinitions}
            />
          )}
          {listCell && listField && popoverPosition && (
            <ListCellPopover
              documents={documents}
              elementType={listCell.elementType}
              field={listField}
              onChange={(value) => updateCell(document.relativePath, listCell.originalIndex, listField.name, value)}
              position={popoverPosition}
              structDefinitions={structDefinitions}
              value={listValue}
            />
          )}
          {flagsCell && popoverPosition && (
            <FlagsEnumCellPopover
              enumInfo={enumInfoForType(documents, flagsCell.typeName)}
              field={flagsField}
              onChange={(value) => {
                if (!flagsField) return;
                updateCell(document.relativePath, flagsCell.originalIndex, flagsField.name, value);
              }}
              position={popoverPosition}
              value={flagsValue}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ColumnContextMenu({
  canMoveLeft,
  canMoveRight,
  onDelete,
  onDuplicate,
  onEditKey,
  onInsertLeft,
  onInsertRight,
  onMoveFirst,
  onMoveLast,
  onMoveLeft,
  onMoveRight,
  x,
  y
}: {
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onEditKey: () => void;
  onInsertLeft: () => void;
  onInsertRight: () => void;
  onMoveFirst: () => void;
  onMoveLast: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  x: number;
  y: number;
}) {
  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      <button disabled={!canMoveLeft} onClick={onMoveLeft}>Move Left</button>
      <button disabled={!canMoveRight} onClick={onMoveRight}>Move Right</button>
      <button disabled={!canMoveLeft} onClick={onMoveFirst}>Move to First</button>
      <button disabled={!canMoveRight} onClick={onMoveLast}>Move to Last</button>
      <hr />
      <button onClick={onInsertLeft}>Insert Field Left</button>
      <button onClick={onInsertRight}>Insert Field Right</button>
      <button onClick={onDuplicate}>Duplicate Field</button>
      <button className="danger-menu-item" onClick={onDelete}>Delete Field</button>
      <hr />
      <button onClick={onEditKey}>Advanced: Edit MessagePack Key</button>
    </div>
  );
}

function RecordsCreateMenu({
  onCreateField,
  onCreateRecord,
  x,
  y
}: {
  onCreateField: () => void;
  onCreateRecord: () => void;
  x: number;
  y: number;
}) {
  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      <button onClick={onCreateField}>Field</button>
      <button onClick={onCreateRecord}>Record</button>
    </div>
  );
}

function RowContextMenu({
  canPaste,
  onCopy,
  onPaste,
  x,
  y
}: {
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
  x: number;
  y: number;
}) {
  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      <button onClick={onCopy}>Copy Record</button>
      <button disabled={!canPaste} onClick={onPaste}>Paste Record</button>
    </div>
  );
}

function enumValueParts(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function ListCellPopover({
  documents,
  elementType,
  field,
  onChange,
  position,
  structDefinitions,
  value
}: {
  documents: Record<string, DefinitionDocument>;
  elementType: string;
  field: FieldDefinition;
  onChange: (value: MasterValue[]) => void;
  position: PopoverPosition;
  structDefinitions: Record<string, StructDefinition>;
  value: MasterValue | undefined;
}) {
  return (
    <div
      className="list-value-popover list-cell-popover"
      data-cell-popover="true"
      style={{ left: position.left, top: position.top }}
      title={field.name}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ValuePopoverScope>
        <ListValueEditorPanel
          documents={documents}
          elementType={elementType}
          onChange={onChange}
          showToolbar={false}
          structDefinitions={structDefinitions}
          value={value}
        />
      </ValuePopoverScope>
    </div>
  );
}

function FlagsEnumCellPopover({
  enumInfo,
  field,
  onChange,
  position,
  value
}: {
  enumInfo?: EnumInfo;
  field?: FieldDefinition;
  onChange: (value: string) => void;
  position: PopoverPosition;
  value: string;
}) {
  if (!field || !enumInfo?.flags) return null;
  const zero = enumInfo.defaultMemberName ?? "None";
  const parts = enumValueParts(value);
  const selected = new Set(parts);
  const flagOptions = enumInfo.members.filter((option) => option !== zero);
  const zeroSelected = parts.length === 0 || selected.has(zero);

  const chooseZero = () => {
    onChange(zero);
  };

  const toggleFlag = (option: string) => {
    const next = new Set(parts.filter((part) => part !== zero));
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(next.size === 0 ? zero : [...next].join(", "));
  };

  return (
    <div
      className="struct-cell-popover flags-cell-popover"
      data-cell-popover="true"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flags-cell-options">
        <button type="button" onClick={chooseZero}>
          <input readOnly checked={zeroSelected} type="checkbox" />
          <span>{zero}</span>
        </button>
        {flagOptions.map((option) => (
          <button key={option} type="button" onClick={() => toggleFlag(option)}>
            <input readOnly checked={!zeroSelected && selected.has(option)} type="checkbox" />
            <span>{option}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StructCellPopover({
  document,
  field,
  position,
  row,
  rowIndex,
  structDefinition,
  structDefinitions
}: {
  document: DefinitionDocument;
  field?: FieldDefinition;
  position: PopoverPosition;
  row?: RowDefinition;
  rowIndex: number;
  structDefinition?: StructDefinition;
  structDefinitions: Record<string, StructDefinition>;
}) {
  const { documents, updateDocument } = useEditorStore();
  const inputGroups = useRef<Record<string, string | undefined>>({});
  const inputGroupSeq = useRef(0);
  if (!field || !row || !structDefinition) return null;
  const currentValue = objectValue(row.data[field.name]);

  const beginInputGroup = (key: string) => {
    inputGroups.current[key] = `${document.relativePath}:struct-cell:${rowIndex}:${field.name}:${key}:${inputGroupSeq.current++}`;
  };

  const endInputGroup = (key: string) => {
    inputGroups.current[key] = undefined;
  };

  const inputGroup = (key: string) => inputGroups.current[key];

  const updateStructField = (structField: FieldDefinition, value: MasterValue, historyGroup?: string) => {
    updateDocument(document.relativePath, `Edit ${field.name}.${structField.name}`, (draft) => {
      if (draft.definition.kind !== "table") return;
      const targetRow = draft.definition.rows[rowIndex];
      if (!targetRow) return;
      const current = objectValue(targetRow.data[field.name]);
      targetRow.data[field.name] = { ...current, [structField.name]: value };
    }, { historyGroup });
  };

  return (
    <div
      className="struct-cell-popover"
      data-cell-popover="true"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ValuePopoverScope>
        <div className="struct-cell-fields">
          {structDefinition.fields.map((structField) => {
            const hasValue = Object.prototype.hasOwnProperty.call(currentValue, structField.name);
            const value = hasValue ? currentValue[structField.name] : "";
            const placeholder = defaultPlaceholderForType(structField.type, documents, structDefinitions);
            return (
              <label className="struct-cell-field" key={structField.name}>
                <span>{structField.name}</span>
                <StructFieldInput
                  field={structField}
                  onBlur={() => endInputGroup(structField.name)}
                  onChange={(nextValue) => updateStructField(structField, nextValue, inputGroup(structField.name))}
                  onFocus={() => beginInputGroup(structField.name)}
                  placeholder={placeholder}
                  structDefinitions={structDefinitions}
                  value={value}
                />
              </label>
            );
          })}
        </div>
      </ValuePopoverScope>
    </div>
  );
}

function StructFieldInput({
  field,
  onBlur,
  onChange,
  onFocus,
  placeholder,
  structDefinitions,
  value
}: {
  field: FieldDefinition;
  onBlur: () => void;
  onChange: (value: MasterValue) => void;
  onFocus: () => void;
  placeholder: string;
  structDefinitions: Record<string, StructDefinition>;
  value: MasterValue;
}) {
  const { documents } = useEditorStore();
  return (
    <MasterValueInput
      documents={documents}
      placeholder={placeholder}
      onBlur={onBlur}
      onChange={onChange}
      onFocus={onFocus}
      structDefinitions={structDefinitions}
      type={field.type}
      value={value}
    />
  );
}

function structDefinitionMap(documents: Record<string, DefinitionDocument>) {
  return Object.fromEntries(
    Object.values(documents)
      .filter((document) => document.definition.kind === "struct")
      .map((document) => [document.typeName, document.definition as StructDefinition])
  );
}

function objectValue(value: MasterValue | undefined): Record<string, MasterValue> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function defaultEditorValue(
  type: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): MasterValue {
  if (type === "bool") return false;
  if (type === "int" || type === "long" || type === "float" || type === "double") return 0;
  if (isListType(type)) return [];
  if (structDefinitions[type]) return {};
  if (enumInfoForType(documents, type)) return "";
  return "";
}

function cloneRowForFields(
  row: RowDefinition,
  fields: FieldDefinition[],
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): RowDefinition {
  const data: Record<string, MasterValue> = {};
  for (const field of fields) {
    const sourceValue = row.data[field.name];
    data[field.name] = cloneMasterValue(sourceValue === undefined ? defaultEditorValue(field.type, documents, structDefinitions) : sourceValue);
  }
  const tags = row.meta?.tags ?? [];
  return tags.length > 0 ? { data, meta: { tags: [...tags] } } : { data };
}

function defaultPlaceholderForType(
  type: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  if (type === "string") return "\"\"";
  const enumInfo = enumInfoForType(documents, type);
  if (enumInfo) return enumInfo.defaultMemberName ?? "0 (undefined)";
  const structDefinition = structDefinitions[type];
  if (structDefinition) return structDisplayPlaceholder(structDefinition, documents, structDefinitions);
  const value = defaultEditorValue(type, documents, structDefinitions);
  if (Array.isArray(value)) return "[]";
  if (value && typeof value === "object") return "{}";
  return formatValue(value);
}

function isEmptyCellValue(value: MasterValue | undefined) {
  return value == null || value === "";
}

function listItemCount(value: MasterValue | undefined) {
  return Array.isArray(value) ? value.length : 0;
}

function isEditableElement(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function formatCellDisplayValue(
  field: FieldDefinition,
  value: MasterValue | undefined,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  return formatCellDisplayValueByType(field.type, value, documents, structDefinitions);
}

function formatCellDisplayValueByType(
  type: string,
  value: MasterValue | undefined,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  if (isEmptyCellValue(value)) return defaultPlaceholderForType(type, documents, structDefinitions);
  if (isListType(type)) return formatListCellValue(value, unwrapListType(type), documents, structDefinitions);
  const structDefinition = structDefinitions[type];
  if (structDefinition) return formatStructCellValue(value, structDefinition, documents, structDefinitions);
  return formatValue(value);
}

function formatListCellValue(
  value: MasterValue | undefined,
  elementType: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  const items = Array.isArray(value) ? value : [];
  if (items.length === 0) return "[]";
  return items
    .map((item) => formatCellDisplayValueByType(elementType, item, documents, structDefinitions))
    .join("; ");
}

function formatStructCellValue(
  value: MasterValue | undefined,
  structDefinition: StructDefinition,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  const map = objectValue(value);
  return structDefinition.fields
    .map((field) => {
      const fieldValue = map[field.name];
      if (isEmptyCellValue(fieldValue)) return defaultPlaceholderForType(field.type, documents, structDefinitions);
      return formatCellDisplayValueByType(field.type, fieldValue, documents, structDefinitions);
    })
    .join(", ");
}

function structDisplayPlaceholder(
  structDefinition: StructDefinition,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  return structDefinition.fields
    .map((field) => defaultPlaceholderForType(field.type, documents, structDefinitions))
    .join(", ");
}

function rowTagIssues(tags: string[], allowedTags: string[]) {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag) {
      issues.push("Row tag is empty.");
      continue;
    }
    if (!isValidTagName(tag)) {
      issues.push(`Invalid or reserved row tag: ${rawTag}`);
    }
    if (seen.has(tag)) {
      issues.push(`Duplicate row tag: ${tag}`);
    }
    seen.add(tag);
    if (allowedTags.length > 0 && isValidTagName(tag) && !allowedTags.includes(tag)) {
      issues.push(`Undeclared row tag: ${tag}`);
    }
  }
  return issues;
}

function cellIssuesForField(
  field: FieldDefinition,
  value: MasterValue | undefined,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>,
  label = field.name
): string[] {
  return cellIssuesForType(label, field.type, value, documents, structDefinitions);
}

function cellIssuesForType(
  label: string,
  type: string,
  value: MasterValue | undefined,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string[] {
  if (isListType(type)) return listCellIssues(label, value, unwrapListType(type), documents, structDefinitions);
  const enumInfo = enumInfoForType(documents, type);
  if (enumInfo) return enumCellIssues(label, value, enumInfo);
  const structDefinition = structDefinitions[type];
  if (!structDefinition) return [];
  if (!isEmptyCellValue(value) && (typeof value !== "object" || Array.isArray(value))) {
    return [`${label}: struct value must be an object.`];
  }
  const map = objectValue(value);
  return structDefinition.fields.flatMap((structField) =>
    cellIssuesForType(`${label}.${structField.name}`, structField.type, map[structField.name], documents, structDefinitions)
  );
}

function listCellIssues(
  label: string,
  value: MasterValue | undefined,
  elementType: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string[] {
  if (isEmptyCellValue(value)) return [];
  if (!Array.isArray(value)) return [`${label}: list value must be an array.`];
  return value.flatMap((item, index) =>
    cellIssuesForType(`${label}[${index}]`, elementType, item, documents, structDefinitions)
  );
}

function enumCellIssues(fieldName: string, value: MasterValue | undefined, enumInfo: EnumInfo): string[] {
  if (value == null || value === "") {
    return enumInfo.hasZeroDefault ? [] : [`${fieldName}: enum default value 0 is not explicitly defined.`];
  }
  if (typeof value !== "string") return [`${fieldName}: enum value must be a string.`];
  const raw = value.trim();
  if (!raw) return enumInfo.hasZeroDefault ? [] : [`${fieldName}: enum default value 0 is not explicitly defined.`];
  const parts = raw.split(",").map((part) => part.trim());
  if (!enumInfo.flags && parts.length > 1) {
    return [`${fieldName}: composite enum value requires a Flags enum.`];
  }
  const unknown = parts.filter((part) => !part || !enumInfo.members.includes(part));
  if (unknown.length > 0) {
    return [`${fieldName}: unknown enum member ${unknown.map((part) => `\`${part || "(empty)"}\``).join(", ")}.`];
  }
  return [];
}

function useFilteredRows(table: TableDefinition) {
  const { profilePreview, project, tagFilter } = useEditorStore();
  return useMemo(() => {
    const profile = profilePreview ? project?.config.buildProfiles?.[profilePreview] : undefined;
    return table.rows
      .map((row, originalIndex) => {
        const tags = row.meta?.tags ?? [];
        const tagHidden = !matchesTagRule(tags, tagFilter.include, tagFilter.exclude);
        const profileExcluded = profile ? !matchesTagRule(tags, profile.includeTags ?? [], profile.excludeTags ?? []) : false;
        return { row, originalIndex, filteredOut: profileExcluded, hidden: tagHidden };
      })
      .filter((entry) => !entry.hidden);
  }, [profilePreview, project?.config.buildProfiles, table.rows, tagFilter]);
}

function useGapDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  onDrop: (from: number, gap: number) => void
) {
  const [state, setState] = useState<{ from: number; gap: number; left: number }>();
  const stateRef = useRef<typeof state>(undefined);

  const start = (from: number, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const update = (clientX: number) => {
      const next = calculateGap(container, clientX);
      const dragState = { from, gap: next.gap, left: next.left };
      stateRef.current = dragState;
      setState(dragState);
    };
    update(event.clientX);

    const onPointerMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const onPointerUp = () => {
      const latest = stateRef.current;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setState(undefined);
      stateRef.current = undefined;
      if (latest) onDrop(latest.from, latest.gap);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  return { state, start };
}

function calculateGap(container: HTMLElement, clientX: number) {
  const containerRect = container.getBoundingClientRect();
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-field-index]"));
  if (items.length === 0) return { gap: 0, left: 0 };

  for (let index = 0; index < items.length; index += 1) {
    const rect = items[index].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { gap: index, left: rect.left - containerRect.left + container.scrollLeft };
    }
  }

  const lastRect = items[items.length - 1].getBoundingClientRect();
  return {
    gap: items.length,
    left: lastRect.right - containerRect.left + container.scrollLeft
  };
}

function gridFieldToColumn(field: GridField) {
  return field === "tags" ? 0 : field + 1;
}

function columnToGridField(column: number): GridField {
  return column === 0 ? "tags" : column - 1;
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function sameCell(left: ActiveCell | undefined, right: ActiveCell) {
  return left?.visibleRowIndex === right.visibleRowIndex && left.field === right.field;
}

function gridColumns(fieldCount: number, zoom: number) {
  return `${scaledSize(ROW_NUMBER_WIDTH, zoom)}px ${scaledSize(META_TAGS_WIDTH, zoom)}px repeat(${fieldCount}, ${scaledSize(FIELD_WIDTH, zoom)}px) ${scaledSize(ADD_FIELD_WIDTH, zoom)}px`;
}

function totalGridWidth(fieldCount: number, zoom: number) {
  return scaledSize(ROW_NUMBER_WIDTH, zoom) + scaledSize(META_TAGS_WIDTH, zoom) + fieldCount * scaledSize(FIELD_WIDTH, zoom) + scaledSize(ADD_FIELD_WIDTH, zoom);
}

function scaledSize(value: number, zoom: number) {
  return Math.max(24, Math.round(value * zoom));
}
