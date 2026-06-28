use crate::config::BuildProfile;
use crate::diagnostics::{Diagnostic, DiagnosticBag};
use crate::model::*;
use indexmap::{IndexMap, IndexSet};
use regex::Regex;
use serde_yaml::Value;

const RESERVED_UNTAGGED_TAG: &str = "untagged";

#[derive(Debug, Clone)]
pub struct ValidatedProject {
    pub definitions: Vec<SourceDefinition>,
    pub build_definitions: Vec<SourceDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedType {
    Scalar(String),
    Enum(String),
    Struct(String),
    List(Box<ResolvedType>),
    Unknown(String),
}

#[derive(Debug, Clone)]
struct EnumValueInfo {
    members: IndexSet<String>,
    flags: bool,
    has_zero_default: bool,
}

impl ResolvedType {
    pub fn csharp_type(&self) -> String {
        match self {
            ResolvedType::Scalar(name) => match name.as_str() {
                "bool" => "bool".to_string(),
                "int" => "int".to_string(),
                "long" => "long".to_string(),
                "float" => "float".to_string(),
                "double" => "double".to_string(),
                "string" => "string".to_string(),
                _ => name.clone(),
            },
            ResolvedType::Enum(name) | ResolvedType::Struct(name) | ResolvedType::Unknown(name) => {
                name.clone()
            }
            ResolvedType::List(inner) => {
                format!(
                    "global::System.Collections.Immutable.ImmutableArray<{}>",
                    inner.csharp_type()
                )
            }
        }
    }

    pub fn is_key_compatible(&self) -> bool {
        match self {
            ResolvedType::Scalar(name) => name == "int" || name == "long" || name == "string",
            ResolvedType::Enum(_) => true,
            _ => false,
        }
    }

    pub fn list_element_type(&self) -> Option<&ResolvedType> {
        match self {
            ResolvedType::List(inner) => Some(inner.as_ref()),
            _ => None,
        }
    }
}

pub fn validate(
    definitions: Vec<SourceDefinition>,
    profile: Option<&BuildProfile>,
    allowed_tags: &[String],
) -> Result<ValidatedProject, DiagnosticBag> {
    let mut bag = DiagnosticBag::default();
    let identifier = Regex::new(r"^[A-Z_][A-Za-z0-9_]*$").expect("valid regex");
    let tag_identifier = Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$").expect("valid regex");
    let allowed_tags: IndexSet<String> = allowed_tags.iter().cloned().collect();
    let build_definitions = filter_definitions(&definitions, profile);

    if allowed_tags.contains(RESERVED_UNTAGGED_TAG) {
        bag.push(Diagnostic::error(
            "LMD0605",
            "`untagged` is reserved and cannot be declared as a tag",
        ));
    }

    let mut type_names = IndexMap::<String, usize>::new();
    let mut table_names = IndexMap::<String, usize>::new();

    for (index, item) in definitions.iter().enumerate() {
        let type_name = item.definition.type_name();
        if !identifier.is_match(type_name) {
            bag.push(
                Diagnostic::error("LMD0201", format!("invalid C# type name `{type_name}`"))
                    .at(&item.source.path),
            );
        }
        if let Some(previous) = type_names.insert(type_name.to_string(), index) {
            bag.push(
                Diagnostic::error(
                    "LMD0202",
                    format!(
                        "duplicate type name `{}` also declared in {}",
                        type_name,
                        definitions[previous].source.relative_path.display()
                    ),
                )
                .at(&item.source.path),
            );
        }

        if let Definition::Table(table) = &item.definition {
            if let Some(previous) = table_names.insert(table.table.clone(), index) {
                bag.push(
                    Diagnostic::error(
                        "LMD0203",
                        format!(
                            "duplicate table name `{}` also declared in {}",
                            table.table,
                            definitions[previous].source.relative_path.display()
                        ),
                    )
                    .at(&item.source.path),
                );
            }
        }
    }

    let enum_names: IndexSet<String> = definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Enum(value) => Some(value.name.clone()),
            _ => None,
        })
        .collect();
    let struct_names: IndexSet<String> = definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Struct(value) => Some(value.name.clone()),
            _ => None,
        })
        .collect();

    for item in &definitions {
        match &item.definition {
            Definition::Enum(value) => validate_enum(value, &identifier, item, &mut bag),
            Definition::Struct(value) => validate_struct(
                value,
                &identifier,
                item,
                &enum_names,
                &struct_names,
                &mut bag,
            ),
            Definition::Table(value) => validate_table_structure(
                value,
                &identifier,
                &tag_identifier,
                item,
                &definitions,
                &enum_names,
                &struct_names,
                &allowed_tags,
                &mut bag,
            ),
        }
    }

    for item in &build_definitions {
        if let Definition::Table(value) = &item.definition {
            validate_filtered_table(value, item, &build_definitions, &mut bag);
        }
    }

    if bag.has_errors() {
        Err(bag)
    } else {
        Ok(ValidatedProject {
            definitions,
            build_definitions,
        })
    }
}

