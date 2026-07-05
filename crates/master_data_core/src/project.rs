use crate::build_input::create_build_input;
use crate::codegen::{generate_csharp_files, write_generated_files};
use crate::config::{
    BuildProfile, CSharpConfig, MasterDataConfig, MasterInputConfig, MemoryConfig, SyncConfig,
    TagsConfig, ToolConfig, CONFIG_FILE_NAME, TOOL_VERSION,
};
use crate::diagnostics::DiagnosticBag;
use crate::model::SourceDefinition;
use crate::scan::scan_yaml_files;
use crate::validate::{validate, ValidatedProject};
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const BUILDER_CSPROJ: &str = include_str!("../assets/builder/MasterData.GeneratedBuilder.csproj");
const BUILDER_PROGRAM: &str = include_str!("../assets/builder/Program.cs");
const BUILDER_INPUT: &str = include_str!("../assets/builder/Builder/BuildInput.cs");
const BUILDER_BINARY_BUILDER: &str =
    include_str!("../assets/builder/Builder/MasterMemoryBinaryBuilder.cs");

#[derive(Debug, Clone)]
pub struct LoadedProject {
    pub root: PathBuf,
    pub config: MasterDataConfig,
    pub definitions: Vec<SourceDefinition>,
}

impl LoadedProject {
    pub fn load(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let config = MasterDataConfig::load(&root)?;
        config.ensure_tool_version(TOOL_VERSION)?;
        let sources = scan_yaml_files(&root, &config.master.input)?;
        let definitions = sources
            .into_iter()
            .map(SourceDefinition::parse)
            .collect::<Result<Vec<_>>>()?;

        Ok(Self {
            root,
            config,
            definitions,
        })
    }

    pub fn validate(
        self,
        profile_name: Option<&str>,
    ) -> Result<Result<ValidatedProject, DiagnosticBag>> {
        let profile = self.config.build_profile(profile_name)?;
        Ok(validate(
            self.definitions,
            profile,
            &self.config.tags.allowed,
        ))
    }
}

#[derive(Debug, Clone)]
pub struct InitProjectOptions {
    pub config: MasterDataConfig,
    pub force: bool,
    pub create_converter_dir: bool,
}

impl InitProjectOptions {
    pub fn default_for_version(version: impl Into<String>) -> Self {
        Self {
            config: default_project_config(version),
            force: false,
            create_converter_dir: true,
        }
    }
}

pub fn validate_project(
    root: impl AsRef<Path>,
    profile_name: Option<&str>,
) -> Result<Result<ValidatedProject, DiagnosticBag>> {
    let project = LoadedProject::load(root)?;
    project.validate(profile_name)
}

pub fn init_project(root: impl AsRef<Path>, options: &InitProjectOptions) -> Result<()> {
    let root = root.as_ref();
    fs::create_dir_all(root)
        .with_context(|| format!("failed to create project directory: {}", root.display()))?;

    let config_path = root.join(CONFIG_FILE_NAME);
    if config_path.exists() && !options.force {
        anyhow::bail!(
            "{} already exists. Use --force to overwrite it.",
            config_path.display()
        );
    }

    if !config_path.exists() || options.force {
        fs::write(&config_path, options.config.to_yaml_string()?).with_context(|| {
            format!(
                "failed to write project settings: {}",
                config_path.display()
            )
        })?;
    }

    let master_dir = root.join(&options.config.master.input);
    fs::create_dir_all(&master_dir).with_context(|| {
        format!(
            "failed to create master directory: {}",
            master_dir.display()
        )
    })?;

    if options.create_converter_dir {
        let converter_dir = root.join("Converter");
        fs::create_dir_all(&converter_dir).with_context(|| {
            format!(
                "failed to create converter directory: {}",
                converter_dir.display()
            )
        })?;
    }

    Ok(())
}

pub fn generate_project(root: impl AsRef<Path>) -> Result<Result<(), DiagnosticBag>> {
    let project = LoadedProject::load(root.as_ref())?;
    let root = project.root.clone();
    let config = project.config.clone();
    let validated = match project.validate(None)? {
        Ok(value) => value,
        Err(diagnostics) => return Ok(Err(diagnostics)),
    };

    let files = generate_csharp_files(&root, &config, &validated)?;
    write_generated_files(&root, &files)?;
    Ok(Ok(()))
}

