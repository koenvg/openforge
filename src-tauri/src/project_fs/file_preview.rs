use super::{ProjectFileContent, ProjectFsError, ProjectFsResult};
use std::path::Path;
use tokio::io::AsyncReadExt;

/// Images up to 25 MiB of raw bytes may be inlined; larger images are metadata-only.
/// This bounds the payload before base64 expands it by roughly one third.
const MAX_INLINE_IMAGE_PREVIEW_SIZE: u64 = 25 * 1024 * 1024;

const MAX_INLINE_VIDEO_PREVIEW_SIZE: u64 = 25 * 1024 * 1024;

const MAX_INLINE_PREVIEW_SIZE: u64 = 1024 * 1024;

fn file_type_key(path: &Path) -> String {
    if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
        return ext.to_ascii_lowercase();
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectFilePreviewType {
    Text,
    Image,
    Video,
    Document,
    Binary,
}

impl ProjectFilePreviewType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
            Self::Video => "video",
            Self::Document => "document",
            Self::Binary => "binary",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProjectFilePreviewMetadata {
    preview_type: ProjectFilePreviewType,
    mime_type: Option<&'static str>,
}

impl ProjectFilePreviewMetadata {
    const fn new(preview_type: ProjectFilePreviewType, mime_type: &'static str) -> Self {
        Self {
            preview_type,
            mime_type: Some(mime_type),
        }
    }

    const fn binary() -> Self {
        Self {
            preview_type: ProjectFilePreviewType::Binary,
            mime_type: None,
        }
    }

    fn mime_type_string(self) -> Option<String> {
        self.mime_type.map(str::to_string)
    }
}

fn file_preview_metadata(path: &Path) -> ProjectFilePreviewMetadata {
    let key = file_type_key(path);
    match key.as_str() {
        "ts" | "tsx" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/typescript")
        }
        "js" | "jsx" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "application/javascript")
        }
        "rs" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/rust"),
        "py" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/python"),
        "rb" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/ruby"),
        "go" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/go"),
        "json" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "application/json"),
        "yaml" | "yml" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "application/yaml")
        }
        "md" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/markdown"),
        "txt" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/plain"),
        "toml" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/toml"),
        "css" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/css"),
        "html" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/html"),
        "svelte" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/svelte"),
        "vue" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/vue"),
        "sh" | "bash" | "zsh" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/shell")
        }
        "sql" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/sql"),
        "graphql" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/graphql"),
        "xml" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "application/xml"),
        "csv" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/csv"),
        "env" | "gitignore" | "prettierrc" | "eslintrc" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/plain")
        }
        "cfg" | "ini" | "conf" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/plain")
        }
        "log" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/plain"),
        "lock" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Text, "text/plain"),
        "png" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/png"),
        "jpg" | "jpeg" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/jpeg")
        }
        "gif" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/gif"),
        "svg" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/svg+xml"),
        "webp" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/webp"),
        "ico" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/x-icon"),
        "bmp" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Image, "image/bmp"),
        "mp4" | "m4v" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Video, "video/mp4")
        }
        "webm" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Video, "video/webm"),
        "ogv" | "ogg" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Video, "video/ogg")
        }
        "mov" => ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Video, "video/quicktime"),
        "pdf" => {
            ProjectFilePreviewMetadata::new(ProjectFilePreviewType::Document, "application/pdf")
        }
        _ => ProjectFilePreviewMetadata::binary(),
    }
}

fn contains_binary_control(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|byte| byte.is_ascii_control() && !matches!(*byte, b'\t' | b'\n' | b'\r' | 0x0c))
}

fn is_utf8_text_sample(bytes: &[u8]) -> bool {
    if contains_binary_control(bytes) {
        return false;
    }

    match std::str::from_utf8(bytes) {
        Ok(_) => true,
        Err(error) => error.error_len().is_none(),
    }
}

fn decode_text_content(bytes: Vec<u8>) -> Option<String> {
    if contains_binary_control(&bytes) {
        return None;
    }

    String::from_utf8(bytes).ok()
}

#[derive(Debug)]
enum BoundedFileRead {
    Complete(Vec<u8>),
    TooLarge { bytes: Vec<u8>, size: u64 },
}

