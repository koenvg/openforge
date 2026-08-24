//! Resolving GitHub upload URLs found in issue/PR Markdown.
//!
//! Anything pasted into a pull request body — screenshot, GIF, screen recording —
//! is stored as `https://github.com/user-attachments/assets/<id>`. GitHub only
//! serves those to an authenticated *web session*; a personal access token gets
//! the sign-in page back, so the app can never load one directly. GitHub's own UI
//! never renders that URL either: when it renders the Markdown it swaps in a
//! short-lived signed `private-user-images.githubusercontent.com` URL that needs
//! no credentials.
//!
//! So we ask the Markdown API to render the attachment and mirror whatever it
//! decided. The probe document holds both forms GitHub understands, because the
//! two are resolved in different positions: an `<img>` tag resolves pictures, and
//! a bare URL on its own line is what GitHub turns into a `<video>` player. A
//! rendered `<video>` therefore means "this asset is a recording", and an `<img>`
//! means "this is a picture" (animated GIFs included — GitHub renders those as
//! images, and so do we).

use super::error::GitHubError;
use super::GitHubClient;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GithubAssetKind {
    Image,
    Video,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ResolvedGithubAsset {
    pub url: String,
    pub kind: GithubAssetKind,
}

#[derive(Debug, Serialize)]
struct RenderMarkdownRequest {
    text: String,
    mode: &'static str,
    context: String,
}

fn is_safe_attachment_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Whether `url` is a GitHub upload URL the sidecar may send to the Markdown API.
///
/// Deliberately narrow: only the two attachment shapes GitHub writes into issue
/// and pull request bodies, with path segments restricted so nothing arbitrary
/// can be embedded in the Markdown document we render.
pub(crate) fn is_github_attachment_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };

    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return false;
    }

    let Some(segments) = parsed.path_segments() else {
        return false;
    };
    let segments: Vec<&str> = segments.collect();
    if !segments
        .iter()
        .all(|segment| is_safe_attachment_segment(segment))
    {
        return false;
    }

    matches!(
        segments.as_slice(),
        ["user-attachments", "assets", _] | [_, _, "assets", _, _]
    )
}

/// Read the `src` of the first `<tag>` element in an HTML fragment.
fn first_html_tag_src(html: &str, tag: &str) -> Option<String> {
    let opening = format!("<{tag}");
    let mut rest = html;

    loop {
        let start = rest.find(&opening)?;
        let after = &rest[start + opening.len()..];
        rest = after;

        // Guard against `<img` matching `<image`, `<video` matching `<videos`, …
        if !after.starts_with([' ', '\t', '\n', '\r', '>', '/']) {
            continue;
        }

        let tag_end = after.find('>')?;
        let attributes = &after[..tag_end];
        rest = &after[tag_end..];

        let Some(value_start) = attributes.find("src=\"") else {
            continue;
        };
        let value = &attributes[value_start + "src=\"".len()..];
        let Some(value_end) = value.find('"') else {
            continue;
        };

        return Some(value[..value_end].replace("&amp;", "&"));
    }
}

/// Mirror whichever element GitHub rendered for the probe document.
fn resolved_asset_from_html(html: &str, requested_url: &str) -> Option<ResolvedGithubAsset> {
    if let Some(url) = first_html_tag_src(html, "video") {
        return Some(ResolvedGithubAsset {
            url,
            kind: GithubAssetKind::Video,
        });
    }

    first_html_tag_src(html, "img")
        .filter(|resolved| resolved != requested_url)
        .map(|url| ResolvedGithubAsset {
            url,
            kind: GithubAssetKind::Image,
        })
}

impl GitHubClient {
    /// Exchange a GitHub upload URL for a URL the app can load, plus how GitHub
    /// renders it.
    ///
    /// Returns `Ok(None)` when the URL is not an attachment we handle, or when
    /// GitHub hands the same URL back (nothing to swap in).
    pub async fn resolve_attachment(
        &self,
        owner: &str,
        repo: &str,
        url: &str,
        token: &str,
    ) -> Result<Option<ResolvedGithubAsset>, GitHubError> {
        if !is_github_attachment_url(url) {
            return Ok(None);
        }

        let request_body = RenderMarkdownRequest {
            text: format!("<img src=\"{url}\">\n\n{url}\n"),
            // `context` is what makes GitHub resolve the repository's attachments,
            // and it is only honoured in `gfm` mode.
            mode: "gfm",
            context: format!("{owner}/{repo}"),
        };

        let response = self
            .send_github(
                self.github_request(
                    reqwest::Method::POST,
                    "https://api.github.com/markdown",
                    token,
                )
                .json(&request_body),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        let html = response
            .text()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))?;

