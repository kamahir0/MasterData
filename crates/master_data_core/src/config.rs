use anyhow::{Context, Result};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const CONFIG_FILE_NAME: &str = "project-settings.yaml";
pub const TOOL_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterDataConfig {
    pub tool: ToolConfig,
    pub csharp: CSharpConfig,
    pub master: MasterInputConfig,
    pub memory: MemoryConfig,
    #[serde(default, skip_serializing_if = "TagsConfig::is_empty")]
    pub tags: TagsConfig,
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub build_profiles: IndexMap<String, BuildProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync: Option<SyncConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfig {
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TagsConfig {
    #[serde(default)]
    pub allowed: Vec<String>,
}

impl TagsConfig {
    fn is_empty(&self) -> bool {
        self.allowed.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProfile {
    #[serde(default)]
    pub include_tags: Vec<String>,
    #[serde(default)]
    pub exclude_tags: Vec<String>,
    #[serde(default = "default_include_untagged", skip_serializing)]
    pub include_untagged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CSharpConfig {
    pub namespace: String,
    #[serde(default = "default_csharp_output")]
    pub output: PathBuf,
    #[serde(default, skip_serializing_if = "CSharpTemplates::is_empty")]
    pub templates: CSharpTemplates,
    #[serde(
        default,
        skip_serializing_if = "StaticDatabaseAccessorConfig::is_disabled"
    )]
    pub static_database_accessor: StaticDatabaseAccessorConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CSharpTemplates {
    pub table: Option<PathBuf>,
    #[serde(rename = "struct")]
    pub struct_: Option<PathBuf>,
    #[serde(rename = "enum")]
    pub enum_: Option<PathBuf>,
}

impl CSharpTemplates {
    fn is_empty(&self) -> bool {
        self.table.is_none() && self.struct_.is_none() && self.enum_.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticDatabaseAccessorConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub expression: Option<String>,
    #[serde(default)]
    pub table_properties: indexmap::IndexMap<String, String>,
}

impl Default for StaticDatabaseAccessorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            expression: None,
            table_properties: indexmap::IndexMap::new(),
        }
    }
}

impl StaticDatabaseAccessorConfig {
    fn is_disabled(&self) -> bool {
        !self.enabled && self.expression.is_none() && self.table_properties.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterInputConfig {
    #[serde(default = "default_master_input")]
    pub input: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConfig {
    #[serde(default = "default_memory_output")]
    pub output: PathBuf,
    #[serde(default = "default_memory_file_name")]
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cs: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<PathBuf>,
}

impl MasterDataConfig {
    pub fn load(project_root: &Path) -> Result<Self> {
        let path = project_root.join(CONFIG_FILE_NAME);
        let text = fs::read_to_string(&path)
            .with_context(|| format!("failed to read config: {}", path.display()))?;
        serde_yaml::from_str(&text)
            .with_context(|| format!("failed to parse config: {}", path.display()))
    }

    pub fn ensure_tool_version(&self, actual_version: &str) -> Result<()> {
        if self.tool.version != actual_version {
            anyhow::bail!(
                "project requires MasterData {}, but this tool is {}",
                self.tool.version,
                actual_version
            );
        }
        Ok(())
    }

    pub fn build_profile(&self, name: Option<&str>) -> Result<Option<&BuildProfile>> {
        let Some(name) = name else {
            return Ok(None);
        };
        self.build_profiles
            .get(name)
            .map(Some)
            .with_context(|| format!("unknown build profile `{name}`"))
    }

    pub fn to_yaml_string(&self) -> Result<String> {
        serde_yaml::to_string(self).with_context(|| "failed to serialize config")
    }
}

fn default_csharp_output() -> PathBuf {
    PathBuf::from("dist/cs")
}

fn default_master_input() -> PathBuf {
    PathBuf::from("master")
}

fn default_memory_output() -> PathBuf {
    PathBuf::from("dist/master-memory")
}

fn default_memory_file_name() -> String {
    "master-data.bytes".to_string()
}

fn default_include_untagged() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_config_with_tool_version() {
        let config: MasterDataConfig = serde_yaml::from_str(
            r#"tool:
  version: 0.1.0
csharp:
  namespace: Game.MasterData
master:
  input: master
memory:
  output: dist/master-memory
  fileName: master-data.bytes
tags:
  allowed: [dev, prod]
buildProfiles:
  production:
    excludeTags: [dev]
"#,
        )
        .unwrap();

        assert_eq!(config.tool.version, "0.1.0");
        assert_eq!(config.csharp.output, PathBuf::from("dist/cs"));
        assert_eq!(config.tags.allowed, vec!["dev", "prod"]);
        assert!(config.build_profile(Some("production")).unwrap().is_some());
        assert!(config.sync.is_none());
    }

    #[test]
    fn rejects_unknown_build_profile() {
        let config: MasterDataConfig = serde_yaml::from_str(
            r#"tool:
  version: 0.1.0
csharp:
  namespace: Game.MasterData
master:
  input: master
memory:
  output: dist/master-memory
  fileName: master-data.bytes
"#,
        )
        .unwrap();

        assert!(config.build_profile(Some("production")).is_err());
    }
}
