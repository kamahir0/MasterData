import { MonitorCog } from "lucide-react";
import type { ReactNode } from "react";
import { useEditorStore } from "../store";
import type { BottomPanelTab } from "../types";

export function EditorSettingsEditor() {
  const {
    bottomPanelActiveTab,
    bottomPanelHeight,
    bottomPanelVisible,
    gridFontSize,
    profilePreview,
    project,
    recentProjects,
    setBottomPanelActiveTab,
    setBottomPanelHeight,
    setBottomPanelVisible,
    setGridFontSize,
    setProfilePreview,
    setSidebarVisible,
    setTheme,
    setZoom,
    sidebarVisible,
    theme,
    zoom
  } = useEditorStore();

  return (
    <div className="settings-editor">
      <div className="editor-header settings-header">
        <div>
          <div className="doc-kind">Editor Settings</div>
          <h2>Editor Settings</h2>
          <span>Global preferences for this editor installation</span>
        </div>
        <MonitorCog size={22} />
      </div>
      <div className="settings-scroll">
        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-grid">
            <Field label="Theme">
              <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Field>
            <Field label="Zoom">
              <input
                max={180}
                min={75}
                type="number"
                value={Math.round(zoom * 100)}
                onChange={(event) => setZoom(Number(event.target.value) / 100)}
              />
            </Field>
            <Field label="Grid Font Size">
              <input
                max={22}
                min={10}
                type="number"
                value={gridFontSize}
                onChange={(event) => setGridFontSize(Number(event.target.value))}
              />
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h3>Layout</h3>
          <div className="settings-grid">
            <Field label="Sidebar">
              <label className="check-row">
                <input checked={sidebarVisible} type="checkbox" onChange={(event) => setSidebarVisible(event.target.checked)} />
                Visible
              </label>
            </Field>
            <Field label="Bottom Panel">
              <label className="check-row">
                <input checked={bottomPanelVisible} type="checkbox" onChange={(event) => setBottomPanelVisible(event.target.checked)} />
                Visible
              </label>
            </Field>
            <Field label="Bottom Panel Height">
              <input
                max={520}
                min={96}
                type="number"
                value={bottomPanelHeight}
                onChange={(event) => setBottomPanelHeight(Number(event.target.value))}
              />
            </Field>
            <Field label="Bottom Panel Tab">
              <select value={bottomPanelActiveTab} onChange={(event) => setBottomPanelActiveTab(event.target.value as BottomPanelTab)}>
                <option value="problems">Problems</option>
                <option value="buildLog">Build Log</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h3>Project Defaults</h3>
          <div className="settings-grid">
            <Field label="Default Profile">
              <select value={profilePreview ?? ""} onChange={(event) => setProfilePreview(event.target.value || undefined)}>
                <option value="">All rows</option>
                {(project?.buildProfiles ?? []).map((profile) => (
                  <option key={profile} value={profile}>
                    {profile}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h3>Recent Projects</h3>
          <div className="recent-list">
            {recentProjects.map((path) => (
              <div className="recent-row" key={path} title={path}>
                {path}
              </div>
            ))}
            {recentProjects.length === 0 && <span className="muted">No recent projects.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
