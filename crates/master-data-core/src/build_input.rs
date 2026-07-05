use crate::config::MasterDataConfig;
use crate::model::{Definition, SourceDefinition};
use crate::validate::ValidatedProject;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInput {
    pub namespace: String,
    pub output_path: String,
    pub tables: Vec<BuildTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildTable {
    pub table_name: String,
    pub type_name: String,
    pub full_type_name: String,
    pub fields: Vec<BuildField>,
    pub rows: Vec<indexmap::IndexMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildField {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
}

pub fn create_build_input(
    project_root: &Path,
    config: &MasterDataConfig,
    project: &ValidatedProject,
) -> BuildInput {
    let output_path = project_root
        .join(&config.memory.output)
        .join(&config.memory.file_name);
    let tables = project
        .build_definitions
        .iter()
        .filter_map(|item: &SourceDefinition| match &item.definition {
            Definition::Table(table) => Some(BuildTable {
                table_name: table.table.clone(),
                type_name: table.type_name.clone(),
                full_type_name: format!("{}.{}", config.csharp.namespace, table.type_name),
                fields: table
                    .fields
                    .iter()
                    .map(|field| BuildField {
                        name: field.name.clone(),
                        type_name: field.type_name.clone(),
                    })
                    .collect(),
                rows: table
                    .rows
                    .iter()
                    .filter_map(|row| row.data_values().cloned())
                    .collect(),
            }),
            _ => None,
        })
        .collect();

    BuildInput {
        namespace: config.csharp.namespace.clone(),
        output_path: output_path.to_string_lossy().to_string(),
        tables,
    }
}
