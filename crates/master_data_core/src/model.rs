use anyhow::{Context, Result};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct SourceFile {
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct SourceDefinition {
    pub source: SourceFile,
    pub definition: Definition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Definition {
    #[serde(rename = "enum")]
    Enum(EnumDefinition),
    #[serde(rename = "struct")]
    Struct(StructDefinition),
    #[serde(rename = "table")]
    Table(TableDefinition),
}

impl Definition {
    pub fn type_name(&self) -> &str {
        match self {
            Definition::Enum(value) => &value.name,
            Definition::Struct(value) => &value.name,
            Definition::Table(value) => &value.type_name,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Definition::Enum(_) => "enum",
            Definition::Struct(_) => "struct",
            Definition::Table(_) => "table",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumDefinition {
    pub name: String,
    #[serde(default = "default_enum_underlying_type")]
    pub underlying_type: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub flags: bool,
    pub members: Vec<EnumMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EnumMember {
    Name(String),
    WithValue { name: String, value: i64 },
}

impl EnumMember {
    pub fn name(&self) -> &str {
        match self {
            EnumMember::Name(name) => name,
            EnumMember::WithValue { name, .. } => name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructDefinition {
    pub name: String,
    #[serde(default)]
    pub fields: Vec<FieldDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDefinition {
    pub table: String,
    pub type_name: String,
    pub keys: KeyDefinitions,
    #[serde(default)]
    pub fields: Vec<FieldDefinition>,
    #[serde(default)]
    pub refs: Vec<MasterRefDefinition>,
    #[serde(default)]
    pub rows: Vec<RowDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowDefinition {
    pub data: Option<IndexMap<String, Value>>,
    #[serde(default, skip_serializing_if = "RowMeta::is_empty")]
    pub meta: RowMeta,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RowMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<Value>,
}

impl RowMeta {
    pub fn is_empty(&self) -> bool {
        self.tags.is_empty()
    }
}

impl RowDefinition {
    pub fn data_values(&self) -> Option<&IndexMap<String, Value>> {
        self.data.as_ref()
    }

    pub fn tag_names(&self) -> Vec<&str> {
        self.meta
            .tags
            .iter()
            .filter_map(|value| value.as_str())
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDefinition {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    #[serde(
        default,
        rename = "fixedIndex",
        skip_serializing_if = "Option::is_none"
    )]
    pub fixed_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyDefinitions {
    pub primary: KeyDefinition,
    #[serde(default)]
    pub secondary: Vec<SecondaryKeyDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyDefinition {
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecondaryKeyDefinition {
    pub fields: Vec<String>,
    #[serde(default = "default_unique")]
    pub unique: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterRefDefinition {
    pub name: String,
    pub target: String,
    pub target_key: MasterRefTargetKey,
    pub fields: Vec<MasterRefFieldMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterRefTargetKey {
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterRefFieldMapping {
    pub local: String,
    pub target: String,
}

impl SourceDefinition {
    pub fn parse(source: SourceFile) -> Result<Self> {
        let definition: Definition = serde_yaml::from_str(&source.text).with_context(|| {
            format!("failed to parse YAML definition: {}", source.path.display())
        })?;
        Ok(Self { source, definition })
    }
}

fn default_enum_underlying_type() -> String {
    "int".to_string()
}

fn default_unique() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}
