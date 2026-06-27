use crate::model::SourceFile;
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub fn scan_yaml_files(project_root: &Path, master_input: &Path) -> Result<Vec<SourceFile>> {
    let master_root = project_root.join(master_input);
    let mut files = Vec::new();

    for entry in WalkDir::new(&master_root).into_iter() {
        let entry = entry.with_context(|| format!("failed to scan {}", master_root.display()))?;
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if extension != "yaml" && extension != "yml" {
            continue;
        }

        let text = fs::read_to_string(path)
            .with_context(|| format!("failed to read YAML file: {}", path.display()))?;
        let relative_path = path
            .strip_prefix(&master_root)
            .unwrap_or(path)
            .to_path_buf();

        files.push(SourceFile {
            path: path.to_path_buf(),
            relative_path,
            text,
        });
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}
