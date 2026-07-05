use anyhow::{Context, Result};
use clap::Parser;
use master_data_core::{
    default_project_config, init_project, InitProjectOptions, MasterDataConfig, SyncConfig,
    CONFIG_FILE_NAME, TOOL_VERSION,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, IsTerminal, Read, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const DEFAULT_RELEASE_API_URL: &str =
    "https://api.github.com/repos/kamahir0/MasterData/releases/tags";
const GITHUB_API_VERSION: &str = "2026-03-10";

const CONVERTER_ASSETS: &[(&str, &str)] = &[
    ("windows-x64", "MasterDataConverter-windows-x64.exe"),
    ("osx-arm64", "MasterDataConverter-osx-arm64"),
    ("osx-x64", "MasterDataConverter-osx-x64"),
    ("linux-x64", "MasterDataConverter-linux-x64"),
];

#[derive(Debug, Parser)]
#[command(name = "MasterDataInit")]
#[command(about = "MasterData project initializer")]
struct Cli {
    #[arg(default_value = ".")]
    project: PathBuf,
    #[arg(long)]
    force: bool,
    #[arg(long)]
    no_download: bool,
    #[arg(long)]
    yes: bool,
    #[arg(long, default_value = DEFAULT_RELEASE_API_URL)]
    release_api_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    state: Option<String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let root = resolve_target(&cli.project)?;
    let config = prompt_config(cli.yes || !io::stdin().is_terminal())?;

    init_project(
        &root,
        &InitProjectOptions {
            config,
            force: cli.force,
            create_converter_dir: true,
        },
    )?;
    println!("initialized {}", root.display());

    if cli.no_download {
        println!("converter download skipped");
        return Ok(());
    }

    download_converters(&root, &cli.release_api_url, TOOL_VERSION)?;
    println!("converter download succeeded");
    Ok(())
}

fn resolve_target(project: &Path) -> Result<PathBuf> {
    let start = if project.is_absolute() {
        project.to_path_buf()
    } else {
        env::current_dir()
            .with_context(|| "failed to get current directory")?
            .join(project)
    };

    if start.exists() {
        start
            .canonicalize()
            .with_context(|| format!("failed to resolve project path: {}", start.display()))
    } else {
        Ok(start)
    }
}

fn prompt_config(use_defaults: bool) -> Result<MasterDataConfig> {
    let mut config = default_project_config(TOOL_VERSION);
    if use_defaults {
        return Ok(config);
    }

    println!("Project settings will be written to {}.", CONFIG_FILE_NAME);

    config.csharp.namespace = prompt_text("C# namespace", &config.csharp.namespace)?;
    config.master.input = PathBuf::from(prompt_text(
        "Master YAML directory",
        &config.master.input.to_string_lossy(),
    )?);
    config.csharp.output = PathBuf::from(prompt_text(
        "Generated C# output",
        &config.csharp.output.to_string_lossy(),
    )?);
    config.memory.output = PathBuf::from(prompt_text(
        "MasterMemory output",
        &config.memory.output.to_string_lossy(),
    )?);
    config.memory.file_name = prompt_text("MasterMemory file name", &config.memory.file_name)?;

    let sync_cs = prompt_bool("Sync generated C# into Unity project?", true)?;
    let sync_memory = prompt_bool("Sync MasterMemory binary into Unity project?", true)?;
    if sync_cs || sync_memory {
        config.sync = Some(SyncConfig {
            cs: if sync_cs {
                Some(PathBuf::from(prompt_text(
                    "Unity generated C# destination",
                    "../client/Assets/MasterData/Generated",
                )?))
            } else {
                None
            },
            memory: if sync_memory {
                Some(PathBuf::from(prompt_text(
                    "Unity binary destination",
                    "../client/Assets/MasterData/Resources",
                )?))
            } else {
                None
            },
        });
    } else {
        config.sync = None;
    }

    Ok(config)
}

fn prompt_text(label: &str, default: &str) -> Result<String> {
    print!("{label} [{default}]: ");
    io::stdout()
        .flush()
        .with_context(|| "failed to flush stdout")?;

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .with_context(|| format!("failed to read {label}"))?;
    let input = input.trim();
    if input.is_empty() {
        Ok(default.to_string())
    } else {
        Ok(input.to_string())
    }
}

fn prompt_bool(label: &str, default: bool) -> Result<bool> {
    let marker = if default { "Y/n" } else { "y/N" };
    loop {
        print!("{label} [{marker}]: ");
        io::stdout()
            .flush()
            .with_context(|| "failed to flush stdout")?;

        let mut answer = String::new();
        io::stdin()
            .read_line(&mut answer)
            .with_context(|| format!("failed to read {label}"))?;
        match answer.trim().to_ascii_lowercase().as_str() {
            "" => return Ok(default),
            "y" | "yes" => return Ok(true),
            "n" | "no" => return Ok(false),
            _ => eprintln!("Please answer y or n."),
        }
    }
}

fn download_converters(root: &Path, release_api_url: &str, version: &str) -> Result<()> {
    let expected_tag = release_tag(version);
    let release_text = download_json_text(&release_version_api_url(release_api_url, version)?)?;
    let release: GitHubRelease =
        serde_json::from_str(&release_text).with_context(|| "failed to parse release metadata")?;
    if release.tag_name != expected_tag {
        anyhow::bail!(
            "release tag {} does not match init version {}",
            release.tag_name,
            expected_tag
        );
    }

    let assets = release_asset_map(&release.assets)?;
    let converter_dir = root.join("Converter");
    fs::create_dir_all(&converter_dir).with_context(|| {
        format!(
            "failed to create converter directory: {}",
            converter_dir.display()
        )
    })?;

    for (_, file_name) in CONVERTER_ASSETS {
        let asset = assets
            .get(*file_name)
            .with_context(|| format!("release is missing converter asset `{file_name}`"))?;
        if let Some(state) = asset.state.as_deref() {
            if state != "uploaded" {
                anyhow::bail!("release asset {file_name} is in `{state}` state");
            }
        }
        let expected_sha = sha256_from_digest(asset.digest.as_deref())
            .with_context(|| format!("sha256 digest was not found for {file_name}"))?;
        let bytes = download_bytes(&asset.browser_download_url)?;
        verify_sha256(&bytes, expected_sha)
            .with_context(|| format!("checksum mismatch for {file_name}"))?;

        let destination = converter_dir.join(*file_name);
        fs::write(&destination, bytes)
            .with_context(|| format!("failed to write {}", destination.display()))?;
        make_executable(&destination)?;
    }

    Ok(())
}

fn release_tag(version: &str) -> String {
    if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{version}")
    }
}