pub fn build_project(
    root: impl AsRef<Path>,
    profile_name: Option<&str>,
) -> Result<Result<(), DiagnosticBag>> {
    let project = LoadedProject::load(root.as_ref())?;
    let root = project.root.clone();
    let config = project.config.clone();
    let validated = match project.validate(profile_name)? {
        Ok(value) => value,
        Err(diagnostics) => return Ok(Err(diagnostics)),
    };

    let files = generate_csharp_files(&root, &config, &validated)?;
    write_generated_files(&root, &files)?;
    write_build_input(&root, &config, &validated)?;
    expand_builder_project(&root, &config, &files)?;
    run_dotnet_builder(&root)?;

    Ok(Ok(()))
}

pub fn clean_project(root: impl AsRef<Path>) -> Result<()> {
    let root = root.as_ref();
    let config = MasterDataConfig::load(root)?;
    config.ensure_tool_version(TOOL_VERSION)?;
    remove_dir_if_exists(root.join(&config.csharp.output))?;
    remove_dir_if_exists(root.join(&config.memory.output))?;
    remove_dir_if_exists(root.join(".master-data/temp"))?;
    Ok(())
}

pub fn sync_project(root: impl AsRef<Path>, init: bool) -> Result<()> {
    let root = root.as_ref();
    let config = MasterDataConfig::load(root)?;
    config.ensure_tool_version(TOOL_VERSION)?;
    let Some(sync) = &config.sync else {
        anyhow::bail!("sync is not configured");
    };

    if let Some(destination) = &sync.cs {
        sync_directory(
            root.join(&config.csharp.output),
            root.join(destination),
            init,
        )?;
    }
    if let Some(destination) = &sync.memory {
        sync_directory(
            root.join(&config.memory.output),
            root.join(destination),
            init,
        )?;
    }

    Ok(())
}

fn write_build_input(
    root: &Path,
    config: &MasterDataConfig,
    validated: &ValidatedProject,
) -> Result<()> {
    let input = create_build_input(root, config, validated);
    let path = root.join(".master-data/temp/build-input.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory: {}", parent.display()))?;
    }
    fs::write(&path, serde_json::to_string_pretty(&input)?)
        .with_context(|| format!("failed to write {}", path.display()))
}

fn expand_builder_project(
    root: &Path,
    config: &MasterDataConfig,
    files: &[crate::codegen::GeneratedFile],
) -> Result<()> {
    let builder_root = root.join(".master-data/temp/builder");
    let builder_dir = builder_root.join("Builder");
    let generated_dir = builder_root.join("Generated");

    fs::create_dir_all(&builder_dir)?;
    fs::create_dir_all(&generated_dir)?;
    fs::write(
        builder_root.join("MasterData.GeneratedBuilder.csproj"),
        BUILDER_CSPROJ,
    )?;
    fs::write(builder_root.join("Program.cs"), BUILDER_PROGRAM)?;
    fs::write(builder_dir.join("BuildInput.cs"), BUILDER_INPUT)?;
    fs::write(
        builder_dir.join("MasterMemoryBinaryBuilder.cs"),
        BUILDER_BINARY_BUILDER,
    )?;

    for file in files {
        let source_path = root.join(&file.path);
        let file_name = source_path
            .file_name()
            .with_context(|| format!("invalid generated source path: {}", source_path.display()))?;
        fs::copy(&source_path, generated_dir.join(file_name)).with_context(|| {
            format!("failed to copy generated source {}", source_path.display())
        })?;
    }

    let memory_output = root.join(&config.memory.output);
    fs::create_dir_all(&memory_output).with_context(|| {
        format!(
            "failed to create memory output directory: {}",
            memory_output.display()
        )
    })?;
    Ok(())
}

fn run_dotnet_builder(root: &Path) -> Result<()> {
    let builder_root = root.join(".master-data/temp/builder");
    let status = Command::new("dotnet")
        .arg("run")
        .arg("--project")
        .arg("MasterData.GeneratedBuilder.csproj")
        .arg("--")
        .arg("../build-input.json")
        .current_dir(&builder_root)
        .status()
        .with_context(|| "failed to execute dotnet")?;

    if !status.success() {
        anyhow::bail!("temporary C# builder failed with status {status}");
    }

    Ok(())
}

fn remove_dir_if_exists(path: PathBuf) -> Result<()> {
    if path.exists() {
        fs::remove_dir_all(&path)
            .with_context(|| format!("failed to remove directory: {}", path.display()))?;
    }
    Ok(())
}

