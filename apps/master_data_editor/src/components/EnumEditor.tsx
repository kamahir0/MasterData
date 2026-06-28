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
  const explicitZeroIndex = definition.members.findIndex((member) => explicitEnumValue(member) === 0);
  const showVirtualFlagsZero = Boolean(definition.flags) && explicitZeroIndex < 0;
  const nextFlagsBit = nextAvailableBit(definition.members);

  const addMember = () => {
    const nextIndex = memberCount;
    updateDocument(document.relativePath, "Add enum member", (draft) => {
      if (draft.definition.kind !== "enum") return;
      const memberName = `Member${draft.definition.members.length + 1}`;
      if (draft.definition.flags) {
        draft.definition.members.push({ name: memberName, value: 1 << nextAvailableBit(draft.definition.members) });
      } else {
        draft.definition.members.push(memberName);
      }
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
                if (event.target.checked) {
                  draft.definition.members = normalizeFlagsMembers(draft.definition.members);
                }
              })
            }
          />
          Flags
        </label>
      </div>
      <div className="simple-list">
        {showVirtualFlagsZero && (
          <div className="simple-row enum-row flags-enum-row fixed-enum-zero-row" key="virtual-flags-zero">
            <input
              placeholder="None"
              value=""
              onChange={(event) => addVirtualZeroMember(event.target.value)}
            />
            <span className="enum-bit-label">Zero</span>
            <span className="enum-value-preview">0</span>
            <button className="icon-button danger-icon" disabled title="Flags zero member is required">
              <Trash2 size={14} />
            </button>
          </div>
        )}
        {definition.members.map((member, index) => {
          const name = typeof member === "string" ? member : member.name;
          const value = typeof member === "string" ? "" : String(member.value);
          const isFixedFlagsZero = Boolean(definition.flags) && explicitEnumValue(member) === 0;
          const bitIndex = explicitEnumValue(member) == null ? undefined : bitIndexForValue(explicitEnumValue(member)!);
          return (
            <div className={`simple-row enum-row ${definition.flags ? "flags-enum-row" : ""}`} key={`enum-member-${index}`}>
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
              {definition.flags ? (
                isFixedFlagsZero ? (
                  <>
                    <span className="enum-bit-label">Zero</span>
                    <span className="enum-value-preview">0</span>
                  </>
                ) : (
                  <>
                    <select
                      value={bitIndex ?? nextFlagsBit}
                      onChange={(event) =>
                        updateDocument(document.relativePath, "Edit flags enum bit", (draft) => {
                          if (draft.definition.kind !== "enum") return;
                          const current = draft.definition.members[index];
                          const nextName = typeof current === "string" ? current : current.name;
                          draft.definition.members[index] = { name: nextName, value: 1 << Number(event.target.value) };
                        })
                      }
                    >
                      {bitOptions(definition.members, index).map((bit) => (
                        <option key={bit} value={bit}>
                          Bit {bit}
                        </option>
                      ))}
                    </select>
                    <span className="enum-value-preview">{formatBitValue(bitIndex ?? nextFlagsBit)}</span>
                  </>
                )
              ) : (
                <input
                  readOnly={isFixedFlagsZero}
                  value={value}
                  placeholder={String(csharpEnumValues(definition.members)[index] ?? 0)}
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
              )}
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

function normalizeFlagsMembers(members: EnumMember[]): EnumMember[] {
  const zero = members.find((member) => explicitEnumValue(member) === 0 || enumMemberName(member) === "None");
  const normalized: EnumMember[] = zero ? [{ name: enumMemberName(zero) || "None", value: 0 }] : [];
  const usedBits = new Set<number>();
  for (const member of members) {
    const name = enumMemberName(member);
    if (!name || name === "None" || explicitEnumValue(member) === 0) continue;
    const currentBit = explicitEnumValue(member) == null ? undefined : bitIndexForValue(explicitEnumValue(member)!);
    const bit = currentBit != null && !usedBits.has(currentBit) ? currentBit : nextFreeBit(usedBits);
    usedBits.add(bit);
    normalized.push({ name, value: 1 << bit });
  }
  return normalized;
}

function enumMemberName(member: EnumMember) {
  return typeof member === "string" ? member : member.name;
}

function bitIndexForValue(value: number) {
  if (!Number.isInteger(value) || value <= 0 || (value & (value - 1)) !== 0) return undefined;
  return Math.log2(value);
}

function nextAvailableBit(members: EnumMember[]) {
  return nextFreeBit(usedFlagBits(members));
}

function nextFreeBit(used: Set<number>) {
  for (let bit = 0; bit < 30; bit += 1) {
    if (!used.has(bit)) return bit;
  }
  return 30;
}

function usedFlagBits(members: EnumMember[], exceptIndex?: number) {
  const used = new Set<number>();
  members.forEach((member, index) => {
    if (index === exceptIndex) return;
    const value = explicitEnumValue(member);
    if (value == null || value === 0) return;
    const bit = bitIndexForValue(value);
    if (bit != null) used.add(bit);
  });
  return used;
}

function bitOptions(members: EnumMember[], currentIndex: number) {
  const used = usedFlagBits(members, currentIndex);
  const current = explicitEnumValue(members[currentIndex]);
  const currentBit = current == null ? undefined : bitIndexForValue(current);
  const options = new Set<number>();
  if (currentBit != null) options.add(currentBit);
  for (let bit = 0; bit < 16; bit += 1) {
    if (!used.has(bit)) options.add(bit);
  }
  return [...options].sort((left, right) => left - right);
}

function formatBitValue(bit: number) {
  return `1 << ${bit} (${1 << bit})`;
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
