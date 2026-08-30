use once_cell::sync::Lazy;
use regex::Regex;

static IMAGE_REFERENCE_DEFINITION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(\[image#([0-9]+)\]):\s*data:(image/([A-Za-z0-9.+-]+));base64,([A-Za-z0-9+/=]+)\s*$",
    )
    .expect("image reference regex should compile")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TaskPromptImageReference<'a> {
    pub marker: &'a str,
    pub image_number: &'a str,
    pub mime_type: &'a str,
    pub base64_payload: &'a str,
}

pub(crate) fn parse_image_reference_definition(line: &str) -> Option<TaskPromptImageReference<'_>> {
    let captures = IMAGE_REFERENCE_DEFINITION_RE.captures(line)?;

    Some(TaskPromptImageReference {
        marker: captures.get(1)?.as_str(),
        image_number: captures.get(2)?.as_str(),
        mime_type: captures.get(3)?.as_str(),
        base64_payload: captures.get(5)?.as_str(),
    })
}

pub(crate) fn task_display_title(
    task_id: &str,
    title: Option<&str>,
    initial_prompt: &str,
) -> String {
    if let Some(title) = title.map(str::trim).filter(|title| !title.is_empty()) {
        return title.to_string();
    }
    initial_prompt
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            (!trimmed.is_empty() && parse_image_reference_definition(line).is_none())
                .then_some(trimmed)
        })
        .unwrap_or(task_id)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_persisted_image_reference_definition() {
        assert_eq!(
            parse_image_reference_definition(
                "[image#12]: data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=  ",
            ),
            Some(TaskPromptImageReference {
                marker: "[image#12]",
                image_number: "12",
                mime_type: "image/svg+xml",
                base64_payload: "PHN2Zz48L3N2Zz4=",
            })
        );
    }

    #[test]
    fn rejects_noncanonical_image_reference_definitions() {
        for line in [
            " [image#1]: data:image/png;base64,YQ==",
            "[image#]: data:image/png;base64,YQ==",
            "[image#1]: data:image/;base64,YQ==",
            "[image#1]: data:image/svg_xml;base64,YQ==",
            "[image#1]: data:image/png;base64,",
            "[image#1]: data:image/png;base64,   ",
            "[image#1]: data:image/png;base64,YQ-_",
            "[image#1]: DATA:image/png;base64,YQ==",
        ] {
            assert_eq!(
                parse_image_reference_definition(line),
                None,
                "unexpectedly accepted {line:?}"
            );
        }
    }
}