fn sync_directory(source: PathBuf, destination: PathBuf, init: bool) -> Result<()> {
    if !source.exists() {
        anyhow::bail!("sync source does not exist: {}", source.display());
    }

    let marker = destination.join(".master-data-generated");
    if destination.exists() && !marker.exists() {
        if !init {
            anyhow::bail!(
                "sync destination is not marked as generated: {}",
                destination.display()
            );
        }
    }

    fs::create_dir_all(&destination)?;
    fs::write(
        &marker,
        "This directory is managed by MasterData.\nDo not place hand-written files here.\n",
    )?;

    for entry in fs::read_dir(&destination)? {
        let entry = entry?;
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if name == ".master-data-generated" || name.ends_with(".meta") {
            continue;
        }
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }

    copy_directory_contents(&source, &destination)
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            fs::create_dir_all(&destination_path)?;
            copy_directory_contents(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .with_context(|| format!("failed to copy {}", source_path.display()))?;
        }
    }

    Ok(())
}

pub fn default_project_config(version: impl Into<String>) -> MasterDataConfig {
    let mut build_profiles = indexmap::IndexMap::new();
    build_profiles.insert(
        "dev".to_string(),
        BuildProfile {
            include_tags: vec!["dev".to_string()],
            exclude_tags: Vec::new(),
            include_untagged: true,
        },
    );
    build_profiles.insert(
        "production".to_string(),
        BuildProfile {
            include_tags: Vec::new(),
            exclude_tags: vec!["dev".to_string(), "test".to_string()],
            include_untagged: true,
        },
    );

    MasterDataConfig {
        tool: ToolConfig {
            version: version.into(),
        },
        csharp: CSharpConfig {
            namespace: "Game.MasterData".to_string(),
            output: PathBuf::from("dist/cs"),
            templates: Default::default(),
            static_database_accessor: Default::default(),
        },
        master: MasterInputConfig {
            input: PathBuf::from("master"),
        },
        memory: MemoryConfig {
            output: PathBuf::from("dist/master-memory"),
            file_name: "master-data.bytes".to_string(),
        },
        tags: TagsConfig {
            allowed: vec!["dev".to_string(), "test".to_string(), "prod".to_string()],
        },
        build_profiles,
        sync: Some(SyncConfig {
            cs: Some(PathBuf::from("../client/Assets/MasterData/Generated")),
            memory: Some(PathBuf::from("../client/Assets/MasterData/Resources")),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("master-data-{name}-{nonce}"))
    }

    #[test]
    fn init_project_writes_config_master_and_converter_dir() {
        let root = temp_root("init");
        let options = InitProjectOptions::default_for_version(TOOL_VERSION);

        init_project(&root, &options).unwrap();

        let config_text = fs::read_to_string(root.join(CONFIG_FILE_NAME)).unwrap();
        assert!(config_text.contains("tool:"));
        assert!(config_text.contains(&format!("version: {TOOL_VERSION}")));
        assert!(root.join("master").is_dir());
        assert!(root.join("Converter").is_dir());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn config_rejects_mismatched_tool_version() {
        let config = default_project_config("9.9.9");
        let result = config.ensure_tool_version(TOOL_VERSION);
        assert!(result.is_err());
    }

    #[test]
    fn config_accepts_matching_tool_version() {
        let config = default_project_config(TOOL_VERSION);
        config.ensure_tool_version(TOOL_VERSION).unwrap();
    }

    #[test]
    fn sync_preserves_meta_files_and_replaces_generated_contents() {
        let root = temp_root("sync");
        let mut config = default_project_config(TOOL_VERSION);
        config.csharp.output = PathBuf::from("dist/cs");
        config.sync = Some(SyncConfig {
            cs: Some(PathBuf::from("synced/cs")),
            memory: None,
        });

        fs::create_dir_all(root.join("dist/cs")).unwrap();
        fs::write(root.join("dist/cs/New.cs"), "new").unwrap();
        fs::write(
            root.join(CONFIG_FILE_NAME),
            config.to_yaml_string().unwrap(),
        )
        .unwrap();

        let destination = root.join("synced/cs");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join(".master-data-generated"), "marker").unwrap();
        fs::write(destination.join("Old.cs"), "old").unwrap();
        fs::write(destination.join("Old.cs.meta"), "meta").unwrap();

        sync_project(&root, false).unwrap();

        assert!(destination.join("New.cs").exists());
        assert!(!destination.join("Old.cs").exists());
        assert!(destination.join("Old.cs.meta").exists());

        fs::remove_dir_all(root).unwrap();
    }
}
