use crate::config::{CSharpConfig, MasterDataConfig};
use crate::model::*;
use crate::validate::{resolve_type, ValidatedProject};
use anyhow::{Context, Result};
use heck::ToLowerCamelCase;
use indexmap::IndexSet;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const BUILTIN_TABLE_TEMPLATE: &str =
    include_str!("../../../embedded/templates/csharp/table.cs.tpl");
const BUILTIN_STRUCT_TEMPLATE: &str =
    include_str!("../../../embedded/templates/csharp/struct.cs.tpl");
const BUILTIN_ENUM_TEMPLATE: &str = include_str!("../../../embedded/templates/csharp/enum.cs.tpl");

#[derive(Debug, Clone)]
pub struct GeneratedFile {
    pub path: PathBuf,
    pub content: String,
}

pub fn generate_csharp_files(
    project_root: &Path,
    config: &MasterDataConfig,
    project: &ValidatedProject,
) -> Result<Vec<GeneratedFile>> {
    let enum_names: IndexSet<String> = project
        .definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Enum(value) => Some(value.name.clone()),
            _ => None,
        })
        .collect();
    let struct_names: IndexSet<String> = project
        .definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Struct(value) => Some(value.name.clone()),
            _ => None,
        })
        .collect();

    let mut files = Vec::new();
    for item in &project.definitions {
        let body = match &item.definition {
            Definition::Enum(value) => generate_enum_body(value),
            Definition::Struct(value) => generate_struct_body(value, &enum_names, &struct_names),
            Definition::Table(value) => generate_table_body(
                value,
                &config.csharp,
                &project.definitions,
                &enum_names,
                &struct_names,
            ),
        };
        let template = load_template(project_root, &config.csharp, item.definition.kind())?;
        let content = apply_template(
            &template,
            &config.csharp.namespace,
            item.definition.kind(),
            item.definition.type_name(),
            &source_hash(config, project),
            &body,
        )?;
        files.push(GeneratedFile {
            path: config
                .csharp
                .output
                .join(format!("{}.cs", item.definition.type_name())),
            content,
        });
    }

    files.push(GeneratedFile {
        path: config
            .csharp
            .output
            .join("LiljaMasterData_IsExternalInit.cs"),
        content: generate_is_external_init_support(),
    });
    files.push(GeneratedFile {
        path: config
            .csharp
            .output
            .join("LiljaMasterData_MasterMemoryGeneratorOptions.cs"),
        content: generate_master_memory_generator_options(&config.csharp.namespace),
    });

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

pub fn write_generated_files(project_root: &Path, files: &[GeneratedFile]) -> Result<()> {
    for file in files {
        let path = project_root.join(&file.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create directory: {}", parent.display()))?;
        }
        fs::write(&path, &file.content)
            .with_context(|| format!("failed to write generated file: {}", path.display()))?;
    }
    Ok(())
}

fn load_template(project_root: &Path, config: &CSharpConfig, kind: &str) -> Result<String> {
    let configured = match kind {
        "table" => config.templates.table.as_ref(),
        "struct" => config.templates.struct_.as_ref(),
        "enum" => config.templates.enum_.as_ref(),
        _ => None,
    };
    if let Some(path) = configured {
        let path = project_root.join(path);
        return fs::read_to_string(&path)
            .with_context(|| format!("failed to read C# template: {}", path.display()));
    }

    Ok(match kind {
        "table" => BUILTIN_TABLE_TEMPLATE,
        "struct" => BUILTIN_STRUCT_TEMPLATE,
        "enum" => BUILTIN_ENUM_TEMPLATE,
        _ => BUILTIN_TABLE_TEMPLATE,
    }
    .to_string())
}

fn apply_template(
    template: &str,
    namespace: &str,
    kind: &str,
    definition_name: &str,
    source_hash: &str,
    body: &str,
) -> Result<String> {
    if template.matches("{body}").count() != 1 {
        anyhow::bail!("C# template must contain {{body}} exactly once");
    }

    Ok(template
        .replace("{{ namespace }}", namespace)
        .replace("{{ generator_version }}", env!("CARGO_PKG_VERSION"))
        .replace("{{ source_hash }}", source_hash)
        .replace("{{ definition_name }}", definition_name)
        .replace("{{ definition_kind }}", kind)
        .replace("{body}", body))
}

fn source_hash(config: &MasterDataConfig, project: &ValidatedProject) -> String {
    let mut hasher = Sha256::new();
    hasher.update(env!("CARGO_PKG_VERSION").as_bytes());
    hasher.update(serde_json::to_vec(config).unwrap_or_default());
    for item in &project.definitions {
        hasher.update(item.source.relative_path.to_string_lossy().as_bytes());
        hasher.update(item.source.text.as_bytes());
    }
    let hash = hasher.finalize();
    format!("{hash:x}")
}