async fn read_file_bytes_bounded(
    file: tokio::fs::File,
    max_size: u64,
) -> ProjectFsResult<BoundedFileRead> {
    let mut bytes = Vec::new();
    let mut reader = file.take(max_size + 1);
    reader
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| ProjectFsError::internal(format!("Failed to read file: {error}")))?;
    if bytes.len() as u64 <= max_size {
        return Ok(BoundedFileRead::Complete(bytes));
    }

    let current_size = reader
        .get_ref()
        .metadata()
        .await
        .map_err(|error| {
            ProjectFsError::internal(format!("Failed to read file metadata: {error}"))
        })?
        .len();
    Ok(BoundedFileRead::TooLarge {
        size: current_size.max(bytes.len() as u64),
        bytes,
    })
}

async fn read_file_sample(file: tokio::fs::File, sample_size: u64) -> ProjectFsResult<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(sample_size)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| ProjectFsError::internal(format!("Failed to read file: {error}")))?;
    Ok(bytes)
}

pub(crate) async fn read_file_preview(
    project_root: &Path,
    sub_path: &str,
) -> ProjectFsResult<ProjectFileContent> {
    read_file_preview_impl(project_root, sub_path, || {}).await
}

async fn read_file_preview_impl(
    project_root: &Path,
    sub_path: &str,
    after_metadata: impl FnOnce(),
) -> ProjectFsResult<ProjectFileContent> {
    const CONTENT_SAMPLE_SIZE: u64 = 8_192;
    let project_root = project_root.to_path_buf();
    let sub_path = sub_path.to_string();
    let opened = tokio::task::spawn_blocking(move || {
        crate::authorized_fs::open_authorized_file(
            &project_root,
            &sub_path,
            crate::authorized_fs::SymlinkPolicy::FollowWithinRoot,
        )
    })
    .await
    .map_err(|error| {
        ProjectFsError::internal(format!("Failed to join authorized file open: {error}"))
    })??;
    let size = opened.metadata().len();
    // Keep race tests deterministic without sleeps or a process-global hook.
    after_metadata();
    let preview_metadata = file_preview_metadata(opened.resolved_path());
    let mime_type = preview_metadata.mime_type_string();
    let file = tokio::fs::File::from_std(opened.into_file());
    match preview_metadata.preview_type {
        ProjectFilePreviewType::Text => {
            if size > MAX_INLINE_PREVIEW_SIZE {
                return Ok(ProjectFileContent {
                    r#type: "large-file".to_string(),
                    content: String::new(),
                    mime_type,
                    size,
                });
            }
            let bytes = match read_file_bytes_bounded(file, MAX_INLINE_PREVIEW_SIZE).await? {
                BoundedFileRead::Complete(bytes) => bytes,
                BoundedFileRead::TooLarge { size, .. } => {
                    return Ok(ProjectFileContent {
                        r#type: "large-file".to_string(),
                        content: String::new(),
                        mime_type,
                        size,
                    });
                }
            };
            let size = bytes.len() as u64;
            let content = String::from_utf8(bytes).map_err(|error| {
                ProjectFsError::bad_request(format!("File is not valid UTF-8: {error}"))
            })?;
            Ok(ProjectFileContent {
                r#type: "text".to_string(),
                content,
                mime_type,
                size,
            })
        }
        ProjectFilePreviewType::Image => {
            if size > MAX_INLINE_IMAGE_PREVIEW_SIZE {
                return Ok(ProjectFileContent {
                    r#type: "large-file".to_string(),
                    content: String::new(),
                    mime_type,
                    size,
                });
            }
            // Probe one byte beyond the limit so an exact-limit image is still allowed.
            // Bound the read itself: the file may have grown since authorized open.
            let mut reader = file.take(MAX_INLINE_IMAGE_PREVIEW_SIZE + 1);
            let mut bytes = Vec::new();
            reader.read_to_end(&mut bytes).await.map_err(|error| {
                ProjectFsError::internal(format!("Failed to read file: {error}"))
            })?;
            let size = bytes.len() as u64;
            if size > MAX_INLINE_IMAGE_PREVIEW_SIZE {
                // Refresh from the same authorized descriptor, never reopen the path.
                // If it shrank again, report at least the oversized length observed.
                let current_size = reader
                    .get_ref()
                    .metadata()
                    .await
                    .map_err(|error| {
                        ProjectFsError::internal(format!("Failed to read file metadata: {error}"))
                    })?
                    .len();
                return Ok(ProjectFileContent {
                    r#type: "large-file".to_string(),
                    content: String::new(),
                    mime_type,
                    size: current_size.max(size),
                });
            }
            use base64::Engine;
            Ok(ProjectFileContent {
                r#type: "image".to_string(),
                content: base64::engine::general_purpose::STANDARD.encode(bytes),
                mime_type,
                size,
            })
        }
        ProjectFilePreviewType::Video => {
            if size > MAX_INLINE_VIDEO_PREVIEW_SIZE {
                return Ok(ProjectFileContent {
                    r#type: "large-file".to_string(),
                    content: String::new(),
                    mime_type,
                    size,
                });
            }

            let bytes = match read_file_bytes_bounded(file, MAX_INLINE_VIDEO_PREVIEW_SIZE).await? {
                BoundedFileRead::Complete(bytes) => bytes,
                BoundedFileRead::TooLarge { size, .. } => {
                    return Ok(ProjectFileContent {
                        r#type: "large-file".to_string(),
                        content: String::new(),
                        mime_type,
                        size,
                    });
                }
            };
            let size = bytes.len() as u64;
            use base64::Engine;
            Ok(ProjectFileContent {
                r#type: "video".to_string(),
                content: base64::engine::general_purpose::STANDARD.encode(bytes),
                mime_type,
                size,
            })
        }
        ProjectFilePreviewType::Binary => {
            if size > MAX_INLINE_PREVIEW_SIZE {
                let sample = read_file_sample(file, CONTENT_SAMPLE_SIZE).await?;
                let is_text = is_utf8_text_sample(&sample);
                return Ok(ProjectFileContent {
                    r#type: if is_text { "large-file" } else { "binary" }.to_string(),
                    content: String::new(),
                    mime_type: if is_text {
                        Some("text/plain".to_string())
                    } else {
                        mime_type
                    },
                    size,
                });
            }

            let bytes = match read_file_bytes_bounded(file, MAX_INLINE_PREVIEW_SIZE).await? {
                BoundedFileRead::Complete(bytes) => bytes,
                BoundedFileRead::TooLarge { bytes, size } => {
                    let sample_len = bytes.len().min(CONTENT_SAMPLE_SIZE as usize);
                    let is_text = is_utf8_text_sample(&bytes[..sample_len]);
                    return Ok(ProjectFileContent {
                        r#type: if is_text { "large-file" } else { "binary" }.to_string(),
                        content: String::new(),
                        mime_type: if is_text {
                            Some("text/plain".to_string())
                        } else {
                            mime_type
                        },
                        size,
                    });
                }
            };
            let size = bytes.len() as u64;
            let content = decode_text_content(bytes);
            let Some(content) = content else {
                return Ok(ProjectFileContent {
                    r#type: "binary".to_string(),
                    content: String::new(),
                    mime_type,
                    size,
                });
            };
            Ok(ProjectFileContent {
                r#type: "text".to_string(),
                content,
                mime_type: Some("text/plain".to_string()),
                size,
            })
        }
        file_type => Ok(ProjectFileContent {
            r#type: file_type.as_str().to_string(),
            content: String::new(),
            mime_type,
            size,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn text_preview_rejects_growth_after_metadata_lookup() {
        let root = tempfile::tempdir().expect("project root");
        let path = root.path().join("growing.txt");
        std::fs::write(&path, b"small").expect("initial text");

        let preview = read_file_preview_impl(root.path(), "growing.txt", || {
            std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("growing text")
                .set_len(MAX_INLINE_PREVIEW_SIZE + 1)
                .expect("grow past text limit");
        })
        .await
        .expect("growing text metadata");

        assert_eq!(preview.r#type, "large-file");
        assert!(preview.content.is_empty());
        assert_eq!(preview.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(preview.size, MAX_INLINE_PREVIEW_SIZE + 1);
    }

    #[tokio::test]
    async fn video_preview_rejects_growth_after_metadata_lookup() {
        let root = tempfile::tempdir().expect("project root");
        let path = root.path().join("growing.mp4");
        std::fs::write(&path, [0_u8, 1, 2, 3]).expect("initial video");

        let preview = read_file_preview_impl(root.path(), "growing.mp4", || {
            std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .expect("growing video")
                .set_len(MAX_INLINE_VIDEO_PREVIEW_SIZE + 1)
                .expect("grow past video limit");
        })
        .await
        .expect("growing video metadata");

        assert_eq!(preview.r#type, "large-file");
        assert!(preview.content.is_empty());
        assert_eq!(preview.mime_type.as_deref(), Some("video/mp4"));
        assert_eq!(preview.size, MAX_INLINE_VIDEO_PREVIEW_SIZE + 1);
    }

    #[tokio::test]
    async fn binary_preview_preserves_classification_when_growth_exceeds_limit() {
        let root = tempfile::tempdir().expect("project root");

        let text_path = root.path().join("NOTICE");
        std::fs::write(&text_path, b"small").expect("initial extensionless text");
        let text_preview = read_file_preview_impl(root.path(), "NOTICE", || {
            std::fs::write(&text_path, vec![b'a'; MAX_INLINE_PREVIEW_SIZE as usize + 1])
                .expect("grow extensionless text past limit");
        })
        .await
        .expect("growing extensionless text metadata");
        assert_eq!(text_preview.r#type, "large-file");
        assert!(text_preview.content.is_empty());
        assert_eq!(text_preview.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(text_preview.size, MAX_INLINE_PREVIEW_SIZE + 1);

        let binary_path = root.path().join("artifact");
        std::fs::write(&binary_path, b"\x01binary").expect("initial binary");
        let binary_preview = read_file_preview_impl(root.path(), "artifact", || {
            std::fs::OpenOptions::new()
                .write(true)
                .open(&binary_path)
                .expect("growing binary")
                .set_len(MAX_INLINE_PREVIEW_SIZE + 1)
                .expect("grow binary past limit");
        })
        .await
        .expect("growing binary metadata");
        assert_eq!(binary_preview.r#type, "binary");
        assert!(binary_preview.content.is_empty());
        assert_eq!(binary_preview.mime_type, None);
        assert_eq!(binary_preview.size, MAX_INLINE_PREVIEW_SIZE + 1);
    }

    #[tokio::test]
    async fn image_preview_enforces_inclusive_25_mib_limit() {
        use base64::Engine;

        let root = tempfile::tempdir().expect("project root");
        for size in [26_214_399_u64, 26_214_400, 26_214_401] {
            let path = root.path().join("photo.PNG");
            std::fs::File::create(&path)
                .expect("image fixture")
                .set_len(size)
                .expect("image size");

            let preview = read_file_preview(root.path(), "photo.PNG")
                .await
                .expect("image preview");
            assert_eq!(preview.mime_type.as_deref(), Some("image/png"));
            assert_eq!(preview.size, size);
            if size <= 26_214_400 {
                assert_eq!(preview.r#type, "image");
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(&preview.content)
                    .expect("complete base64 image");
                assert_eq!(decoded.len() as u64, size);
                assert!(decoded.iter().all(|byte| *byte == 0));
            } else {
                assert_eq!(preview.r#type, "large-file");
                assert!(preview.content.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn image_preview_rejects_growth_after_metadata_lookup() {
        let root = tempfile::tempdir().expect("project root");
        let path = root.path().join("growing.jpg");
        for grown_size in [26_214_401, 104_857_600] {
            std::fs::write(&path, [0_u8, 1, 2, 3]).expect("initial image");

            let preview = read_file_preview_impl(root.path(), "growing.jpg", || {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(&path)
                    .expect("growing image")
                    .set_len(grown_size)
                    .expect("grow past image limit");
            })
            .await
            .expect("growing image metadata");

            assert_eq!(preview.r#type, "large-file");
            assert!(preview.content.is_empty());
            assert_eq!(preview.mime_type.as_deref(), Some("image/jpeg"));
            assert_eq!(preview.size, grown_size);
        }
    }

    #[tokio::test]
    async fn image_preview_reports_bytes_read_when_size_changes_within_limit() {
        let root = tempfile::tempdir().expect("project root");
        let path = root.path().join("changing.png");
        for (initial, changed, expected) in [
            (vec![0_u8], vec![0, 1, 2, 3], "AAECAw=="),
            (vec![0, 1, 2, 3], vec![0], "AA=="),
            (vec![0], vec![], ""),
        ] {
            std::fs::write(&path, initial).expect("initial image");
            let preview = read_file_preview_impl(root.path(), "changing.png", || {
                std::fs::write(&path, &changed).expect("change image size");
            })
            .await
            .expect("changed image preview");

            assert_eq!(preview.r#type, "image");
            assert_eq!(preview.content, expected);
            assert_eq!(preview.size, changed.len() as u64);
            assert_eq!(preview.mime_type.as_deref(), Some("image/png"));
        }
    }

    #[test]
    fn derives_preview_type_and_mime_from_shared_metadata() {
        let cases = [
            (
                "component.svelte",
                ProjectFilePreviewType::Text,
                Some("text/svelte"),
            ),
            (
                ".gitignore",
                ProjectFilePreviewType::Text,
                Some("text/plain"),
            ),
            (
                "photo.jpeg",
                ProjectFilePreviewType::Image,
                Some("image/jpeg"),
            ),
            (
                "design.pdf",
                ProjectFilePreviewType::Document,
                Some("application/pdf"),
            ),
            ("archive.bin", ProjectFilePreviewType::Binary, None),
            ("extensionless", ProjectFilePreviewType::Binary, None),
        ];

        for (path, expected_type, expected_mime) in cases {
            let metadata = file_preview_metadata(Path::new(path));
            assert_eq!(
                metadata.preview_type, expected_type,
                "preview type for {path}"
            );
            assert_eq!(metadata.mime_type, expected_mime, "MIME type for {path}");
        }
    }

    #[test]
    fn classifies_supported_video_extensions_and_mime_types_case_insensitively() {
        let cases = [
            ("clip.mp4", "video/mp4"),
            ("clip.m4v", "video/mp4"),
            ("clip.webm", "video/webm"),
            ("clip.ogv", "video/ogg"),
            ("clip.ogg", "video/ogg"),
            ("clip.mov", "video/quicktime"),
            ("CLIP.MP4", "video/mp4"),
        ];

        for (path, expected_mime) in cases {
            let metadata = file_preview_metadata(Path::new(path));
            assert_eq!(
                metadata.preview_type,
                ProjectFilePreviewType::Video,
                "preview type for {path}"
            );
            assert_eq!(
                metadata.mime_type,
                Some(expected_mime),
                "MIME type for {path}"
            );
        }
    }

    #[tokio::test]
    async fn returns_small_video_as_base64_with_mime_and_size() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let video_path = temp_dir.path().join("clip.mp4");
        tokio::fs::write(&video_path, [0_u8, 1, 2, 3])
            .await
            .expect("video fixture");

        let preview = read_file_preview(temp_dir.path(), "clip.mp4")
            .await
            .expect("video preview");

        assert_eq!(preview.r#type, "video");
        assert_eq!(preview.content, "AAECAw==");
        assert_eq!(preview.mime_type.as_deref(), Some("video/mp4"));
        assert_eq!(preview.size, 4);
    }

    #[tokio::test]
    async fn returns_large_file_metadata_without_reading_oversized_video() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let video_path = temp_dir.path().join("clip.webm");
        let file = tokio::fs::File::create(&video_path)
            .await
            .expect("video fixture");
        file.set_len(25 * 1024 * 1024 + 1)
            .await
            .expect("oversized video fixture");

        let preview = read_file_preview(temp_dir.path(), "clip.webm")
            .await
            .expect("large video metadata");

        assert_eq!(preview.r#type, "large-file");
        assert!(preview.content.is_empty());
        assert_eq!(preview.mime_type.as_deref(), Some("video/webm"));
        assert_eq!(preview.size, 25 * 1024 * 1024 + 1);
    }

    #[tokio::test]
    async fn previews_extensionless_utf8_content_as_text() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let license_path = temp_dir.path().join("LICENSE");
        let license_text = "Copyright 2026 OpenForge contributors\n";
        tokio::fs::write(&license_path, license_text)
            .await
            .expect("LICENSE fixture");

        let preview = read_file_preview(temp_dir.path(), "LICENSE")
            .await
            .expect("extensionless text preview");

        assert_eq!(preview.r#type, "text");
        assert_eq!(preview.content, license_text);
        assert_eq!(preview.mime_type.as_deref(), Some("text/plain"));
    }

    #[tokio::test]
    async fn identifies_large_extensionless_utf8_content_without_rendering_it() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let large_text_path = temp_dir.path().join("NOTICE");
        let large_text = vec![b'a'; 1_048_577];
        tokio::fs::write(&large_text_path, large_text)
            .await
            .expect("large text fixture");

        let preview = read_file_preview(temp_dir.path(), "NOTICE")
            .await
            .expect("large extensionless text preview metadata");

        assert_eq!(preview.r#type, "large-file");
        assert!(preview.content.is_empty());
        assert_eq!(preview.mime_type.as_deref(), Some("text/plain"));
    }

    #[tokio::test]
    async fn keeps_extensionless_binary_content_blocked() {
        let temp_dir = tempfile::tempdir().expect("project root");
        let binary_path = temp_dir.path().join("artifact");
        tokio::fs::write(&binary_path, b"\x01\x02\x03binary payload")
            .await
            .expect("binary fixture");

        let preview = read_file_preview(temp_dir.path(), "artifact")
            .await
            .expect("binary preview metadata");

        assert_eq!(preview.r#type, "binary");
        assert!(preview.content.is_empty());
        assert_eq!(preview.mime_type, None);
    }
}
