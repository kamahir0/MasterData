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

import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "24px",
          margin: "24px",
          backgroundColor: "#fff5f5",
          border: "1px solid #ffe3e3",
          borderRadius: "8px",
          color: "#c92a2a",
          fontFamily: "monospace",
          overflow: "auto",
          height: "calc(100% - 48px)"
        }}>
          <h2 style={{ marginTop: 0, fontSize: "18px" }}>Failed to render document editor</h2>
          <p style={{ fontWeight: "bold", fontSize: "14px", margin: "12px 0" }}>
            {this.state.error?.message}
          </p>
          <pre style={{
            backgroundColor: "#fff",
            border: "1px solid #ffd8d8",
            borderRadius: "4px",
            padding: "16px",
            fontSize: "12px",
            color: "#495057",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            overflow: "auto",
            maxHeight: "500px"
          }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export function EditorHost() {
  const { activePath, activeView, documents } = useEditorStore();
  if (activeView === "projectSettings") return <ProjectSettingsEditor />;
  if (activeView === "editorSettings") return <EditorSettingsEditor />;

  const document = activePath ? documents[activePath] : undefined;
  if (!document) return <EmptyState />;

  return (
    <ErrorBoundary key={activePath}>
      <DocumentEditor document={document} />
    </ErrorBoundary>
  );
}

function DocumentEditor({ document }: { document: DefinitionDocument }) {
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
      <h1>Open a MasterData project</h1>
      <p>Choose a YAML definition from the explorer.</p>
    </div>
  );
}
