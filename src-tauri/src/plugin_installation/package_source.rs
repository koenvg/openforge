use std::{
    fs,
    path::{Path, PathBuf},
};
use tokio::process::Command;

pub(super) const NPM_PATH_ENV: &str = "OPENFORGE_NPM_PATH";
pub(super) const GIT_PATH_ENV: &str = "OPENFORGE_GIT_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PackageSourceSpec {
    Local {
        path: PathBuf,
        spec: String,
    },
    Npm {
        package_spec: String,
        spec: String,
    },
    Git {
        repo: String,
        reference: Option<String>,
        spec: String,
    },
}

impl PackageSourceSpec {
    pub(super) fn parse(raw_spec: &str) -> Result<Self, String> {
        let spec = raw_spec.trim();
        if spec.is_empty() {
            return Err("plugin package source spec cannot be empty".to_string());
        }

        if let Some(package_spec) = spec.strip_prefix("npm:") {
            let package_spec = package_spec.trim();
            if package_spec.is_empty() {
                return Err("npm plugin package source spec cannot be empty".to_string());
            }
            return Ok(Self::Npm {
                package_spec: package_spec.to_string(),
                spec: spec.to_string(),
            });
        }

        if let Some(git_spec) = spec.strip_prefix("git:") {
            let (repo, reference) = parse_git_source(git_spec)?;
            return Ok(Self::Git {
                repo,
                reference,
                spec: spec.to_string(),
            });
        }

        let path = if let Some(path) = spec.strip_prefix("local:") {
            PathBuf::from(path)
        } else {
            PathBuf::from(spec)
        };

        Ok(Self::Local {
            path,
            spec: spec.to_string(),
        })
    }

    pub(super) fn kind(&self) -> &'static str {
        match self {
            Self::Local { .. } => "local",
            Self::Npm { .. } => "npm",
            Self::Git { .. } => "git",
        }
    }

    pub(super) fn spec(&self) -> &str {
        match self {
            Self::Local { spec, .. } | Self::Npm { spec, .. } | Self::Git { spec, .. } => spec,
        }
    }
}

#[derive(Debug)]
pub(super) struct AcquiredPackage {
    pub(super) source: PackageSourceSpec,
    pub(super) package_dir: PathBuf,
    pub(super) install_path: PathBuf,
    pub(super) staging_root: Option<PathBuf>,
}

impl Drop for AcquiredPackage {
    fn drop(&mut self) {
        if let Some(staging_root) = self.staging_root.as_ref() {
            let _ = fs::remove_dir_all(staging_root);
        }
    }
}

pub(super) fn acquire_local_package(source: PackageSourceSpec) -> Result<AcquiredPackage, String> {
    let PackageSourceSpec::Local { path, .. } = &source else {
        return Err("expected a local plugin package source".to_string());
    };

    if !path.is_dir() {
        return Err(format!(
            "local plugin package source is not a directory: {}",
            path.display()
        ));
    }

    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "failed to resolve local plugin package source {}: {error}",
            path.display()
        )
    })?;

    Ok(AcquiredPackage {
        source,
        package_dir: canonical.clone(),
        install_path: canonical,
        staging_root: None,
    })
}

pub(super) async fn acquire_npm_package(
    source: PackageSourceSpec,
    managed_base_dir: &Path,
) -> Result<AcquiredPackage, String> {
    let PackageSourceSpec::Npm { package_spec, .. } = &source else {
        return Err("expected an npm plugin package source".to_string());
    };

    let npm_path = resolve_binary(NPM_PATH_ENV, "npm")?;
    let staging_root = unique_staging_dir(managed_base_dir, "npm")?;
    let install_root = staging_root.join("install-root");
    fs::create_dir_all(&install_root)
        .map_err(|error| format!("failed to create npm install root: {error}"))?;
    fs::write(
        install_root.join("package.json"),
        r#"{"name":"openforge-plugin-staging","version":"1.0.0","private":true}"#,
    )
    .map_err(|error| format!("failed to create npm staging package.json: {error}"))?;

    let output = Command::new(&npm_path)
        .arg("install")
        .arg("--prefix")
        .arg(&install_root)
        .arg("--ignore-scripts")
        .arg("--omit=dev")
        .arg("--no-save")
        .arg(package_spec)
        .output()
        .await
        .map_err(|error| format!("failed to run npm install: {error}"))?;

    if !output.status.success() {
        let details = command_output_details(&output.stdout, &output.stderr);
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!("npm install failed for {package_spec}: {details}"));
    }

    let package_dir = install_root
        .join("node_modules")
        .join(resolve_requested_package_dir_name(package_spec)?);

    Ok(AcquiredPackage {
        source,
        package_dir,
        install_path: PathBuf::new(),
        staging_root: Some(staging_root),
    })
}

