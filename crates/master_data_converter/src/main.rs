use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use master_data_core::{
    build_project, clean_project, generate_project, sync_project, validate_project, DiagnosticBag,
    MasterDataConfig, CONFIG_FILE_NAME,
};
use std::env;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "MasterDataConverter")]
#[command(about = "MasterData command line tool")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Convert {
        #[arg(default_value = ".")]
        project: PathBuf,
        #[arg(long)]
        init: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    Validate {
        #[arg(default_value = ".")]
        project: PathBuf,
        #[arg(long)]
        profile: Option<String>,
    },
    Generate {
        #[arg(default_value = ".")]
        project: PathBuf,
    },
    Build {
        #[arg(default_value = ".")]
        project: PathBuf,
        #[arg(long)]
        profile: Option<String>,
    },
    Sync {
        #[arg(long)]
        init: bool,
        #[arg(default_value = ".")]
        project: PathBuf,
    },
    Clean {
        #[arg(default_value = ".")]
        project: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Commands::Convert {
        project: PathBuf::from("."),
        init: false,
        profile: None,
    }) {
        Commands::Convert {
            project,
            init,
            profile,
        } => {
            let project = resolve_project_root(project)?;
            match build_project(&project, profile.as_deref())? {
                Ok(()) => println!("build succeeded"),
                Err(diagnostics) => exit_with_diagnostics(diagnostics),
            }

            let config = MasterDataConfig::load(&project)?;
            if config.sync.is_some() {
                sync_project(&project, init)?;
                println!("sync succeeded");
            }
        }
        Commands::Validate { project, profile } => {
            let project = resolve_project_root(project)?;
            match validate_project(project, profile.as_deref())? {
                Ok(_) => println!("validation succeeded"),
                Err(diagnostics) => exit_with_diagnostics(diagnostics),
            }
        }
        Commands::Generate { project } => {
            let project = resolve_project_root(project)?;
            match generate_project(project)? {
                Ok(()) => println!("generation succeeded"),
                Err(diagnostics) => exit_with_diagnostics(diagnostics),
            }
        }
        Commands::Build { project, profile } => {
            let project = resolve_project_root(project)?;
            match build_project(project, profile.as_deref())? {
                Ok(()) => println!("build succeeded"),
                Err(diagnostics) => exit_with_diagnostics(diagnostics),
            }
        }
        Commands::Sync { project, init } => {
            let project = resolve_project_root(project)?;
            sync_project(project, init)?;
            println!("sync succeeded");
        }
        Commands::Clean { project } => {
            let project = resolve_project_root(project)?;
            clean_project(project)?;
            println!("clean succeeded");
        }
    }
    Ok(())
}

fn resolve_project_root(project: PathBuf) -> Result<PathBuf> {
    let start = if project.is_absolute() {
        project
    } else {
        env::current_dir()
            .with_context(|| "failed to get current directory")?
            .join(project)
    };
    let mut current = start
        .canonicalize()
        .with_context(|| format!("failed to resolve project path: {}", start.display()))?;

    loop {
        if current.join(CONFIG_FILE_NAME).exists() {
            return Ok(current);
        }
        if !current.pop() {
            anyhow::bail!(
                "{} was not found in the project path or its ancestors",
                CONFIG_FILE_NAME
            );
        }
    }
}

fn exit_with_diagnostics(diagnostics: DiagnosticBag) {
    for diagnostic in diagnostics.items() {
        eprintln!("{diagnostic}");
    }
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn converter_help_does_not_expose_init_subcommand() {
        let mut command = Cli::command();
        let help = command.render_long_help().to_string();

        assert!(help.contains("convert"));
        assert!(help.contains("validate"));
        assert!(!help.contains("init"));
    }
}
