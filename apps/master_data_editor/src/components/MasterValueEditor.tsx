import clsx from "clsx";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { coerceValue } from "../store";
import { availableTypeOptionGroups, isListType, setListType, unwrapListType } from "../editorUtils";
import type { DefinitionDocument, MasterValue, StructDefinition } from "../types";

export type EnumInfo = {
  flags: boolean;
  members: string[];
  hasZeroDefault: boolean;
  defaultMemberName?: string;
};

export function FieldTypeControl({
  className,
  documents,
  onChange,
  onPointerDown,
  type
}: {
  className?: string;
  documents: Record<string, DefinitionDocument>;
  onChange: (type: string) => void;
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  type: string;
}) {
  const list = isListType(type);
  const baseType = unwrapListType(type);

  return (
    <div className={clsx("field-type-control", className)} onPointerDown={onPointerDown}>
      <select
        className="field-type-select"
        value={baseType}
        onChange={(event) => onChange(setListType(event.target.value, list))}
      >
        {availableTypeOptionGroups(documents, baseType).map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="field-cardinality-control" role="group" aria-label="Value cardinality">
        <button
          aria-pressed={!list}
          aria-label="Use a single value"
          className={clsx("field-cardinality-option", !list && "checked")}
          title="Use a single value"
          type="button"
          onClick={() => onChange(setListType(type, false))}
        >
          1
        </button>
        <button
          aria-pressed={list}
          aria-label="Use a list of values"
          className={clsx("field-cardinality-option", list && "checked")}
          title="Use a list of values"
          type="button"
          onClick={() => onChange(setListType(type, true))}
        >
          []
        </button>
      </div>
    </div>
  );
}

export function MasterValueInput({
  className,
  dataGridField,
  dataGridRow,
  documents,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  onPaste,
  placeholder,
  structDefinitions,
  type,
  value
}: {
  className?: string;
  dataGridField?: number;
  dataGridRow?: number;
  documents: Record<string, DefinitionDocument>;
  onBlur?: () => void;
  onChange: (value: MasterValue) => void;
  onFocus?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  structDefinitions: Record<string, StructDefinition>;
  type: string;
  value: MasterValue | undefined;
}) {
  if (isListType(type)) {
    return (
      <ListValueInput
        className={className}
        documents={documents}
        elementType={unwrapListType(type)}
        onBlur={onBlur}
        onChange={onChange}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        structDefinitions={structDefinitions}
        value={value}
      />
    );
  }

  const enumInfo = enumInfoForType(documents, type);
  if (type === "bool") {
    return (
      <BoolToggleInput
        className={className}
        value={value}
        onBlur={onBlur}
        onChange={onChange}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
    );
  }
  if (enumInfo) {
    return (
      <EnumValueInput
        className={className}
        dataGridField={dataGridField}
        dataGridRow={dataGridRow}
        enumInfo={enumInfo}
        placeholder={placeholder}
        value={formatValue(value)}
        onBlur={onBlur}
        onChange={onChange}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
    );
  }
  if (structDefinitions[type]) {
    return (
      <textarea
        className={clsx("master-value-textarea", className)}
        defaultValue={formatJsonValue(value)}
        placeholder={placeholder}
        onBlur={(event) => {
          onBlur?.();
          const raw = event.target.value.trim();
          if (!raw) {
            onChange({});
            return;
          }
          try {
            onChange(JSON.parse(raw) as MasterValue);
          } catch {
            onChange(raw);
          }
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <input
      className={clsx("grid-cell-input", className)}
      data-grid-field={dataGridField}
      data-grid-row={dataGridRow}
      placeholder={placeholder}
      value={formatValue(value)}
      onBlur={onBlur}
      onChange={(event) => onChange(coerceValue(type, event.target.value))}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}

function ListValueInput({
  className,
  documents,
  elementType,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  placeholder,
  structDefinitions,
  value
}: {
  className?: string;
  documents: Record<string, DefinitionDocument>;
  elementType: string;
  onBlur?: () => void;
  onChange: (value: MasterValue[]) => void;
  onFocus?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  placeholder: string;
  structDefinitions: Record<string, StructDefinition>;
  value: MasterValue | undefined;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = Array.isArray(value) ? value : [];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
      onBlur?.();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [onBlur, open]);

  return (
    <div className={clsx("list-value-input", className)} ref={rootRef}>
      <button
        className={clsx("list-value-button", open && "open")}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          onFocus?.();
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <span>{listSummary(items, elementType, placeholder, documents, structDefinitions)}</span>
        <strong>({items.length})</strong>
      </button>
      {open && (
        <div
          className="list-value-popover"
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ListValueEditorPanel
            documents={documents}
            elementType={elementType}
            onChange={onChange}
            showToolbar={false}
            structDefinitions={structDefinitions}
            value={value}
          />
        </div>
      )}
    </div>
  );
}

export function ListValueEditorPanel({
  className,
  documents,
  elementType,
  onChange,
  showToolbar = true,
  structDefinitions,
  value
}: {
  className?: string;
  documents: Record<string, DefinitionDocument>;
  elementType: string;
  onChange: (value: MasterValue[]) => void;
  showToolbar?: boolean;
  structDefinitions: Record<string, StructDefinition>;
  value: MasterValue | undefined;
}) {
  const [dragIndex, setDragIndex] = useState<number>();
  const [dropGap, setDropGap] = useState<number>();
  const dragIndexRef = useRef<number | undefined>(undefined);
  const dropGapRef = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const items = Array.isArray(value) ? value : [];

  const updateItem = (index: number, nextValue: MasterValue) => {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
  };

  const addItem = () => {
    onChange([...items, defaultValueForType(elementType, documents, structDefinitions)]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const moveItemToGap = (index: number, gap: number) => {
    let nextIndex = Math.max(0, Math.min(gap, items.length));
    if (index < nextIndex) nextIndex -= 1;
    if (nextIndex === index) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    onChange(next);
  };

  const startDrag = (event: React.PointerEvent<HTMLElement>, index: number) => {
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
      const rows = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-list-item-index]") ?? []);
      let nextGap = items.length;
      for (const row of rows) {
        const index = Number(row.dataset.listItemIndex);
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
      if (sourceIndex != null && targetGap != null) moveItemToGap(sourceIndex, targetGap);
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
  }, [dragIndex, items.length, moveItemToGap]);

  return (
    <div className={clsx("list-value-panel", !showToolbar && "without-toolbar", className)} ref={panelRef}>
      {showToolbar && (
        <div className="list-value-toolbar">
          <span>{elementType}</span>
          <strong>{items.length} items</strong>
        </div>
      )}
      <div className="list-value-items">
        {items.length === 0 && (
          <div className="list-value-empty">Empty list</div>
        )}
        {items.map((item, index) => (
          <div className="list-value-row-wrap" key={index}>
            {dropGap === index && <div className="list-drop-marker" />}
            <div
              className={clsx("list-value-row", dragIndex === index && "dragging")}
              data-list-item-index={index}
            >
              <span
                className="list-drag-handle"
                title="Drag to reorder"
                onPointerDown={(event) => startDrag(event, index)}
              >
                <GripVertical size={15} />
                <span>{index + 1}</span>
              </span>
              <ListItemValueEditor
                documents={documents}
                elementType={elementType}
                onChange={(nextValue) => updateItem(index, nextValue)}
                structDefinitions={structDefinitions}
                value={item}
              />
              <button className="list-row-delete" title="Remove item" type="button" onClick={() => removeItem(index)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {dropGap === items.length && <div className="list-drop-marker" />}
        <button className="list-add-row-button" type="button" onClick={addItem}>
          <Plus size={14} />
          Add
        </button>
      </div>
    </div>
  );
}

function ListItemValueEditor({
  documents,
  elementType,
  onChange,
  structDefinitions,
  value
}: {
  documents: Record<string, DefinitionDocument>;
  elementType: string;
  onChange: (value: MasterValue) => void;
  structDefinitions: Record<string, StructDefinition>;
  value: MasterValue | undefined;
}) {
  const structDefinition = structDefinitions[elementType];
  if (!structDefinition) {
    return (
      <MasterValueInput
        documents={documents}
        placeholder={defaultPlaceholderForType(elementType, documents, structDefinitions)}
        onChange={onChange}
        structDefinitions={structDefinitions}
        type={elementType}
        value={value}
      />
    );
  }

  const map = objectValue(value);
  const updateStructField = (fieldName: string, nextValue: MasterValue) => {
    onChange({ ...map, [fieldName]: nextValue });
  };

  return (
    <div className="list-struct-editor">
      {structDefinition.fields.map((field) => (
        <label className="list-struct-field" key={field.name}>
          <span>{field.name}</span>
          <MasterValueInput
            documents={documents}
            placeholder={defaultPlaceholderForType(field.type, documents, structDefinitions)}
            onChange={(nextValue) => updateStructField(field.name, nextValue)}
            structDefinitions={structDefinitions}
            type={field.type}
            value={map[field.name]}
          />
        </label>
      ))}
    </div>
  );
}

export function BoolToggleInput({
  className,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  value
}: {
  className?: string;
  onBlur?: () => void;
  onChange: (value: boolean) => void;
  onFocus?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  value: MasterValue | undefined;
}) {
  const checked = booleanValue(value);
  return (
    <button
      aria-pressed={checked}
      className={clsx("bool-toggle-input", checked && "checked", className)}
      type="button"
      onBlur={onBlur}
      onClick={() => onChange(!checked)}
      onFocus={onFocus}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key !== " ") return;
        event.preventDefault();
        onChange(!checked);
      }}
    >
      <span className="bool-toggle-track">
        <span className="bool-toggle-thumb" />
      </span>
      <span className="bool-toggle-label">{checked ? "true" : "false"}</span>
    </button>
  );
}

function EnumValueInput({
  className,
  dataGridField,
  dataGridRow,
  enumInfo,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  placeholder,
  value
}: {
  className?: string;
  dataGridField?: number;
  dataGridRow?: number;
  enumInfo: EnumInfo;
  onBlur?: () => void;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  placeholder: string;
  value: string;
}) {
  const [focused, setFocused] = useState(false);
  if (enumInfo.flags) {
    const zero = enumInfo.defaultMemberName ?? placeholder;
    const parts = enumValueParts(value);
    const selected = new Set(parts);
    const flagOptions = enumInfo.members.filter((option) => option !== zero);
    const zeroSelected = parts.length === 0 || selected.has(zero);
    const displayValue = parts.length === 0 ? "" : parts.join(", ");

    const chooseZero = () => {
      onChange(zero);
      setFocused(false);
    };

    const toggleFlag = (option: string) => {
      const next = new Set(parts.filter((part) => part !== zero));
      if (next.has(option)) next.delete(option);
      else next.add(option);
      onChange(next.size === 0 ? zero : [...next].join(", "));
    };

    return (
      <div className={clsx("enum-cell-input", "flags-cell-input", className)}>
        <input
          readOnly
          className="grid-cell-input"
          data-grid-field={dataGridField}
          data-grid-row={dataGridRow}
          placeholder={placeholder}
          value={displayValue}
          onBlur={() => {
            onBlur?.();
            window.setTimeout(() => setFocused(false), 120);
          }}
          onClick={() => setFocused(true)}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === " ") {
              event.preventDefault();
              setFocused(true);
            }
          }}
        />
        {focused && (
          <div className="enum-cell-menu flags-cell-menu">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={chooseZero}>
              <input readOnly checked={zeroSelected} type="checkbox" />
              <span>{zero}</span>
            </button>
            {flagOptions.map((option) => (
              <button key={option} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFlag(option)}>
                <input readOnly checked={!zeroSelected && selected.has(option)} type="checkbox" />
                <span>{option}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const query = value.trim();
  const candidates = enumInfo.members.filter((option) => !query || option.toLowerCase().includes(query.toLowerCase()));
  const showCandidates = focused && candidates.length > 0;

  const choose = (option: string) => {
    onChange(option);
    setFocused(false);
  };

  return (
    <div className={clsx("enum-cell-input", className)}>
      <input
        className="grid-cell-input"
        data-grid-field={dataGridField}
        data-grid-row={dataGridRow}
        placeholder={placeholder}
        value={value}
        onBlur={() => {
          onBlur?.();
          window.setTimeout(() => setFocused(false), 120);
        }}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") setFocused(true);
        }}
      />
      {showCandidates && (
        <div className="enum-cell-menu">
          {candidates.map((candidate) => (
            <button key={candidate} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(candidate)}>
              {candidate}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function enumInfoForType(documents: Record<string, DefinitionDocument>, typeName: string): EnumInfo | undefined {
  const document = Object.values(documents).find(
    (item) => item.definition.kind === "enum" && item.typeName === typeName
  );
  if (!document || document.definition.kind !== "enum") return undefined;
  const explicitZeroMember = document.definition.members.find(
    (member) => typeof member !== "string" && member.value === 0
  );
  const zeroIsVirtual = Boolean(document.definition.flags) && !explicitZeroMember;
  const rawMembers = document.definition.members.map((member) => (typeof member === "string" ? member : member.name));
  const members = zeroIsVirtual && !rawMembers.includes("None") ? ["None", ...rawMembers] : rawMembers;
  const defaultMemberName = typeof explicitZeroMember === "string"
    ? undefined
    : explicitZeroMember?.name ?? (zeroIsVirtual ? "None" : undefined);
  return {
    flags: Boolean(document.definition.flags),
    members,
    hasZeroDefault: Boolean(defaultMemberName),
    defaultMemberName
  };
}

function enumValueParts(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function booleanValue(value: MasterValue | undefined) {
  return value === true || value === "true" || value === 1;
}

function formatJsonValue(value: MasterValue | undefined) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {}, null, 2);
}

function defaultValueForType(
  type: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): MasterValue {
  if (isListType(type)) return [];
  if (type === "bool") return false;
  if (type === "int" || type === "long" || type === "float" || type === "double") return 0;
  if (structDefinitions[type]) return {};
  const enumInfo = enumInfoForType(documents, type);
  if (enumInfo?.defaultMemberName) return enumInfo.defaultMemberName;
  return "";
}

function defaultPlaceholderForType(
  type: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  if (isListType(type)) return "[]";
  if (type === "string") return "\"\"";
  const enumInfo = enumInfoForType(documents, type);
  if (enumInfo) return enumInfo.defaultMemberName ?? "0 (undefined)";
  const structDefinition = structDefinitions[type];
  if (structDefinition) return structPlaceholder(structDefinition, documents, structDefinitions);
  return formatValue(defaultValueForType(type, documents, structDefinitions));
}

function objectValue(value: MasterValue | undefined): Record<string, MasterValue> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function listSummary(
  items: MasterValue[],
  elementType: string,
  placeholder: string,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
) {
  if (items.length === 0) return placeholder || "[]";
  const preview = items
    .slice(0, 3)
    .map((item) => displayValueForType(elementType, item, documents, structDefinitions))
    .join("; ");
  return items.length > 3 ? `${preview}; +${items.length - 3}` : preview;
}

function displayValueForType(
  type: string,
  value: MasterValue | undefined,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  if (value == null || value === "") return defaultPlaceholderForType(type, documents, structDefinitions);
  if (isListType(type)) {
    const items = Array.isArray(value) ? value : [];
    return listSummary(items, unwrapListType(type), "[]", documents, structDefinitions);
  }
  const structDefinition = structDefinitions[type];
  if (structDefinition) return structValueSummary(value, structDefinition, documents, structDefinitions);
  return formatValue(value);
}

function structValueSummary(
  value: MasterValue | undefined,
  structDefinition: StructDefinition,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  const map = objectValue(value);
  return structDefinition.fields
    .map((field) => displayValueForType(field.type, map[field.name], documents, structDefinitions))
    .join(", ");
}

function structPlaceholder(
  structDefinition: StructDefinition,
  documents: Record<string, DefinitionDocument>,
  structDefinitions: Record<string, StructDefinition>
): string {
  return structDefinition.fields
    .map((field) => defaultPlaceholderForType(field.type, documents, structDefinitions))
    .join(", ");
}

function formatValue(value: MasterValue | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null ? "" : String(value);
}