pub(super) async fn acquire_git_package(
    source: PackageSourceSpec,
    managed_base_dir: &Path,
) -> Result<AcquiredPackage, String> {
    let PackageSourceSpec::Git {
        repo, reference, ..
    } = &source
    else {
        return Err("expected a git plugin package source".to_string());
    };

    let git_path = resolve_binary(GIT_PATH_ENV, "git")?;
    let staging_root = unique_staging_dir(managed_base_dir, "git")?;
    let checkout_dir = staging_root.join("checkout");
    let repo_url = normalize_git_repo_url(repo);

    let mut command = Command::new(&git_path);
    command.arg("clone").arg("--depth").arg("1");
    if let Some(reference) = reference {
        command.arg("--branch").arg(reference);
    }
    let output = command
        .arg(&repo_url)
        .arg(&checkout_dir)
        .output()
        .await
        .map_err(|error| format!("failed to run git clone: {error}"))?;

    if !output.status.success() {
        let details = command_output_details(&output.stdout, &output.stderr);
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!("git clone failed for {repo}: {details}"));
    }

    Ok(AcquiredPackage {
        source,
        package_dir: checkout_dir,
        install_path: PathBuf::new(),
        staging_root: Some(staging_root),
    })
}

fn resolve_binary(env_name: &str, binary_name: &str) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(env_name) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    which::which(binary_name)
        .map_err(|error| format!("failed to locate {binary_name} in PATH: {error}"))
}

fn unique_staging_dir(managed_base_dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    let nonce = crate::unix_timestamp::nanoseconds(std::time::SystemTime::now())
        .map_err(|error| format!("failed to create staging directory nonce: {error}"))?;
    let path = managed_base_dir
        .join(".staging")
        .join(format!("{prefix}-{nonce}"));
    fs::create_dir_all(&path).map_err(|error| {
        format!(
            "failed to create staging directory {}: {error}",
            path.display()
        )
    })?;
    Ok(path)
}

pub(super) fn resolve_requested_package_dir_name(package_spec: &str) -> Result<String, String> {
    let package_spec = package_spec.trim();
    if package_spec.is_empty() {
        return Err("npm package source spec cannot be empty".to_string());
    }

    if let Some((alias, _)) = package_spec.split_once("@npm:") {
        return if alias.is_empty() {
            Err(format!("invalid npm alias package spec: {package_spec}"))
        } else {
            Ok(alias.to_string())
        };
    }

    if let Some(stripped) = package_spec.strip_prefix('@') {
        let slash_index = stripped
            .find('/')
            .ok_or_else(|| format!("invalid scoped package spec: {package_spec}"))?;
        let after_scope = &stripped[slash_index + 1..];
        if let Some(version_sep) = after_scope.find('@') {
            return Ok(format!(
                "@{}/{}",
                &stripped[..slash_index],
                &after_scope[..version_sep]
            ));
        }

        return Ok(package_spec.to_string());
    }

    match package_spec.find('@') {
        Some(index) => Ok(package_spec[..index].to_string()),
        None => Ok(package_spec.to_string()),
    }
}

fn parse_git_source(git_spec: &str) -> Result<(String, Option<String>), String> {
    let git_spec = git_spec.trim();
    if git_spec.is_empty() {
        return Err("git plugin package source spec cannot be empty".to_string());
    }

    if git_spec.starts_with("git@") {
        return Ok((git_spec.to_string(), None));
    }

    match git_spec.rsplit_once('@') {
        Some((repo, reference)) if !repo.is_empty() && !reference.is_empty() => {
            Ok((repo.to_string(), Some(reference.to_string())))
        }
        Some(_) => Err(format!(
            "invalid git plugin package source spec: git:{git_spec}"
        )),
        None => Ok((git_spec.to_string(), None)),
    }
}

fn normalize_git_repo_url(repo: &str) -> String {
    if repo.starts_with("http://")
        || repo.starts_with("https://")
        || repo.starts_with("ssh://")
        || repo.starts_with("git@")
        || repo.starts_with("file://")
    {
        repo.to_string()
    } else {
        format!("https://{repo}")
    }
}

pub(super) fn command_output_details(stdout: &[u8], stderr: &[u8]) -> String {
    format!(
        "command exited with stdout_bytes={} stderr_bytes={}",
        stdout.len(),
        stderr.len()
    )
}