fn generate_is_external_init_support() -> String {
    r#"// <auto-generated />
// Generated by Lilja.MasterData.
#if !NET5_0_OR_GREATER

namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit
    {
    }
}

#endif
"#
    .to_string()
}

fn generate_master_memory_generator_options(namespace: &str) -> String {
    format!(
        "// <auto-generated />\n// Generated by Lilja.MasterData.\n\nusing MasterMemory;\n\n[assembly: MasterMemoryGeneratorOptions(Namespace = \"{}\")]\n",
        namespace
    )
}

fn generate_enum_body(value: &EnumDefinition) -> String {
    let mut output = String::new();
    if value.flags {
        output.push_str("[System.Flags]\n");
    }
    if value.underlying_type == "int" {
        output.push_str(&format!("public enum {}\n{{\n", value.name));
    } else {
        output.push_str(&format!(
            "public enum {} : {}\n{{\n",
            value.name, value.underlying_type
        ));
    }
    if value.flags && !enum_has_explicit_zero(value) {
        output.push_str("    None = 0,\n");
    }
    for member in &value.members {
        match member {
            EnumMember::Name(name) => output.push_str(&format!("    {},\n", name)),
            EnumMember::WithValue { name, value } => {
                output.push_str(&format!("    {} = {},\n", name, value))
            }
        }
    }
    output.push_str("}\n");
    output
}

fn enum_has_explicit_zero(value: &EnumDefinition) -> bool {
    value
        .members
        .iter()
        .any(|member| matches!(member, EnumMember::WithValue { value: 0, .. }))
}

fn generate_struct_body(
    value: &StructDefinition,
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
) -> String {
    let mut output = String::new();
    output.push_str("[MessagePackObject]\n");
    output.push_str(&format!(
        "public readonly partial struct {}\n{{\n",
        value.name
    ));
    for (index, field) in value.fields.iter().enumerate() {
        let ty = resolve_type(&field.type_name, enum_names, struct_names).csharp_type();
        output.push_str(&format!("    [Key({})]\n", message_pack_key(field, index)));
        output.push_str(&format!(
            "    public {} {} {{ get; init; }}\n\n",
            ty, field.name
        ));
    }
    output.push_str("}\n");
    output
}

fn generate_table_body(
    value: &TableDefinition,
    csharp: &CSharpConfig,
    definitions: &[SourceDefinition],
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("[MemoryTable(\"{}\")]\n", value.table));
    output.push_str("[MessagePackObject]\n");
    output.push_str(&format!(
        "public sealed partial record {}\n{{\n",
        value.type_name
    ));

    for (index, field) in value.fields.iter().enumerate() {
        for attr in master_memory_key_attributes(value, &field.name) {
            output.push_str("    ");
            output.push_str(&attr);
            output.push('\n');
        }
        output.push_str(&format!("    [Key({})]\n", message_pack_key(field, index)));
        let ty = resolve_type(&field.type_name, enum_names, struct_names).csharp_type();
        output.push_str(&format!(
            "    public {} {} {{ get; init; }}{}\n\n",
            ty,
            field.name,
            default_initializer(&ty)
        ));
    }

    if !value.refs.is_empty() {
        output.push_str("#if !LILJA_MASTERDATA_BUILD\n");
        for reference in &value.refs {
            output.push_str(&generate_ref_method(
                value,
                reference,
                csharp,
                definitions,
                enum_names,
                struct_names,
            ));
            if csharp.static_database_accessor.enabled {
                if let Some(property) = generate_static_accessor_property(
                    value,
                    reference,
                    csharp,
                    definitions,
                    enum_names,
                    struct_names,
                ) {
                    output.push_str(&property);
                }
            }
        }
        output.push_str("#endif\n");
    }

    output.push_str("}\n");
    output
}

fn message_pack_key(field: &FieldDefinition, fallback_index: usize) -> usize {
    field.fixed_index.unwrap_or(fallback_index)
}

fn master_memory_key_attributes(table: &TableDefinition, field_name: &str) -> Vec<String> {
    let mut attributes = Vec::new();
    for (order, key_field) in table.keys.primary.fields.iter().enumerate() {
        if key_field == field_name {
            if table.keys.primary.fields.len() == 1 {
                attributes.push("[PrimaryKey]".to_string());
            } else {
                attributes.push(format!("[PrimaryKey(keyOrder: {})]", order));
            }
        }
    }
    for (key_index, key) in table.keys.secondary.iter().enumerate() {
        for (order, key_field) in key.fields.iter().enumerate() {
            if key_field == field_name {
                if key.unique {
                    attributes.push(format!(
                        "[SecondaryKey({}, keyOrder: {})]",
                        key_index, order
                    ));
                } else {
                    attributes.push(format!(
                        "[SecondaryKey({}, keyOrder: {}), NonUnique]",
                        key_index, order
                    ));
                }
            }
        }
    }
    attributes
}

