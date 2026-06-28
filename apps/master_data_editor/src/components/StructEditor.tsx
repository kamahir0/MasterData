import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useEditorStore } from "../store";
import {
  availableTypeOptionGroups,
  createField,
  duplicateMessagePackKeys,
  messagePackKey
} from "../editorUtils";
import type { DefinitionDocument } from "../types";
import { EditorHeader } from "./EditorHost";

export function StructEditor({ document }: { document: DefinitionDocument }) {
  const { documents, updateDocument } = useEditorStore();
  const [focusFieldIndex, setFocusFieldIndex] = useState<number>();
  const fieldInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const inputGroups = useRef<Record<string, string | undefined>>({});
  const inputGroupSeq = useRef(0);
  const fieldCount = document.definition.kind === "struct" ? document.definition.fields.length : 0;
  const duplicateKeyIndexes = useMemo(
    () => (document.definition.kind === "struct" ? duplicateMessagePackKeys(document.definition.fields) : new Set<number>()),
    [document.definition]
  );

  useEffect(() => {
    if (focusFieldIndex == null) return;
    const input = fieldInputRefs.current[focusFieldIndex];
    input?.focus();
    input?.select();
    setFocusFieldIndex(undefined);
  }, [fieldCount, focusFieldIndex]);

  if (document.definition.kind !== "struct") return null;
  const struct = document.definition;

  const addField = () => {
    const nextIndex = struct.fields.length;
    updateDocument(document.relativePath, "Add struct field", (draft) => {
      if (draft.definition.kind !== "struct") return;
      draft.definition.fields.push(createField(draft.definition.fields, `Field${draft.definition.fields.length + 1}`, "string"));
    });
    setFocusFieldIndex(nextIndex);
  };

  const editMessagePackKey = (index: number) => {
    const field = struct.fields[index];
    if (!field) return;
    if (!window.confirm("Changing MessagePack Key can break binary compatibility. Continue?")) return;
    const raw = window.prompt("MessagePack Key", String(messagePackKey(field, index)));
    if (raw == null) return;
    const next = Number.parseInt(raw, 10);
    if (!Number.isInteger(next) || next < 0) return;
    updateDocument(document.relativePath, `Edit ${field.name} MessagePack Key`, (draft) => {
      if (draft.definition.kind !== "struct") return;
      draft.definition.fields[index].fixedIndex = next;
    });
  };

  const beginInputGroup = (key: string) => {
    inputGroups.current[key] = `${document.relativePath}:struct:${key}:${inputGroupSeq.current++}`;
  };

  const endInputGroup = (key: string) => {
    inputGroups.current[key] = undefined;
  };

  const inputGroup = (key: string) => inputGroups.current[key];

  return (
    <div className="simple-editor struct-editor">
      <EditorHeader document={document} />
      <div className="simple-list">
        {struct.fields.map((field, index) => (
          <div className="simple-row struct-row" key={`struct-field-${index}`}>
            <input
              ref={(element) => {
                fieldInputRefs.current[index] = element;
              }}
              value={field.name}
              onBlur={() => endInputGroup(`field-name-${index}`)}
              onChange={(event) =>
                updateDocument(document.relativePath, "Edit struct field", (draft) => {
                  if (draft.definition.kind !== "struct") return;
                  draft.definition.fields[index].name = event.target.value;
                }, { historyGroup: inputGroup(`field-name-${index}`) })
              }
              onFocus={() => beginInputGroup(`field-name-${index}`)}
            />
            <select
              value={field.type}
              onChange={(event) =>
                updateDocument(document.relativePath, "Edit struct field type", (draft) => {
                  if (draft.definition.kind !== "struct") return;
                  draft.definition.fields[index].type = event.target.value;
                })
              }
            >
              {availableTypeOptionGroups(documents, field.type).map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              className={clsx("key-edit-badge", "badge", "key", duplicateKeyIndexes.has(messagePackKey(field, index)) && "duplicate")}
              onClick={() => editMessagePackKey(index)}
              title="Edit MessagePack Key"
            >
              Key {messagePackKey(field, index)}
            </button>
            <button
              className="icon-button danger-icon"
              title="Delete field"
              onClick={() =>
                updateDocument(document.relativePath, "Delete struct field", (draft) => {
                  if (draft.definition.kind !== "struct") return;
                  draft.definition.fields.splice(index, 1);
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="simple-add-row">
          <button className="secondary-button compact list-add-button" title="Add field" onClick={addField}>
            <Plus size={15} />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