        Ok(resolved_asset_from_html(&html, url))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        first_html_tag_src, is_github_attachment_url, resolved_asset_from_html, GithubAssetKind,
    };

    const REQUESTED: &str = "https://github.com/user-attachments/assets/upload-id";

    #[test]
    fn accepts_the_upload_urls_github_writes_into_pull_request_bodies() {
        assert!(is_github_attachment_url(
            "https://github.com/user-attachments/assets/971f5efc-5e71-4d11-a2b5-daecad5323f3"
        ));
        assert!(is_github_attachment_url(
            "https://github.com/acme/repo/assets/10912932/971f5efc-5e71-4d11-a2b5-daecad5323f3"
        ));
    }

    #[test]
    fn rejects_urls_outside_the_attachment_shapes() {
        for url in [
            "https://raw.githubusercontent.com/acme/repo/abc123/docs/diagram.png",
            "https://github.com/acme/repo/pull/42",
            "https://evil.example.com/user-attachments/assets/971f5efc",
            "http://github.com/user-attachments/assets/971f5efc",
            "https://github.com/user-attachments/assets/971f5efc?x=1",
            "https://github.com/user-attachments/assets/a/../../secret",
            "https://github.com/user-attachments/assets/\"><script>",
            "not a url",
        ] {
            assert!(!is_github_attachment_url(url), "should reject {url}");
        }
    }

    #[test]
    fn reads_the_signed_src_out_of_rendered_markdown() {
        let html = concat!(
            "<p dir=\"auto\"><a target=\"_blank\" href=\"https://private-user-images.githubusercontent.com/1/a.png?jwt=link\">",
            "<img src=\"https://private-user-images.githubusercontent.com/1/a.png?jwt=signed&amp;v=2\" alt=\"image\" style=\"max-width: 100%;\">",
            "</a></p>"
        );

        assert_eq!(
            first_html_tag_src(html, "img").as_deref(),
            Some("https://private-user-images.githubusercontent.com/1/a.png?jwt=signed&v=2")
        );
    }

    #[test]
    fn skips_elements_whose_name_only_starts_like_the_tag() {
        let html = "<image src=\"https://example.com/decoy.png\"><img src=\"https://example.com/real.png\">";

        assert_eq!(
            first_html_tag_src(html, "img").as_deref(),
            Some("https://example.com/real.png")
        );
    }

    #[test]
    fn treats_a_rendered_picture_as_an_image() {
        let html = concat!(
            "<p><img src=\"https://private-user-images.githubusercontent.com/1/a.png?jwt=signed\"></p>",
            "<p><a href=\"https://github.com/user-attachments/assets/upload-id\">https://github.com/user-attachments/assets/upload-id</a></p>"
        );

        let resolved = resolved_asset_from_html(html, REQUESTED).expect("resolved asset");
        assert_eq!(resolved.kind, GithubAssetKind::Image);
        assert_eq!(
            resolved.url,
            "https://private-user-images.githubusercontent.com/1/a.png?jwt=signed"
        );
    }

    #[test]
    fn prefers_the_video_player_github_renders_for_recordings() {
        // GitHub resolves the `<img>` probe for a recording too, so the rendered
        // `<video>` is what tells us the asset is playable rather than a picture.
        let html = concat!(
            "<p><img src=\"https://private-user-images.githubusercontent.com/1/a.mp4?jwt=signed\"></p>",
            "<details open=\"\"><summary>clip.mp4</summary>",
            "<video src=\"https://private-user-images.githubusercontent.com/1/a.mp4?jwt=signed\" controls=\"controls\" muted=\"muted\"></video>",
            "</details>"
        );

        let resolved = resolved_asset_from_html(html, REQUESTED).expect("resolved asset");
        assert_eq!(resolved.kind, GithubAssetKind::Video);
        assert_eq!(
            resolved.url,
            "https://private-user-images.githubusercontent.com/1/a.mp4?jwt=signed"
        );
    }

    #[test]
    fn returns_none_when_github_leaves_the_attachment_unresolved() {
        assert_eq!(
            resolved_asset_from_html("<p>no media here</p>", REQUESTED),
            None
        );
        assert_eq!(
            resolved_asset_from_html(&format!("<img src=\"{REQUESTED}\">"), REQUESTED),
            None
        );
    }
}
