use super::{Candidate, Detector};
use std::time::Instant;

const TARGET: &str = "https://github.com/acme/widgets/pull/2549";

fn numbers(found: &[Candidate]) -> Vec<i64> {
    found.iter().map(|candidate| candidate.number).collect()
}

#[test]
fn rejects_invalid_control_strings_and_recovers_at_the_terminator() {
    for terminator in ["\x07", "\x1b\\"] {
        for payload in [
            "8;;".to_string(),
            format!("8;{TARGET}"),
            format!("08;;{TARGET}"),
            format!("80;;{TARGET}"),
            format!("0;{TARGET}"),
            format!("2;{TARGET}"),
            "8;;https://github.com.evil/acme/widgets/pull/2549".into(),
            "8;;javascript:alert(1)".into(),
            "8;;https://github.com/acme/widgets/pull/0".into(),
            format!("8;;{TARGET}\x08"),
            format!("8;;{TARGET}\n"),
            format!("8;;{TARGET}\x1b[31m"),
            format!("8;;{TARGET}\x1b"),
            format!("8;;{TARGET}?bad=\t"),
            format!("8;;{TARGET}?bad=é"),
            format!("8;{};{TARGET}", "a".repeat(2048)),
            format!("8;;{TARGET}?{}", "a".repeat(2048)),
            format!("0;\x1b]8;;{TARGET}"),
        ] {
            let mut detector = Detector::default();
            let mut found = Vec::new();
            let now = Instant::now();
            let invalid = format!("\x1b]{payload}{terminator}");
            for byte in invalid.as_bytes().chunks(1) {
                detector.feed(byte, now, |pr| found.push(pr));
            }
            assert!(found.is_empty(), "accepted {invalid:?}");
            detector.feed(
                format!("\x1b]8;;{TARGET}{terminator}").as_bytes(),
                now,
                |pr| found.push(pr),
            );
            assert_eq!(numbers(&found), vec![2549], "recovery after {invalid:?}");
        }
        let mut detector = Detector::default();
        let mut found = Vec::new();
        detector.feed(
            format!("\x1bP8;;{TARGET}{terminator}").as_bytes(),
            Instant::now(),
            |pr| found.push(pr),
        );
        assert!(found.is_empty());
    }
}

#[test]
fn bounds_hyperlink_payloads_and_waits_for_unterminated_strings() {
    for terminator in ["\x07", "\x1b\\"] {
        for payload_len in [2048, 2049, 16384] {
            for payload in [
                format!("8;{};{TARGET}", "a".repeat(payload_len - 3 - TARGET.len())),
                format!("8;;{TARGET}?{}", "a".repeat(payload_len - 4 - TARGET.len())),
            ] {
                let mut detector = Detector::default();
                let mut found = Vec::new();
                let now = Instant::now();
                detector.feed(format!("\x1b]{payload}").as_bytes(), now, |pr| {
                    found.push(pr)
                });
                assert!(found.is_empty());
                detector.feed(terminator.as_bytes(), now, |pr| found.push(pr));
                assert_eq!(
                    numbers(&found),
                    if payload_len == 2048 {
                        vec![2549]
                    } else {
                        vec![]
                    }
                );
                detector.feed(
                    b"\x1b]8;;https://github.com/acme/widgets/pull/42\x07",
                    now,
                    |pr| found.push(pr),
                );
                assert_eq!(found.last().map(|pr| pr.number), Some(42));
            }
        }
    }
}

#[test]
fn hyperlink_candidates_share_visible_url_deduplication_and_expiration() {
    let hidden = format!("\x1b]8;;{TARGET}\x07PR #2549\x1b]8;;\x07 ");
    let visible = "http://github.com/ACME/widgets/pull/02549#discussion ";
    for inputs in [[hidden.as_str(), visible], [visible, hidden.as_str()]] {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        let now = Instant::now();
        for input in inputs.into_iter().cycle().take(4) {
            detector.feed(input.as_bytes(), now, |pr| found.push(pr));
        }
        assert_eq!(numbers(&found), vec![2549]);
        detector.feed(
            hidden.as_bytes(),
            now + std::time::Duration::from_secs(31),
            |pr| found.push(pr),
        );
        assert_eq!(numbers(&found), vec![2549, 2549]);
    }
}

#[test]
fn hyperlink_metadata_and_visible_fragments_never_supply_a_target() {
    for input in [
        format!("\x1b]8;id={TARGET};https://example.com\x07PR #2549\x1b]8;;\x07 "),
        "Created PR #2549.\n".into(),
        "https://github.com/acme/widgets/pull/25\x1b]8;;\x0749 ".into(),
        "https://github.com/acme/widgets/pull/2549\x1b]8;;\x07 ".into(),
        "https://github.com/acme/widgets/pull/\x1b]8;;2549\x07 ".into(),
        format!("{}\x1b]0; hidden {TARGET} \x07 ", "a".repeat(2047)),
        format!("{}\x1bP hidden {TARGET} \x1b\\ ", "a".repeat(2048)),
    ] {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        detector.feed(input.as_bytes(), Instant::now(), |pr| found.push(pr));
        assert!(found.is_empty(), "accepted {input:?}");
    }
}

#[test]
fn hyperlink_opening_is_independent_of_visible_carry_and_reset_discards_partial_frames() {
    let opening = format!("\x1b]8;;{TARGET}\x1b\\");
    for prefix in ["".to_string(), "a".repeat(2047), "a".repeat(2048)] {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        let now = Instant::now();
        detector.feed(prefix.as_bytes(), now, |pr| found.push(pr));
        detector.feed(opening.as_bytes(), now, |pr| found.push(pr));
        assert_eq!(numbers(&found), vec![2549]);
    }
    for split in 1..opening.len() {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        let now = Instant::now();
        detector.feed(&opening.as_bytes()[..split], now, |pr| found.push(pr));
        detector.reset();
        detector.feed(&opening.as_bytes()[split..], now, |pr| found.push(pr));
        assert!(found.is_empty(), "joined frame across reset at {split}");
        detector.feed(opening.as_bytes(), now, |pr| found.push(pr));
        assert_eq!(numbers(&found), vec![2549]);
    }
}
