import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import type { DefinitionDocument, EnumDefinition } from "../types";
import { EditorHeader } from "./EditorHost";

type EnumMember = EnumDefinition["members"][number];

export function EnumEditor({ document }: { document: DefinitionDocument }) {
  const { updateDocument } = useEditorStore();
  const [focusMemberIndex, setFocusMemberIndex] = useState<number>();
  const memberInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const inputGroups = useRef<Record<string, string | undefined>>({});
  const inputGroupSeq = useRef(0);
  const memberCount = document.definition.kind === "enum" ? document.definition.members.length : 0;

  useEffect(() => {
    if (focusMemberIndex == null) return;
    const input = memberInputRefs.current[focusMemberIndex];
    input?.focus();
    input?.select();
    setFocusMemberIndex(undefined);
  }, [memberCount, focusMemberIndex]);

  if (document.definition.kind !== "enum") return null;
  const definition = document.definition;
  const enumValues = csharpEnumValues(definition.members);
  const explicitZeroIndex = definition.members.findIndex((member) => explicitEnumValue(member) === 0);
  const showVirtualFlagsZero = Boolean(definition.flags) && explicitZeroIndex < 0;

  const addMember = () => {
    const nextIndex = memberCount;
    updateDocument(document.relativePath, "Add enum member", (draft) => {
      if (draft.definition.kind !== "enum") return;
      draft.definition.members.push(`Member${draft.definition.members.length + 1}`);
    });
    setFocusMemberIndex(nextIndex);
  };

  const deleteMember = (index: number) => {
    updateDocument(document.relativePath, "Delete enum member", (draft) => {
      if (draft.definition.kind !== "enum") return;
      draft.definition.members.splice(index, 1);
    });
  };

  const addVirtualZeroMember = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateDocument(document.relativePath, "Add flags zero member", (draft) => {
      if (draft.definition.kind !== "enum") return;
      draft.definition.members.unshift({ name: trimmed, value: 0 });
    });
    setFocusMemberIndex(0);
  };

  const beginInputGroup = (key: string) => {
    inputGroups.current[key] = `${document.relativePath}:enum:${key}:${inputGroupSeq.current++}`;
  };

  const endInputGroup = (key: string) => {
    inputGroups.current[key] = undefined;
  };

  const inputGroup = (key: string) => inputGroups.current[key];

  return (
    <div className="simple-editor enum-editor">
      <EditorHeader document={document} />
      <div className="enum-options">
        <label className="check-row">
          <input
            checked={Boolean(document.definition.flags)}
            type="checkbox"
            onChange={(event) =>
              updateDocument(document.relativePath, "Toggle enum flags", (draft) => {
                if (draft.definition.kind !== "enum") return;
                draft.definition.flags = event.target.checked || undefined;
              })
            }
          />
          Flags
        </label>
      </div>
      <div className="simple-list">
        {showVirtualFlagsZero && (
          <div className="simple-row enum-row fixed-enum-zero-row" key="virtual-flags-zero">
            <input
              placeholder="None"
              value=""
              onChange={(event) => addVirtualZeroMember(event.target.value)}
            />
            <input placeholder="0" value="" readOnly />
            <button className="icon-button danger-icon" disabled title="Flags zero member is required">
              <Trash2 size={14} />
            </button>
          </div>
        )}
        {definition.members.map((member, index) => {
          const name = typeof member === "string" ? member : member.name;
          const value = typeof member === "string" ? "" : String(member.value);
          const isFixedFlagsZero = Boolean(definition.flags) && explicitEnumValue(member) === 0;
          return (
            <div className="simple-row enum-row" key={`enum-member-${index}`}>
              <input
                ref={(element) => {
                  memberInputRefs.current[index] = element;
                }}
                value={name}
                onBlur={() => endInputGroup(`member-name-${index}`)}
                onChange={(event) =>
                  updateDocument(document.relativePath, "Edit enum member", (draft) => {
                    if (draft.definition.kind !== "enum") return;
                    const current = draft.definition.members[index];
                    draft.definition.members[index] =
                      typeof current === "string" ? event.target.value : { ...current, name: event.target.value };
                  }, { historyGroup: inputGroup(`member-name-${index}`) })
                }
                onFocus={() => beginInputGroup(`member-name-${index}`)}
              />
              <input
                readOnly={isFixedFlagsZero}
                value={value}
                placeholder={String(enumValues[index] ?? 0)}
                onBlur={() => endInputGroup(`member-value-${index}`)}
                onChange={(event) =>
                  updateDocument(document.relativePath, "Edit enum value", (draft) => {
                    if (draft.definition.kind !== "enum") return;
                    const nextName = typeof draft.definition.members[index] === "string"
                      ? String(draft.definition.members[index])
                      : (draft.definition.members[index] as { name: string; value: number }).name;
                    const raw = event.target.value.trim();
                    if (!raw) {
                      draft.definition.members[index] = nextName;
                      return;
                    }
                    const parsed = Number.parseInt(raw, 10);
                    draft.definition.members[index] = { name: nextName, value: Number.isFinite(parsed) ? parsed : 0 };
                  }, { historyGroup: inputGroup(`member-value-${index}`) })
                }
                onFocus={() => beginInputGroup(`member-value-${index}`)}
              />
              <button
                className="icon-button danger-icon"
                disabled={isFixedFlagsZero}
                title={isFixedFlagsZero ? "Flags zero member is required" : "Delete member"}
                onClick={() => deleteMember(index)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        <div className="simple-add-row">
          <button className="secondary-button compact list-add-button" title="Add member" onClick={addMember}>
            <Plus size={15} />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function explicitEnumValue(member: EnumMember) {
  return typeof member === "string" ? undefined : member.value;
}

function csharpEnumValues(members: EnumMember[]) {
  let nextValue = 0;
  return members.map((member) => {
    if (typeof member === "string") {
      const value = nextValue;
      nextValue = value + 1;
      return value;
    }
    nextValue = member.value + 1;
    return member.value;
  });
}
