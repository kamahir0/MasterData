import { Database, Tags } from "lucide-react";
import { RESERVED_UNTAGGED_TAG } from "../editorUtils";
import { useEditorStore } from "../store";
import type { DefinitionDocument } from "../types";
import { EditorSettingsEditor } from "./EditorSettingsEditor";
import { EnumEditor } from "./EnumEditor";
import { ProjectSettingsEditor } from "./ProjectSettingsEditor";
import { StructEditor } from "./StructEditor";
import { TableEditor } from "./TableEditor";
import { TagTokenInput } from "./TagTokenInput";

export function EditorHost() {
  const { activePath, activeView, documents } = useEditorStore();
  if (activeView === "projectSettings") return <ProjectSettingsEditor />;
  if (activeView === "editorSettings") return <EditorSettingsEditor />;

  const document = activePath ? documents[activePath] : undefined;
  if (!document) return <EmptyState />;

  if (document.definition.kind === "table") return <TableEditor document={document} />;
  if (document.definition.kind === "enum") return <EnumEditor document={document} />;
  return <StructEditor document={document} />;
}

export function EditorHeader({ document, showFilters = false }: { document: DefinitionDocument; showFilters?: boolean }) {
  const { project, tagFilter, setTagFilter } = useEditorStore();
  const availableTags = project?.availableTags ?? [];
  const tagSuggestions = [...availableTags, RESERVED_UNTAGGED_TAG];

  return (
    <div className="editor-header">
      <div>
        <div className="doc-kind">{document.kind}</div>
        <h2>{document.typeName}</h2>
        <span>{document.relativePath}</span>
      </div>
      {showFilters && (
        <div className="filter-bar">
          <div className="filter-control">
            <Tags size={14} />
            <TagTokenInput
              allowCustom
              allowPseudoUntagged
              className="filter-token-input"
              suggestions={tagSuggestions}
              value={tagFilter.include}
              onChange={(include) =>
                setTagFilter({
                  include
                })
              }
              placeholder={availableTags.length > 0 ? availableTags.join(", ") : "tag filter"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <Database size={36} />
      <h1>Open a Lilja.MasterData project</h1>
      <p>Choose a YAML definition from the explorer.</p>
    </div>
  );
}