fn default_initializer(csharp_type: &str) -> String {
    if csharp_type == "string" {
        " = \"\";".to_string()
    } else if csharp_type.starts_with("global::System.Collections.Immutable.ImmutableArray<") {
        format!(" = {}.Empty;", csharp_type)
    } else {
        String::new()
    }
}

fn generate_ref_method(
    source_table: &TableDefinition,
    reference: &MasterRefDefinition,
    csharp: &CSharpConfig,
    definitions: &[SourceDefinition],
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
) -> String {
    let target = find_table(definitions, &reference.target).expect("validated target table");
    let target_table_type = table_api_type_name(&csharp.namespace, target);
    let target_record_type = full_type_name(&csharp.namespace, &target.type_name);
    let is_list = reference
        .fields
        .iter()
        .filter_map(|mapping| {
            source_table
                .fields
                .iter()
                .find(|field| field.name == mapping.local)
        })
        .any(|field| {
            resolve_type(&field.type_name, enum_names, struct_names)
                .list_element_type()
                .is_some()
        });
    let is_unique = selected_key_unique(reference, target);
    let return_type = if is_list {
        format!(
            "global::System.Collections.Immutable.ImmutableArray<{}>",
            target_record_type
        )
    } else if is_unique {
        target_record_type.clone()
    } else {
        format!("global::MasterMemory.RangeView<{}>", target_record_type)
    };
    let method_name = format!("Get{}", reference.name);
    let find_method = find_method_name(reference, target);

    let mut output = String::new();
    output.push_str(&format!(
        "    public {} {}({} table)\n    {{\n",
        return_type, method_name, target_table_type
    ));

    if is_list {
        let list_mapping = reference
            .fields
            .iter()
            .find(|mapping| {
                source_table
                    .fields
                    .iter()
                    .find(|field| field.name == mapping.local)
                    .map(|field| {
                        resolve_type(&field.type_name, enum_names, struct_names)
                            .list_element_type()
                            .is_some()
                    })
                    .unwrap_or(false)
            })
            .expect("validated list mapping");
        output.push_str(&format!("        var builder = global::System.Collections.Immutable.ImmutableArray.CreateBuilder<{}>();\n", target_record_type));
        output.push_str(&format!(
            "        foreach (var item in {})\n        {{\n",
            list_mapping.local
        ));
        let args = reference
            .fields
            .iter()
            .map(|mapping| {
                if mapping.local == list_mapping.local {
                    "item".to_string()
                } else {
                    mapping.local.clone()
                }
            })
            .collect::<Vec<_>>();
        let args = format_find_args(&args);
        output.push_str(&format!(
            "            builder.Add(table.{}({}));\n",
            find_method, args
        ));
        output.push_str("        }\n\n        return builder.ToImmutable();\n");
    } else {
        let args = reference
            .fields
            .iter()
            .map(|mapping| mapping.local.clone())
            .collect::<Vec<_>>();
        let args = format_find_args(&args);
        output.push_str(&format!(
            "        return table.{}({});\n",
            find_method, args
        ));
    }
    output.push_str("    }\n\n");
    output
}

fn generate_static_accessor_property(
    source_table: &TableDefinition,
    reference: &MasterRefDefinition,
    csharp: &CSharpConfig,
    definitions: &[SourceDefinition],
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
) -> Option<String> {
    let target = find_table(definitions, &reference.target)?;
    let expression = csharp.static_database_accessor.expression.as_ref()?;
    let table_property = csharp
        .static_database_accessor
        .table_properties
        .get(&target.type_name)?;
    let target_record_type = full_type_name(&csharp.namespace, &target.type_name);
    let is_list = reference.fields.iter().any(|mapping| {
        source_table
            .fields
            .iter()
            .find(|field| field.name == mapping.local)
            .map(|field| {
                resolve_type(&field.type_name, enum_names, struct_names)
                    .list_element_type()
                    .is_some()
            })
            .unwrap_or(false)
    });
    let return_type = if is_list {
        format!(
            "global::System.Collections.Immutable.ImmutableArray<{}>",
            target_record_type
        )
    } else {
        target_record_type
    };
    let cache_field = format!("_{}Cache", reference.name.to_lower_camel_case());
    if is_list {
        let initialized_field =
            format!("_{}CacheInitialized", reference.name.to_lower_camel_case());
        Some(format!(
            "    private {} {};\n    private bool {};\n\n    public {} {}\n    {{\n        get\n        {{\n            if (!{})\n            {{\n                {} = Get{}({}.{});\n                {} = true;\n            }}\n\n            return {};\n        }}\n    }}\n\n",
            return_type,
            cache_field,
            initialized_field,
            return_type,
            reference.name,
            initialized_field,
            cache_field,
            reference.name,
            expression,
            table_property,
            initialized_field,
            cache_field
        ))
    } else {
        Some(format!(
            "    private {}? {};\n\n    public {} {} =>\n        {} ??= Get{}({}.{});\n\n",
            return_type,
            cache_field,
            return_type,
            reference.name,
            cache_field,
            reference.name,
            expression,
            table_property
        ))
    }
}

