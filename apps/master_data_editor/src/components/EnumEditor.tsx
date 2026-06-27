import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import type { DefinitionDocument } from "../types";
import { EditorHeader } from "./EditorHost";

export function EnumEditor({ document }: { document: DefinitionDocument }) {
  const { updateDocument } = useEditorStore();
  const [focusMemberIndex, setFocusMemberIndex] = useState<number>();
  const memberInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const memberCount = document.definition.kind === "enum" ? document.definition.members.length : 0;

  useEffect(() => {
    if (focusMemberIndex == null) return;
    const input = memberInputRefs.current[focusMemberIndex];
    input?.focus();
    input?.select();
    setFocusMemberIndex(undefined);
  }, [memberCount, focusMemberIndex]);

  if (document.definition.kind !== "enum") return null;

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
        {document.definition.members.map((member, index) => {
          const name = typeof member === "string" ? member : member.name;
          const value = typeof member === "string" ? "" : String(member.value);
          return (
            <div className="simple-row enum-row" key={`${name}-${index}`}>
              <input
                ref={(element) => {
                  memberInputRefs.current[index] = element;
                }}
                value={name}
                onChange={(event) =>
                  updateDocument(document.relativePath, "Edit enum member", (draft) => {
                    if (draft.definition.kind !== "enum") return;
                    const current = draft.definition.members[index];
                    draft.definition.members[index] =
                      typeof current === "string" ? event.target.value : { ...current, name: event.target.value };
                  })
                }
              />
              <input
                value={value}
                placeholder="auto"
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
                  })
                }
              />
              <button className="icon-button danger-icon" title="Delete member" onClick={() => deleteMember(index)}>
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        <div className="simple-add-row">
          <button className="icon-button" title="Add member" onClick={addMember}>
            <Plus size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
