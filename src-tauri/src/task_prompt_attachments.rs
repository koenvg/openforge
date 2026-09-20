use crate::task_prompt::parse_image_reference_definition;
use base64::{engine::general_purpose, Engine as _};
use std::path::{Path, PathBuf};

fn safe_task_prompt_image_path_component(task_id: &str) -> String {
    let safe_id: String = task_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if safe_id.is_empty() {
        "task".to_string()
    } else {
        safe_id
    }
}

pub(crate) fn task_prompt_image_attachment_dir(root_dir: &Path, task_id: &str) -> PathBuf {
    root_dir
        .join("task-image-attachments")
        .join(safe_task_prompt_image_path_component(task_id))
}

fn image_file_extension(mime_type: &str) -> String {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => "png".to_string(),
        "image/jpeg" | "image/jpg" => "jpg".to_string(),
        "image/gif" => "gif".to_string(),
        "image/webp" => "webp".to_string(),
        "image/bmp" => "bmp".to_string(),
        "image/heic" => "heic".to_string(),
        "image/heif" => "heif".to_string(),
        mime => {
            let subtype = mime
                .strip_prefix("image/")
                .unwrap_or("img")
                .split('+')
                .next()
                .unwrap_or("img");
            let extension: String = subtype
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric())
                .collect();
            if extension.is_empty() {
                "img".to_string()
            } else {
                extension
            }
        }
    }
}

fn markdown_reference_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if path.chars().any(char::is_whitespace) {
        format!("<{}>", path.replace('>', "%3E"))
    } else {
        path.into_owned()
    }
}

fn materialize_task_prompt_image_reference_line(
    task_id: &str,
    line: &str,
    attachment_dir: &Path,
) -> Result<Option<String>, String> {
    let Some(reference) = parse_image_reference_definition(line) else {
        return Ok(None);
    };

    let bytes = general_purpose::STANDARD
        .decode(reference.base64_payload)
        .map_err(|e| format!("failed to decode pasted image {}: {e}", reference.marker))?;
    std::fs::create_dir_all(attachment_dir).map_err(|e| {
        format!("failed to create image attachment directory for task {task_id}: {e}")
    })?;

    let image_path = attachment_dir.join(format!(
        "image-{}.{}",
        reference.image_number,
        image_file_extension(reference.mime_type)
    ));
    std::fs::write(&image_path, bytes)
        .map_err(|e| format!("failed to write pasted image {}: {e}", reference.marker))?;
    Ok(Some(format!(
        "{}: {}",
        reference.marker,
        markdown_reference_path(&image_path)
    )))
}

pub(crate) fn materialize_task_prompt_images(
    task_id: &str,
    prompt: &str,
    attachment_dir: &Path,
) -> Result<String, String> {
    if !prompt.contains("data:image/") {
        return Ok(prompt.to_string());
    }

    let mut materialized_lines = Vec::new();
    for line in prompt.lines() {
        match materialize_task_prompt_image_reference_line(task_id, line, attachment_dir)? {
            Some(materialized_line) => materialized_lines.push(materialized_line),
            None => materialized_lines.push(line.to_string()),
        }
    }

    let mut materialized = materialized_lines.join("\n");
    if prompt.ends_with('\n') {
        materialized.push('\n');
    }
    Ok(materialized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materialize_task_prompt_images_writes_files_and_replaces_data_uri_references() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let prompt =
            "Describe [image#1] inline\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=\n";

        let materialized =
            materialize_task_prompt_images("T-500", prompt, temp_dir.path()).expect("materialize");

        let image_path = temp_dir.path().join("image-1.png");
        assert_eq!(
            std::fs::read(&image_path).expect("materialized image file"),
            b"image-bytes"
        );
        assert!(materialized.contains("Describe [image#1] inline"));
        assert!(materialized.contains("[image#1]: "));
        assert!(materialized.contains(image_path.to_string_lossy().as_ref()));
        assert!(!materialized.contains("data:image/png;base64"));
    }

    #[test]
    fn materialize_task_prompt_images_leaves_noncanonical_references_untouched() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let attachment_dir = temp_dir.path().join("attachments");
        let prompt =
            "[image#1]: data:image/png;base64,   \n[image#2]: data:image/svg_xml;base64,YQ==\n";

        let materialized = materialize_task_prompt_images("T-501", prompt, &attachment_dir)
            .expect("ignore noncanonical references");

        assert_eq!(materialized, prompt);
        assert!(!attachment_dir.exists());
    }
}