fn find_table<'a>(
    definitions: &'a [SourceDefinition],
    type_name: &str,
) -> Option<&'a TableDefinition> {
    definitions.iter().find_map(|item| match &item.definition {
        Definition::Table(table) if table.type_name == type_name => Some(table),
        _ => None,
    })
}

fn selected_key_unique(reference: &MasterRefDefinition, target: &TableDefinition) -> bool {
    if reference.target_key.primary || reference.target_key.fields == target.keys.primary.fields {
        return true;
    }
    target
        .keys
        .secondary
        .iter()
        .find(|key| key.fields == reference.target_key.fields)
        .map(|key| key.unique)
        .unwrap_or(true)
}

fn find_method_name(reference: &MasterRefDefinition, target: &TableDefinition) -> String {
    let fields = if reference.target_key.primary
        || reference.target_key.fields == target.keys.primary.fields
    {
        &target.keys.primary.fields
    } else {
        &reference.target_key.fields
    };
    format!("FindBy{}", fields.join("And"))
}

fn table_api_type_name(namespace: &str, table: &TableDefinition) -> String {
    format!("global::{}.Tables.{}Table", namespace, table.type_name)
}

fn full_type_name(namespace: &str, type_name: &str) -> String {
    format!("global::{}.{}", namespace, type_name)
}

fn format_find_args(args: &[String]) -> String {
    if args.len() == 1 {
        args[0].clone()
    } else {
        format!("({})", args.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CSharpTemplates, StaticDatabaseAccessorConfig};

    fn field(name: &str, fixed_index: Option<usize>) -> FieldDefinition {
        FieldDefinition {
            name: name.to_string(),
            type_name: "int".to_string(),
            fixed_index,
        }
    }

    #[test]
    fn table_message_pack_keys_use_fixed_indexes() {
        let table = TableDefinition {
            table: "items".to_string(),
            type_name: "ItemMaster".to_string(),
            keys: KeyDefinitions {
                primary: KeyDefinition {
                    fields: vec!["Id".to_string()],
                },
                secondary: Vec::new(),
            },
            fields: vec![field("Name", Some(4)), field("Id", Some(0))],
            refs: Vec::new(),
            rows: Vec::new(),
        };
        let csharp = CSharpConfig {
            namespace: "Sandbox".to_string(),
            output: PathBuf::new(),
            templates: CSharpTemplates::default(),
            static_database_accessor: StaticDatabaseAccessorConfig::default(),
        };

        let body = generate_table_body(&table, &csharp, &[], &IndexSet::new(), &IndexSet::new());

        assert!(body.contains("public int Name"));
        assert!(body.contains("[Key(4)]"));
        assert!(body.contains("public int Id"));
        assert!(body.contains("[Key(0)]"));
    }

    #[test]
    fn struct_message_pack_keys_fall_back_to_field_order() {
        let value = StructDefinition {
            name: "Point".to_string(),
            fields: vec![field("X", None), field("Y", Some(7))],
        };

        let body = generate_struct_body(&value, &IndexSet::new(), &IndexSet::new());

        assert!(body.contains("[Key(0)]"));
        assert!(body.contains("public int X"));
        assert!(body.contains("[Key(7)]"));
        assert!(body.contains("public int Y"));
    }

    #[test]
    fn flags_enum_emits_flags_attribute() {
        let value = EnumDefinition {
            name: "Permission".to_string(),
            underlying_type: "int".to_string(),
            flags: true,
            members: vec![
                EnumMember::WithValue {
                    name: "None".to_string(),
                    value: 0,
                },
                EnumMember::WithValue {
                    name: "Read".to_string(),
                    value: 1,
                },
            ],
        };

        let body = generate_enum_body(&value);

        assert!(body.contains("[System.Flags]"));
        assert!(body.contains("public enum Permission"));
    }

    #[test]
    fn flags_enum_without_zero_emits_auto_none() {
        let value = EnumDefinition {
            name: "Permission".to_string(),
            underlying_type: "int".to_string(),
            flags: true,
            members: vec![EnumMember::WithValue {
                name: "Read".to_string(),
                value: 1,
            }],
        };

        let body = generate_enum_body(&value);

        assert!(body.contains("None = 0"));
        assert!(body.contains("Read = 1"));
    }
}