pub fn resolve_type(
    type_name: &str,
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
) -> ResolvedType {
    if let Some(inner) = type_name
        .strip_prefix("list<")
        .and_then(|value| value.strip_suffix('>'))
    {
        if inner.starts_with("list<") {
            return ResolvedType::Unknown(type_name.to_string());
        }
        return ResolvedType::List(Box::new(resolve_type(inner, enum_names, struct_names)));
    }

    match type_name {
        "bool" | "int" | "long" | "float" | "double" | "string" => {
            ResolvedType::Scalar(type_name.to_string())
        }
        _ if enum_names.contains(type_name) => ResolvedType::Enum(type_name.to_string()),
        _ if struct_names.contains(type_name) => ResolvedType::Struct(type_name.to_string()),
        _ => ResolvedType::Unknown(type_name.to_string()),
    }
}

fn validate_enum(
    value: &EnumDefinition,
    identifier: &Regex,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    if !matches!(
        value.underlying_type.as_str(),
        "byte" | "short" | "int" | "long"
    ) {
        bag.push(
            Diagnostic::error(
                "LMD0204",
                format!(
                    "unsupported enum underlying type `{}`",
                    value.underlying_type
                ),
            )
            .at(&source.source.path),
        );
    }
    if value.members.is_empty() {
        bag.push(
            Diagnostic::error("LMD0205", "enum must contain at least one member")
                .at(&source.source.path),
        );
    }

    let mut names = IndexSet::new();
    let mut values = IndexSet::new();
    let mut has_explicit_zero = false;
    for member in &value.members {
        if !identifier.is_match(member.name()) {
            bag.push(
                Diagnostic::error(
                    "LMD0206",
                    format!("invalid enum member `{}`", member.name()),
                )
                .at(&source.source.path),
            );
        }
        if !names.insert(member.name().to_string()) {
            bag.push(
                Diagnostic::error(
                    "LMD0207",
                    format!("duplicate enum member `{}`", member.name()),
                )
                .at(&source.source.path),
            );
        }
        if let EnumMember::WithValue { value, .. } = member {
            if *value == 0 {
                has_explicit_zero = true;
            }
            if !values.insert(*value) {
                bag.push(
                    Diagnostic::error("LMD0208", format!("duplicate enum value `{value}`"))
                        .at(&source.source.path),
                );
            }
        }
    }
    if value.flags && !has_explicit_zero && names.contains("None") {
        bag.push(
            Diagnostic::error(
                "LMD0209",
                "flags enum without explicit value 0 reserves member name `None`",
            )
            .at(&source.source.path),
        );
    }
}

fn validate_struct(
    value: &StructDefinition,
    identifier: &Regex,
    source: &SourceDefinition,
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
    bag: &mut DiagnosticBag,
) {
    validate_fields(
        &value.fields,
        identifier,
        source,
        enum_names,
        struct_names,
        bag,
    );
}

fn validate_table_structure(
    value: &TableDefinition,
    identifier: &Regex,
    tag_identifier: &Regex,
    source: &SourceDefinition,
    definitions: &[SourceDefinition],
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
    allowed_tags: &IndexSet<String>,
    bag: &mut DiagnosticBag,
) {
    validate_fields(
        &value.fields,
        identifier,
        source,
        enum_names,
        struct_names,
        bag,
    );
    let field_map = field_map(&value.fields);

    validate_key_fields(
        &value.keys.primary.fields,
        "primary",
        &field_map,
        enum_names,
        struct_names,
        source,
        bag,
    );
    for (index, key) in value.keys.secondary.iter().enumerate() {
        validate_key_fields(
            &key.fields,
            &format!("secondary[{index}]"),
            &field_map,
            enum_names,
            struct_names,
            source,
            bag,
        );
    }

    validate_rows_structure(
        value,
        &field_map,
        definitions,
        enum_names,
        struct_names,
        tag_identifier,
        allowed_tags,
        source,
        bag,
    );
    validate_ref_definitions(value, definitions, enum_names, struct_names, source, bag);
}

