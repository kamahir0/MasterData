import { AlertCircle, Bug, ChevronRight, PanelBottomClose } from "lucide-react";
import clsx from "clsx";
import { useEditorStore } from "../store";
import type { BottomPanelTab, EditorDiagnostic } from "../types";
import { shortPath } from "../editorUtils";

export function BottomPanel() {
  const {
    bottomPanelActiveTab,
    bottomPanelHeight,
    buildLog,
    diagnostics,
    setBottomPanelActiveTab,
    setBottomPanelHeight,
    setBottomPanelVisible
  } = useEditorStore();

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottomPanelHeight;
    const onMove = (moveEvent: PointerEvent) => {
      setBottomPanelHeight(startHeight + startY - moveEvent.clientY);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  return (
    <footer className="bottom-panel">
      <div className="bottom-resize-handle" onPointerDown={startResize} onDoubleClick={() => setBottomPanelHeight(160)} />
      <div className="bottom-tabs">
        <TabButton
          active={bottomPanelActiveTab === "problems"}
          label={`Problems ${diagnostics.length}`}
          onClick={() => setBottomPanelActiveTab("problems")}
        />
        <TabButton
          active={bottomPanelActiveTab === "buildLog"}
          label="Build Log"
          onClick={() => setBottomPanelActiveTab("buildLog")}
        />
        <button className="icon-button panel-close-button" title="Hide Panel" onClick={() => setBottomPanelVisible(false)}>
          <PanelBottomClose size={15} />
        </button>
      </div>
      <div className="bottom-content">
        {bottomPanelActiveTab === "problems" ? <Problems diagnostics={diagnostics} /> : <BuildLog buildLog={buildLog} />}
      </div>
    </footer>
  );
}

export function StatusStrip() {
  const { buildLog, diagnostics, setBottomPanelActiveTab, setBottomPanelVisible } = useEditorStore();
  const latest = buildLog.at(-1) ?? "Ready";
  const open = (tab: BottomPanelTab) => {
    setBottomPanelActiveTab(tab);
    setBottomPanelVisible(true);
  };
  return (
    <footer className="status-strip">
      <button onClick={() => open("problems")}>
        <Bug size={13} />
        Problems {diagnostics.length}
      </button>
      <button className="status-log" onClick={() => open("buildLog")}>
        <ChevronRight size={13} />
        {latest}
      </button>
    </footer>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={clsx("bottom-tab", active && "active")} onClick={onClick}>
      {label}
    </button>
  );
}

function Problems({ diagnostics }: { diagnostics: EditorDiagnostic[] }) {
  return (
    <div className="problem-list">
      {diagnostics.length === 0 && <span className="muted">No diagnostics</span>}
      {diagnostics.map((diagnostic, index) => (
        <DiagnosticLine diagnostic={diagnostic} key={`${diagnostic.code}-${index}`} />
      ))}
    </div>
  );
}

function BuildLog({ buildLog }: { buildLog: string[] }) {
  return (
    <div className="log-list">
      {buildLog.length === 0 && <span className="muted">No build log</span>}
      {buildLog.slice(-100).map((line, index) => (
        <div key={`${line}-${index}`}>{line}</div>
      ))}
    </div>
  );
}

function DiagnosticLine({ diagnostic }: { diagnostic: EditorDiagnostic }) {
  const openDiagnostic = useEditorStore((state) => state.openDiagnostic);
  const title = `${diagnostic.code}\n${diagnostic.path ? diagnostic.path : "project"}\n${diagnostic.message}`;
  return (
    <button
      className={clsx("diagnostic-line", diagnostic.severity)}
      onClick={() => openDiagnostic(diagnostic)}
      title={title}
    >
      <AlertCircle size={13} />
      <span>{diagnostic.code}</span>
      <strong>{diagnostic.path ? shortPath(diagnostic.path) : "project"}</strong>
      <span>{diagnostic.message}</span>
    </button>
  );
}
