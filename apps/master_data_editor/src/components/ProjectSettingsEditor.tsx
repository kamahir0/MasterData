import { Database, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { RESERVED_UNTAGGED_TAG } from "../editorUtils";
import { useEditorStore } from "../store";
import type { BuildProfile, MasterDataConfig } from "../types";
import { TagTokenInput } from "./TagTokenInput";

export function ProjectSettingsEditor() {
  const { project, projectSettingsDirty, projectSettingsDraft, saveProjectSettings, updateProjectSettings } = useEditorStore();
  if (!project || !projectSettingsDraft) return null;

  const update = (label: string, recipe: (config: MasterDataConfig) => void) => {
    updateProjectSettings(label, recipe);
  };

  const profiles = projectSettingsDraft.buildProfiles ?? {};
  const allowedTags = projectSettingsDraft.tags?.allowed ?? [];
  const profileTagSuggestions = [...allowedTags, ...(project?.availableTags ?? []), RESERVED_UNTAGGED_TAG];

  const renameProfile = (oldName: string, nextName: string) => {
    if (!nextName || oldName === nextName) return;
    update("Rename build profile", (config) => {
      const buildProfiles = config.buildProfiles ?? {};
      if (buildProfiles[nextName]) return;
      buildProfiles[nextName] = buildProfiles[oldName];
      delete buildProfiles[oldName];
      config.buildProfiles = buildProfiles;
    });
  };

  const addProfile = () => {
    const name = window.prompt("Build profile name", "production");
    if (!name) return;
    update("Add build profile", (config) => {
      const buildProfiles = config.buildProfiles ?? {};
      if (buildProfiles[name]) return;
      buildProfiles[name] = { includeTags: [], excludeTags: [] };
      config.buildProfiles = buildProfiles;
    });
  };

  return (
    <div className="settings-editor">
      <SettingsHeader
        dirty={projectSettingsDirty}
        kind="Project Settings"
        path={`${project.root}/project-settings.yaml`}
        onSave={() => void saveProjectSettings()}
      />
      <div className="settings-scroll">
        <section className="settings-section">
          <h3>Project</h3>
          <div className="settings-grid">
            <Field label="Tool Version">
              <input
                value={projectSettingsDraft.tool.version}
                onChange={(event) => update("Edit tool version", (config) => void (config.tool.version = event.target.value))}
              />
            </Field>
            <Field label="Master Input">
              <input
                value={projectSettingsDraft.master.input ?? "master"}
                onChange={(event) => update("Edit master input", (config) => void (config.master.input = event.target.value))}
              />
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h3>C# Generation</h3>
          <div className="settings-grid">
            <Field label="Namespace">
              <input
                value={projectSettingsDraft.csharp.namespace}
                onChange={(event) => update("Edit namespace", (config) => void (config.csharp.namespace = event.target.value))}
              />
            </Field>
            <Field label="Output">
              <input
                value={projectSettingsDraft.csharp.output ?? "dist/cs"}
                onChange={(event) => update("Edit C# output", (config) => void (config.csharp.output = event.target.value))}
              />
            </Field>
            <Field label="Table Template">
              <input
                value={templateValue(projectSettingsDraft, "table")}
                onChange={(event) => update("Edit table template", (config) => setTemplate(config, "table", event.target.value))}
              />
            </Field>
            <Field label="Struct Template">
              <input
                value={templateValue(projectSettingsDraft, "struct")}
                onChange={(event) => update("Edit struct template", (config) => setTemplate(config, "struct", event.target.value))}
              />
            </Field>
            <Field label="Enum Template">
              <input
                value={templateValue(projectSettingsDraft, "enum")}
                onChange={(event) => update("Edit enum template", (config) => setTemplate(config, "enum", event.target.value))}
              />
            </Field>
          </div>
          <div className="settings-grid">
            <Field label="Static DB Accessor">
              <label className="check-row">
                <input
                  checked={Boolean(staticAccessor(projectSettingsDraft).enabled)}
                  type="checkbox"
                  onChange={(event) =>
                    update("Toggle static database accessor", (config) => {
                      const accessor = ensureStaticAccessor(config);
                      accessor.enabled = event.target.checked;
                    })
                  }
                />
                Enabled
              </label>
            </Field>
            <Field label="Accessor Expression">
              <input
                value={String(staticAccessor(projectSettingsDraft).expression ?? "")}
                onChange={(event) =>
                  update("Edit static database accessor", (config) => {
                    const accessor = ensureStaticAccessor(config);
                    accessor.expression = event.target.value || undefined;
                  })
                }
              />
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h3>Memory / Sync</h3>
          <div className="settings-grid">
            <Field label="Memory Output">
              <input
                value={projectSettingsDraft.memory.output ?? "dist/master-memory"}
                onChange={(event) => update("Edit memory output", (config) => void (config.memory.output = event.target.value))}
              />
            </Field>
            <Field label="Memory File Name">
              <input
                value={projectSettingsDraft.memory.fileName ?? "master-data.bytes"}
                onChange={(event) => update("Edit memory file name", (config) => void (config.memory.fileName = event.target.value))}
              />
            </Field>
            <Field label="Sync C# To">
              <input
                value={projectSettingsDraft.sync?.cs ?? ""}
                onChange={(event) => update("Edit sync C#", (config) => setSyncPath(config, "cs", event.target.value))}
              />
            </Field>
            <Field label="Sync Memory To">
              <input
                value={projectSettingsDraft.sync?.memory ?? ""}
                onChange={(event) => update("Edit sync memory", (config) => setSyncPath(config, "memory", event.target.value))}
              />
            </Field>
          </div>
        </section>

        <section className="settings-section">
          <h3>Tags</h3>
          <Field label="Allowed Tags">
            <TagTokenInput
              allowCustom
              placeholder="dev, test, prod"
              suggestions={allowedTags}
              value={allowedTags}
              onChange={(tags) =>
                update("Edit allowed tags", (config) => {
                  config.tags = { allowed: tags };
                })
              }
            />
          </Field>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <h3>Build Profiles</h3>
            <button className="secondary-button compact" onClick={addProfile}>
              <Plus size={14} />
              Add
            </button>
          </div>
          <div className="profile-list">
            {Object.entries(profiles).map(([name, profile]) => (
              <ProfileRow
                key={name}
                name={name}
                profile={profile}
                onDelete={() =>
                  update("Delete build profile", (config) => {
                    delete config.buildProfiles?.[name];
                  })
                }
                onRename={(nextName) => renameProfile(name, nextName)}
                suggestions={profileTagSuggestions}
                onUpdate={(recipe) =>
                  update("Edit build profile", (config) => {
                    const target = config.buildProfiles?.[name];
                    if (target) recipe(target);
                  })
                }
              />
            ))}
            {Object.keys(profiles).length === 0 && <span className="muted">No build profiles.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsHeader({
  dirty,
  kind,
  onSave,
  path
}: {
  dirty: boolean;
  kind: string;
  onSave: () => void;
  path: string;
}) {
  return (
    <div className="editor-header settings-header">
      <div>
        <div className="doc-kind">{kind}</div>
        <h2>{kind}</h2>
        <span>{path}</span>
      </div>
      <button className="secondary-button" disabled={!dirty} onClick={onSave}>
        Save
      </button>
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

function ProfileRow({
  name,
  onDelete,
  onRename,
  suggestions,
  onUpdate,
  profile
}: {
  name: string;
  onDelete: () => void;
  onRename: (name: string) => void;
  suggestions: string[];
  onUpdate: (recipe: (profile: BuildProfile) => void) => void;
  profile: BuildProfile;
}) {
  return (
    <div className="profile-row">
      <input defaultValue={name} onBlur={(event) => onRename(event.target.value.trim())} />
      <TagTokenInput
        allowCustom
        allowPseudoUntagged
        placeholder="includeTags"
        suggestions={suggestions}
        value={profile.includeTags ?? []}
        onChange={(tags) => onUpdate((target) => void (target.includeTags = tags))}
      />
      <TagTokenInput
        allowCustom
        allowPseudoUntagged
        placeholder="excludeTags"
        suggestions={suggestions}
        value={profile.excludeTags ?? []}
        onChange={(tags) => onUpdate((target) => void (target.excludeTags = tags))}
      />
      <button className="icon-button danger-icon" title="Delete profile" onClick={onDelete}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function templateValue(config: MasterDataConfig, key: "table" | "struct" | "enum") {
  return String(config.csharp.templates?.[key] ?? "");
}

function setTemplate(config: MasterDataConfig, key: "table" | "struct" | "enum", value: string) {
  const templates = { ...(config.csharp.templates ?? {}) };
  if (value.trim()) templates[key] = value.trim();
  else delete templates[key];
  config.csharp.templates = templates;
}

function setSyncPath(config: MasterDataConfig, key: "cs" | "memory", value: string) {
  const sync = { ...(config.sync ?? {}) };
  if (value.trim()) sync[key] = value.trim();
  else delete sync[key];
  config.sync = Object.keys(sync).length > 0 ? sync : undefined;
}

function staticAccessor(config: MasterDataConfig) {
  return (config.csharp.staticDatabaseAccessor ?? {}) as {
    enabled?: boolean;
    expression?: string;
    tableProperties?: Record<string, string>;
  };
}

function ensureStaticAccessor(config: MasterDataConfig) {
  const accessor = staticAccessor(config);
  config.csharp.staticDatabaseAccessor = accessor;
  return accessor;
}