fn validate_filtered_table(
    table: &TableDefinition,
    source: &SourceDefinition,
    filtered_definitions: &[SourceDefinition],
    bag: &mut DiagnosticBag,
) {
    validate_key_uniqueness(table, source, bag);
    validate_ref_integrity(table, filtered_definitions, source, bag);
}

fn validate_fields(
    fields: &[FieldDefinition],
    identifier: &Regex,
    source: &SourceDefinition,
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
    bag: &mut DiagnosticBag,
) {
    let mut names = IndexSet::new();
    let mut message_pack_keys = IndexMap::<usize, String>::new();
    for (index, field) in fields.iter().enumerate() {
        if !identifier.is_match(&field.name) {
            bag.push(
                Diagnostic::error("LMD0209", format!("invalid field name `{}`", field.name))
                    .at(&source.source.path),
            );
        }
        if !names.insert(field.name.clone()) {
            bag.push(
                Diagnostic::error("LMD0210", format!("duplicate field `{}`", field.name))
                    .at(&source.source.path),
            );
        }
        let message_pack_key = field.fixed_index.unwrap_or(index);
        if let Some(previous) = message_pack_keys.insert(message_pack_key, field.name.clone()) {
            bag.push(
                Diagnostic::error(
                    "LMD0211",
                    format!(
                        "duplicate MessagePack Key `{}` used by fields `{}` and `{}`",
                        message_pack_key, previous, field.name
                    ),
                )
                .at(&source.source.path),
            );
        }
        if matches!(
            resolve_type(&field.type_name, enum_names, struct_names),
            ResolvedType::Unknown(_)
        ) {
            bag.push(
                Diagnostic::error(
                    "LMD0301",
                    format!("unknown field type `{}`", field.type_name),
                )
                .at(&source.source.path),
            );
        }
    }
}

