import clsx from "clsx";
import { useState } from "react";
import { coerceValue } from "../store";
import { availableTypeOptionGroups, isListType, setListType, unwrapListType } from "../editorUtils";
import type { DefinitionDocument, FieldDefinition, MasterValue, StructDefinition } from "../types";

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
      <button
        aria-pressed={list}
        className={clsx("field-list-toggle", list && "checked")}
        title="Toggle list type"
        type="button"
        onClick={() => onChange(setListType(type, !list))}
      >
        List
      </button>
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
  if (isListType(type) || structDefinitions[type]) {
    return (
      <textarea
        className={clsx("master-value-textarea", className)}
        defaultValue={formatJsonValue(value)}
        placeholder={placeholder}
        onBlur={(event) => {
          onBlur?.();
          const raw = event.target.value.trim();
          if (!raw) {
            onChange(isListType(type) ? [] : {});
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

function formatValue(value: MasterValue | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null ? "" : String(value);
}
