use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

const RUNTIME_ASSET_MANIFEST_PATH: &str = "src/openforge-cli/runtime-assets.json";
const GENERATED_RUNTIME_ASSETS_FILE: &str = "openforge_cli_runtime_assets.rs";

fn runtime_file_names(manifest: &Value) -> Result<Vec<&str>, Box<dyn Error>> {
    let runtime_files = manifest
        .get("runtimeFiles")
        .and_then(Value::as_array)
        .ok_or("OpenForge CLI runtime asset manifest must contain a runtimeFiles array")?;
    if runtime_files.is_empty() {
        return Err(
            "OpenForge CLI runtime asset manifest must declare at least one runtime file".into(),
        );
    }

    let mut seen = HashSet::new();
    let mut filenames = Vec::with_capacity(runtime_files.len());
    for value in runtime_files {
        let filename = value
            .as_str()
            .filter(|filename| {
                !filename.is_empty()
                    && !filename.contains('/')
                    && !filename.contains('\\')
                    && Path::new(filename).file_name().is_some()
            })
            .ok_or("OpenForge CLI runtime asset manifest contains an invalid filename")?;
        if !seen.insert(filename) {
            return Err(format!(
                "OpenForge CLI runtime asset manifest contains duplicate filename {filename}"
            )
            .into());
        }
        filenames.push(filename);
    }

    Ok(filenames)
}

fn main() -> Result<(), Box<dyn Error>> {
    let crate_root = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let manifest_path = crate_root.join(RUNTIME_ASSET_MANIFEST_PATH);
    println!("cargo:rerun-if-changed={}", manifest_path.display());

    let manifest: Value = serde_json::from_str(&fs::read_to_string(&manifest_path)?)?;
    let filenames = runtime_file_names(&manifest)?;
    let cli_source_dir = manifest_path
        .parent()
        .ok_or("OpenForge CLI runtime asset manifest must have a parent directory")?;

    let mut generated = String::from("const OPENFORGE_CLI_RUNTIME_FILES: &[(&str, &str)] = &[\n");
    for filename in filenames {
        let asset_path = cli_source_dir.join(filename);
        if !asset_path.is_file() {
            return Err(format!(
                "OpenForge CLI runtime asset {filename} not found at {}",
                asset_path.display()
            )
            .into());
        }
        println!("cargo:rerun-if-changed={}", asset_path.display());
        generated.push_str(&format!(
            "    ({filename:?}, include_str!({:?})),\n",
            asset_path.to_string_lossy()
        ));
    }
    generated.push_str("];\n");

    let output_path = PathBuf::from(env::var("OUT_DIR")?).join(GENERATED_RUNTIME_ASSETS_FILE);
    fs::write(output_path, generated)?;
    Ok(())
}