fn release_version_api_url(base_url: &str, version: &str) -> Result<String> {
    let tag = release_tag(version);
    if tag.contains('/') || tag.contains('\\') {
        anyhow::bail!("invalid release tag: {tag}");
    }
    Ok(format!("{}/{}", base_url.trim_end_matches('/'), tag))
}

fn release_asset_map<'a>(
    assets: &'a [GitHubReleaseAsset],
) -> Result<BTreeMap<&'a str, &'a GitHubReleaseAsset>> {
    let mut map = BTreeMap::new();
    for asset in assets {
        if map.insert(asset.name.as_str(), asset).is_some() {
            anyhow::bail!("release has duplicate asset: {}", asset.name);
        }
    }
    Ok(map)
}

fn download_json_text(url: &str) -> Result<String> {
    let response = ureq::get(url)
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .set("User-Agent", "MasterDataInit")
        .call()
        .with_context(|| format!("failed to download {url}"))?;
    response
        .into_string()
        .with_context(|| format!("failed to read response body from {url}"))
}

fn download_bytes(url: &str) -> Result<Vec<u8>> {
    let response = ureq::get(url)
        .set("User-Agent", "MasterDataInit")
        .call()
        .with_context(|| format!("failed to download {url}"))?;
    let mut reader = response.into_reader();
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .with_context(|| format!("failed to read response body from {url}"))?;
    Ok(bytes)
}

fn sha256_from_digest(digest: Option<&str>) -> Option<&str> {
    digest?.strip_prefix("sha256:")
}

fn verify_sha256(bytes: &[u8], expected_hex: &str) -> Result<()> {
    let actual = Sha256::digest(bytes);
    let actual_hex = format!("{actual:x}");
    if !actual_hex.eq_ignore_ascii_case(expected_hex) {
        anyhow::bail!("expected {expected_hex}, actual {actual_hex}");
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<()> {
    let mut permissions = fs::metadata(path)
        .with_context(|| format!("failed to read metadata for {}", path.display()))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .with_context(|| format!("failed to set executable bit on {}", path.display()))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_sha256_from_digest() {
        assert_eq!(
            sha256_from_digest(Some(
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ))
            .unwrap(),
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert!(sha256_from_digest(Some("sha512:abc")).is_none());
        assert!(sha256_from_digest(None).is_none());
    }

    #[test]
    fn verifies_matching_sha256() {
        let bytes = b"master-data";
        let hash = format!("{:x}", Sha256::digest(bytes));
        verify_sha256(bytes, &hash).unwrap();
    }

    #[test]
    fn rejects_mismatched_sha256() {
        let result = verify_sha256(b"master-data", &"0".repeat(64));
        assert!(result.is_err());
    }

    #[test]
    fn builds_release_version_api_url() {
        assert_eq!(
            release_version_api_url("https://api.example.test/releases/tags", "0.1.0").unwrap(),
            "https://api.example.test/releases/tags/v0.1.0"
        );
        assert_eq!(
            release_version_api_url("https://api.example.test/releases/tags/", "v0.1.0").unwrap(),
            "https://api.example.test/releases/tags/v0.1.0"
        );
    }

    #[test]
    fn rejects_path_like_release_tags() {
        assert!(
            release_version_api_url("https://api.example.test/releases/tags", "v0.1.0/foo")
                .is_err()
        );
    }

    #[test]
    fn rejects_duplicate_release_assets() {
        let assets = vec![
            GitHubReleaseAsset {
                name: "MasterDataConverter-osx-arm64".to_string(),
                browser_download_url: "https://example.test/a".to_string(),
                digest: None,
                state: Some("uploaded".to_string()),
            },
            GitHubReleaseAsset {
                name: "MasterDataConverter-osx-arm64".to_string(),
                browser_download_url: "https://example.test/b".to_string(),
                digest: None,
                state: Some("uploaded".to_string()),
            },
        ];

        assert!(release_asset_map(&assets).is_err());
    }
}