fn validate_key_fields(
    key_fields: &[String],
    label: &str,
    field_map: &IndexMap<String, &FieldDefinition>,
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    if key_fields.is_empty() {
        bag.push(
            Diagnostic::error(
                "LMD0502",
                format!("{label} key must contain at least one field"),
            )
            .at(&source.source.path),
        );
    }
    let mut seen = IndexSet::new();
    for name in key_fields {
        if !seen.insert(name.clone()) {
            bag.push(
                Diagnostic::error(
                    "LMD0503",
                    format!("{label} key contains duplicate field `{name}`"),
                )
                .at(&source.source.path),
            );
        }
        let Some(field) = field_map.get(name) else {
            bag.push(
                Diagnostic::error(
                    "LMD0501",
                    format!("{label} key references unknown field `{name}`"),
                )
                .at(&source.source.path),
            );
            continue;
        };
        let resolved = resolve_type(&field.type_name, enum_names, struct_names);
        if !resolved.is_key_compatible() {
            bag.push(
                Diagnostic::error("LMD0504", format!("field `{name}` cannot be used as a key"))
                    .at(&source.source.path),
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_rows_structure(
    table: &TableDefinition,
    field_map: &IndexMap<String, &FieldDefinition>,
    definitions: &[SourceDefinition],
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
    tag_identifier: &Regex,
    allowed_tags: &IndexSet<String>,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    let enum_members = enum_member_map(definitions);
    let struct_fields = struct_field_map(definitions);

    for (row_index, row) in table.rows.iter().enumerate() {
        validate_row_tags(row, row_index, tag_identifier, allowed_tags, source, bag);

        let Some(data) = row.data_values() else {
            bag.push(
                Diagnostic::error("LMD0410", format!("row {row_index} is missing `data`"))
                    .at(&source.source.path),
            );
            continue;
        };

        for field in &table.fields {
            if !data.contains_key(&field.name) && !field.type_name.starts_with("list<") {
                bag.push(
                    Diagnostic::error(
                        "LMD0401",
                        format!("row {row_index} is missing field `{}`", field.name),
                    )
                    .at(&source.source.path),
                );
            }
        }
        for key in data.keys() {
            if !field_map.contains_key(key) {
                bag.push(
                    Diagnostic::error(
                        "LMD0403",
                        format!("row {row_index} has unknown field `{key}`"),
                    )
                    .at(&source.source.path),
                );
            }
        }
        for (name, raw) in data {
            if let Some(field) = field_map.get(name) {
                let resolved = resolve_type(&field.type_name, enum_names, struct_names);
                validate_value(
                    raw,
                    &resolved,
                    &enum_members,
                    &struct_fields,
                    source,
                    bag,
                    &format!("row {row_index} field {name}"),
                );
            }
        }
    }
}

fn validate_row_tags(
    row: &RowDefinition,
    row_index: usize,
    tag_identifier: &Regex,
    allowed_tags: &IndexSet<String>,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    let mut seen = IndexSet::new();
    for raw in &row.meta.tags {
        let Some(tag) = raw.as_str() else {
            bag.push(
                Diagnostic::error(
                    "LMD0601",
                    format!("row {row_index} meta.tags must contain only strings"),
                )
                .at(&source.source.path),
            );
            continue;
        };
        if !tag_identifier.is_match(tag) {
            bag.push(
                Diagnostic::error(
                    "LMD0603",
                    format!("row {row_index} has invalid tag `{tag}`"),
                )
                .at(&source.source.path),
            );
        }
        if tag == RESERVED_UNTAGGED_TAG {
            bag.push(
                Diagnostic::error(
                    "LMD0605",
                    format!("row {row_index} uses reserved tag `{tag}`"),
                )
                .at(&source.source.path),
            );
        }
        if !seen.insert(tag.to_string()) {
            bag.push(
                Diagnostic::error(
                    "LMD0604",
                    format!("row {row_index} has duplicate tag `{tag}`"),
                )
                .at(&source.source.path),
            );
        }
        if !allowed_tags.is_empty() && !allowed_tags.contains(tag) {
            bag.push(
                Diagnostic::error(
                    "LMD0602",
                    format!("row {row_index} uses undeclared tag `{tag}`"),
                )
                .at(&source.source.path),
            );
        }
    }
}

fn validate_key_uniqueness(
    table: &TableDefinition,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    let mut primary_keys = IndexSet::new();
    let mut unique_secondary_keys: Vec<IndexSet<String>> = table
        .keys
        .secondary
        .iter()
        .map(|_| IndexSet::new())
        .collect();

    for row in &table.rows {
        let Some(data) = row.data_values() else {
            continue;
        };
        let primary = key_tuple(data, &table.keys.primary.fields);
        if !primary_keys.insert(primary.clone()) {
            bag.push(
                Diagnostic::error("LMD0505", format!("duplicate primary key `{primary}`"))
                    .at(&source.source.path),
            );
        }
        for (key_index, key) in table.keys.secondary.iter().enumerate() {
            if key.unique {
                let tuple = key_tuple(data, &key.fields);
                if !unique_secondary_keys[key_index].insert(tuple.clone()) {
                    bag.push(
                        Diagnostic::error(
                            "LMD0506",
                            format!("duplicate unique secondary key `{tuple}`"),
                        )
                        .at(&source.source.path),
                    );
                }
            }
        }
    }
}

fn validate_ref_definitions(
    table: &TableDefinition,
    definitions: &[SourceDefinition],
    enum_names: &IndexSet<String>,
    struct_names: &IndexSet<String>,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    let table_by_type = table_by_type(definitions);
    let local_fields = field_map(&table.fields);
    let mut ref_names = IndexSet::new();
    let field_names: IndexSet<String> = table
        .fields
        .iter()
        .map(|field| field.name.clone())
        .collect();

    for reference in &table.refs {
        if !ref_names.insert(reference.name.clone()) || field_names.contains(&reference.name) {
            bag.push(
                Diagnostic::error(
                    "LMD0906",
                    format!(
                        "MasterRef name `{}` collides with another member",
                        reference.name
                    ),
                )
                .at(&source.source.path),
            );
        }
        let Some(target_table) = table_by_type.get(&reference.target) else {
            bag.push(
                Diagnostic::error(
                    "LMD0901",
                    format!("unknown MasterRef target `{}`", reference.target),
                )
                .at(&source.source.path),
            );
            continue;
        };

        let Some((target_fields, unique)) = select_target_key(reference, target_table) else {
            bag.push(
                Diagnostic::error(
                    "LMD0903",
                    "MasterRef target key does not match a primary or secondary key",
                )
                .at(&source.source.path),
            );
            continue;
        };

        if reference.fields.len() != target_fields.len() {
            bag.push(
                Diagnostic::error(
                    "LMD0904",
                    "MasterRef field mapping count does not match target key field count",
                )
                .at(&source.source.path),
            );
            continue;
        }

        let target_field_map = field_map(&target_table.fields);
        let mut list_count = 0;
        for (mapping, target_name) in reference.fields.iter().zip(target_fields.iter()) {
            if &mapping.target != target_name {
                bag.push(
                    Diagnostic::error(
                        "LMD0905",
                        "MasterRef mapping order must match target key order",
                    )
                    .at(&source.source.path),
                );
            }
            let Some(local) = local_fields.get(&mapping.local) else {
                bag.push(
                    Diagnostic::error(
                        "LMD0902",
                        format!("unknown local MasterRef field `{}`", mapping.local),
                    )
                    .at(&source.source.path),
                );
                continue;
            };
            let Some(target) = target_field_map.get(&mapping.target) else {
                bag.push(
                    Diagnostic::error(
                        "LMD0902",
                        format!("unknown target MasterRef field `{}`", mapping.target),
                    )
                    .at(&source.source.path),
                );
                continue;
            };
            let local_type = resolve_type(&local.type_name, enum_names, struct_names);
            let target_type = resolve_type(&target.type_name, enum_names, struct_names);
            let comparable_type = local_type.list_element_type().unwrap_or(&local_type);
            if comparable_type != &target_type {
                bag.push(
                    Diagnostic::error(
                        "LMD0907",
                        "MasterRef local and target field types do not match",
                    )
                    .at(&source.source.path),
                );
            }
            if local_type.list_element_type().is_some() {
                list_count += 1;
            }
        }
        if list_count > 0 && !unique {
            bag.push(
                Diagnostic::error("LMD0908", "list-valued MasterRef must target a unique key")
                    .at(&source.source.path),
            );
        }
        if list_count > 1 {
            bag.push(
                Diagnostic::error(
                    "LMD0909",
                    "MasterRef supports at most one list-valued local field",
                )
                .at(&source.source.path),
            );
        }
    }
}

fn validate_ref_integrity(
    table: &TableDefinition,
    filtered_definitions: &[SourceDefinition],
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    let table_by_type = table_by_type(filtered_definitions);

    for reference in &table.refs {
        let Some(target_table) = table_by_type.get(&reference.target) else {
            continue;
        };
        let Some((target_fields, unique)) = select_target_key(reference, target_table) else {
            continue;
        };
        validate_ref_rows(
            table,
            reference,
            target_table,
            target_fields,
            unique,
            source,
            bag,
        );
    }
}

fn validate_ref_rows(
    source_table: &TableDefinition,
    reference: &MasterRefDefinition,
    target_table: &TableDefinition,
    target_fields: &[String],
    unique: bool,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
) {
    let target_keys: IndexSet<String> = target_table
        .rows
        .iter()
        .filter_map(|row| row.data_values())
        .map(|row| key_tuple(row, target_fields))
        .collect();

    for (row_index, row) in source_table.rows.iter().enumerate() {
        let Some(data) = row.data_values() else {
            continue;
        };
        let list_mapping = reference.fields.iter().find(|mapping| {
            data.get(&mapping.local)
                .and_then(|value| value.as_sequence())
                .is_some()
        });

        if let Some(list_mapping) = list_mapping {
            if !unique {
                continue;
            }
            let Some(sequence) = data
                .get(&list_mapping.local)
                .and_then(|value| value.as_sequence())
            else {
                continue;
            };
            for (item_index, item) in sequence.iter().enumerate() {
                let tuple = reference
                    .fields
                    .iter()
                    .map(|mapping| {
                        if mapping.local == list_mapping.local {
                            serde_json::to_string(item).unwrap_or_else(|_| "<invalid>".to_string())
                        } else {
                            data.get(&mapping.local)
                                .map(|value| {
                                    serde_json::to_string(value)
                                        .unwrap_or_else(|_| "<invalid>".to_string())
                                })
                                .unwrap_or_else(|| "<missing>".to_string())
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("|");
                if !target_keys.contains(&tuple) {
                    bag.push(
                        Diagnostic::error(
                            "LMD0904",
                            format!("row {row_index} MasterRef `{}` list item {item_index} does not resolve target row", reference.name),
                        )
                        .at(&source.source.path),
                    );
                }
            }
        } else {
            let tuple = reference
                .fields
                .iter()
                .map(|mapping| {
                    data.get(&mapping.local)
                        .map(|value| {
                            serde_json::to_string(value).unwrap_or_else(|_| "<invalid>".to_string())
                        })
                        .unwrap_or_else(|| "<missing>".to_string())
                })
                .collect::<Vec<_>>()
                .join("|");

            let exists = target_keys.contains(&tuple);
            if !exists {
                let requirement = if unique {
                    "exactly one"
                } else {
                    "at least one"
                };
                bag.push(
                    Diagnostic::error(
                        "LMD0904",
                        format!(
                            "row {row_index} MasterRef `{}` must resolve {requirement} target row",
                            reference.name
                        ),
                    )
                    .at(&source.source.path),
                );
            }
        }
    }
}

fn validate_value(
    raw: &Value,
    resolved: &ResolvedType,
    enum_members: &IndexMap<String, EnumValueInfo>,
    struct_fields: &IndexMap<String, Vec<FieldDefinition>>,
    source: &SourceDefinition,
    bag: &mut DiagnosticBag,
    label: &str,
) {
    match resolved {
        ResolvedType::Scalar(name) => {
            let ok = match name.as_str() {
                "bool" => raw.as_bool().is_some(),
                "int" => raw
                    .as_i64()
                    .map(|value| value >= i32::MIN as i64 && value <= i32::MAX as i64)
                    .unwrap_or(false),
                "long" => raw.as_i64().is_some(),
                "float" | "double" => raw.as_f64().is_some() || raw.as_i64().is_some(),
                "string" => raw.as_str().is_some(),
                _ => false,
            };
            if !ok {
                bag.push(
                    Diagnostic::error("LMD0402", format!("{label}: value does not match `{name}`"))
                        .at(&source.source.path),
                );
            }
        }
        ResolvedType::Enum(name) => {
            let Some(raw_name) = raw.as_str() else {
                bag.push(
                    Diagnostic::error("LMD0404", format!("{label}: enum value must be a string"))
                        .at(&source.source.path),
                );
                return;
            };
            let is_known = enum_members
                .get(name)
                .map(|info| enum_value_is_known(raw_name, info))
                .unwrap_or(false);
            if !is_known {
                bag.push(
                    Diagnostic::error(
                        "LMD0405",
                        format!("{label}: unknown enum member `{raw_name}`"),
                    )
                    .at(&source.source.path),
                );
            }
        }
        ResolvedType::Struct(name) => {
            let Some(map) = raw.as_mapping() else {
                bag.push(
                    Diagnostic::error(
                        "LMD0406",
                        format!("{label}: struct value must be a mapping"),
                    )
                    .at(&source.source.path),
                );
                return;
            };
            if let Some(fields) = struct_fields.get(name) {
                for field in fields {
                    let key = Value::String(field.name.clone());
                    if !map.contains_key(&key) && !field.type_name.starts_with("list<") {
                        bag.push(
                            Diagnostic::error(
                                "LMD0407",
                                format!("{label}: missing struct field `{}`", field.name),
                            )
                            .at(&source.source.path),
                        );
                    }
                }
            }
        }
        ResolvedType::List(inner) => {
            let Some(sequence) = raw.as_sequence() else {
                bag.push(
                    Diagnostic::error("LMD0408", format!("{label}: list value must be a sequence"))
                        .at(&source.source.path),
                );
                return;
            };
            for (index, item) in sequence.iter().enumerate() {
                validate_value(
                    item,
                    inner,
                    enum_members,
                    struct_fields,
                    source,
                    bag,
                    &format!("{label}[{index}]"),
                );
            }
        }
        ResolvedType::Unknown(name) => {
            bag.push(
                Diagnostic::error("LMD0301", format!("{label}: unknown type `{name}`"))
                    .at(&source.source.path),
            );
        }
    }
}

fn filter_definitions(
    definitions: &[SourceDefinition],
    profile: Option<&BuildProfile>,
) -> Vec<SourceDefinition> {
    definitions
        .iter()
        .cloned()
        .map(|mut item| {
            if let Definition::Table(table) = &mut item.definition {
                table.rows.retain(|row| should_include_row(row, profile));
            }
            item
        })
        .collect()
}

fn should_include_row(row: &RowDefinition, profile: Option<&BuildProfile>) -> bool {
    let Some(profile) = profile else {
        return true;
    };
    let tags = row.tag_names();
    let is_untagged = tags.is_empty();
    if profile
        .exclude_tags
        .iter()
        .any(|excluded| excluded == RESERVED_UNTAGGED_TAG)
        && is_untagged
    {
        return false;
    }
    if tags
        .iter()
        .any(|tag| profile.exclude_tags.iter().any(|excluded| excluded == tag))
    {
        return false;
    }
    if profile.include_tags.is_empty() {
        return true;
    }
    if profile
        .include_tags
        .iter()
        .any(|included| included == RESERVED_UNTAGGED_TAG)
        && is_untagged
    {
        return true;
    }
    tags.iter()
        .any(|tag| profile.include_tags.iter().any(|included| included == tag))
}

fn field_map(fields: &[FieldDefinition]) -> IndexMap<String, &FieldDefinition> {
    fields
        .iter()
        .map(|field| (field.name.clone(), field))
        .collect()
}

fn enum_member_map(definitions: &[SourceDefinition]) -> IndexMap<String, EnumValueInfo> {
    definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Enum(value) => {
                let has_explicit_zero = enum_has_explicit_zero(value);
                let mut members: IndexSet<String> = value
                    .members
                    .iter()
                    .map(|member| member.name().to_string())
                    .collect();
                if value.flags && !has_explicit_zero {
                    members.insert("None".to_string());
                }
                Some((
                    value.name.clone(),
                    EnumValueInfo {
                        members,
                        flags: value.flags,
                        has_zero_default: has_explicit_zero || value.flags,
                    },
                ))
            }
            _ => None,
        })
        .collect()
}

fn enum_value_is_known(raw_name: &str, info: &EnumValueInfo) -> bool {
    if raw_name.is_empty() {
        return info.has_zero_default;
    }
    if info.members.contains(raw_name) {
        return true;
    }
    if !info.flags {
        return false;
    }
    let parts: Vec<&str> = raw_name
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    !parts.is_empty() && parts.iter().all(|part| info.members.contains(*part))
}

fn enum_has_explicit_zero(value: &EnumDefinition) -> bool {
    value
        .members
        .iter()
        .any(|member| matches!(member, EnumMember::WithValue { value: 0, .. }))
}

fn struct_field_map(definitions: &[SourceDefinition]) -> IndexMap<String, Vec<FieldDefinition>> {
    definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Struct(value) => Some((value.name.clone(), value.fields.clone())),
            _ => None,
        })
        .collect()
}

fn table_by_type(definitions: &[SourceDefinition]) -> IndexMap<String, &TableDefinition> {
    definitions
        .iter()
        .filter_map(|item| match &item.definition {
            Definition::Table(table) => Some((table.type_name.clone(), table)),
            _ => None,
        })
        .collect()
}

fn key_tuple(row: &IndexMap<String, Value>, fields: &[String]) -> String {
    fields
        .iter()
        .map(|field| {
            row.get(field)
                .map(|value| {
                    serde_json::to_string(value).unwrap_or_else(|_| "<invalid>".to_string())
                })
                .unwrap_or_else(|| "<missing>".to_string())
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn select_target_key<'a>(
    reference: &MasterRefDefinition,
    target: &'a TableDefinition,
) -> Option<(&'a [String], bool)> {
    if reference.target_key.primary {
        return Some((&target.keys.primary.fields, true));
    }
    if reference.target_key.fields == target.keys.primary.fields {
        return Some((&target.keys.primary.fields, true));
    }
    for secondary in &target.keys.secondary {
        if secondary.fields == reference.target_key.fields {
            return Some((&secondary.fields, secondary.unique));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SourceFile;
    use std::path::PathBuf;

    fn parse(text: &str) -> Vec<SourceDefinition> {
        vec![SourceDefinition::parse(SourceFile {
            path: PathBuf::from("test.yaml"),
            relative_path: PathBuf::from("test.yaml"),
            text: text.to_string(),
        })
        .unwrap()]
    }

    fn parse_all(texts: &[&str]) -> Vec<SourceDefinition> {
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                SourceDefinition::parse(SourceFile {
                    path: PathBuf::from(format!("test{index}.yaml")),
                    relative_path: PathBuf::from(format!("test{index}.yaml")),
                    text: text.to_string(),
                })
                .unwrap()
            })
            .collect()
    }

    fn profile(
        include_tags: &[&str],
        exclude_tags: &[&str],
        include_untagged: bool,
    ) -> BuildProfile {
        BuildProfile {
            include_tags: include_tags.iter().map(|value| value.to_string()).collect(),
            exclude_tags: exclude_tags.iter().map(|value| value.to_string()).collect(),
            include_untagged,
        }
    }

    #[test]
    fn row_data_is_required() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - Id: 1
"#,
            ),
            None,
            &[],
        );

        assert!(result.is_err());
    }

    #[test]
    fn undeclared_tags_are_rejected() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
    meta:
      tags: [debug]
"#,
            ),
            None,
            &["prod".to_string()],
        );

        assert!(result.is_err());
    }

    #[test]
    fn profile_filters_build_definitions() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
  - data:
      Id: 2
    meta:
      tags: [dev]
"#,
            ),
            Some(&profile(&[], &["dev"], true)),
            &[],
        )
        .unwrap();

        let Definition::Table(table) = &result.build_definitions[0].definition else {
            panic!("expected table");
        };
        assert_eq!(table.rows.len(), 1);
    }

    #[test]
    fn meta_tags_must_be_strings() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
    meta:
      tags: [1]
"#,
            ),
            None,
            &[],
        );

        assert!(result.is_err());
    }

    #[test]
    fn duplicate_fixed_indexes_are_rejected() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
    fixedIndex: 0
  - name: Name
    type: string
    fixedIndex: 0
rows:
  - data:
      Id: 1
      Name: Sword
"#,
            ),
            None,
            &[],
        );

        assert!(result.is_err());
    }

    #[test]
    fn flags_enum_accepts_composite_values() {
        let result = validate(
            parse_all(&[
                r#"kind: enum
name: Permission
flags: true
members:
  - { name: None, value: 0 }
  - { name: Read, value: 1 }
  - { name: Write, value: 2 }
"#,
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
  - name: Permission
    type: Permission
rows:
  - data:
      Id: 1
      Permission: "Read, Write"
"#,
            ]),
            None,
            &[],
        );

        assert!(result.is_ok());
    }

    #[test]
    fn flags_enum_without_zero_accepts_auto_none_and_empty_default() {
        let result = validate(
            parse_all(&[
                r#"kind: enum
name: Permission
flags: true
members:
  - { name: Read, value: 1 }
  - { name: Write, value: 2 }
"#,
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
  - name: Permission
    type: Permission
rows:
  - data:
      Id: 1
      Permission: ""
  - data:
      Id: 2
      Permission: None
"#,
            ]),
            None,
            &[],
        );

        assert!(result.is_ok());
    }

    #[test]
    fn non_flags_enum_rejects_composite_values() {
        let result = validate(
            parse_all(&[
                r#"kind: enum
name: Permission
members:
  - { name: None, value: 0 }
  - { name: Read, value: 1 }
  - { name: Write, value: 2 }
"#,
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
  - name: Permission
    type: Permission
rows:
  - data:
      Id: 1
      Permission: "Read, Write"
"#,
            ]),
            None,
            &[],
        );

        assert!(result.is_err());
    }

    #[test]
    fn include_tags_empty_includes_untagged_rows() {
        let definitions = parse(
            r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
  - data:
      Id: 2
    meta:
      tags: [dev]
"#,
        );

        let result = validate(definitions, Some(&profile(&[], &[], false)), &[]).unwrap();
        let Definition::Table(table) = &result.build_definitions[0].definition else {
            panic!("expected table");
        };
        assert_eq!(table.rows.len(), 2);
    }

    #[test]
    fn include_tags_do_not_include_untagged_rows_by_default() {
        let definitions = parse(
            r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
  - data:
      Id: 2
    meta:
      tags: [dev]
"#,
        );

        let result = validate(definitions, Some(&profile(&["dev"], &[], true)), &[]).unwrap();
        let Definition::Table(table) = &result.build_definitions[0].definition else {
            panic!("expected table");
        };
        assert_eq!(table.rows.len(), 1);
        assert_eq!(
            table.rows[0]
                .data_values()
                .and_then(|data| data.get("Id"))
                .and_then(|value| value.as_i64()),
            Some(2)
        );
    }

    #[test]
    fn untagged_pseudo_tag_includes_untagged_rows() {
        let definitions = parse(
            r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
  - data:
      Id: 2
    meta:
      tags: [dev]
"#,
        );

        let result = validate(definitions, Some(&profile(&["untagged"], &[], false)), &[]).unwrap();
        let Definition::Table(table) = &result.build_definitions[0].definition else {
            panic!("expected table");
        };
        assert_eq!(table.rows.len(), 1);
        assert_eq!(
            table.rows[0]
                .data_values()
                .and_then(|data| data.get("Id"))
                .and_then(|value| value.as_i64()),
            Some(1)
        );
    }

    #[test]
    fn untagged_pseudo_tag_excludes_untagged_rows() {
        let definitions = parse(
            r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
  - data:
      Id: 2
    meta:
      tags: [dev]
"#,
        );

        let result = validate(definitions, Some(&profile(&[], &["untagged"], true)), &[]).unwrap();
        let Definition::Table(table) = &result.build_definitions[0].definition else {
            panic!("expected table");
        };
        assert_eq!(table.rows.len(), 1);
        assert_eq!(
            table.rows[0]
                .data_values()
                .and_then(|data| data.get("Id"))
                .and_then(|value| value.as_i64()),
            Some(2)
        );
    }

    #[test]
    fn untagged_is_reserved_as_row_tag() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
    meta:
      tags: [untagged]
"#,
            ),
            None,
            &[],
        );

        assert!(result.is_err());
    }

    #[test]
    fn untagged_is_reserved_as_allowed_tag() {
        let result = validate(
            parse(
                r#"kind: table
table: items
typeName: ItemMaster
keys:
  primary:
    fields: [Id]
fields:
  - name: Id
    type: int
rows:
  - data:
      Id: 1
"#,
            ),
            None,
            &["untagged".to_string()],
        );

        assert!(result.is_err());
    }
}
