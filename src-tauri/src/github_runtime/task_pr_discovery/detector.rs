use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Candidate {
    pub owner: String,
    pub repo: String,
    pub number: i64,
}

#[derive(Default)]
pub(crate) struct Detector {
    carry: Vec<u8>,
    escape: u8,
    discarded: bool,
    recent: std::collections::VecDeque<(Candidate, Instant)>,
    escape_len: usize,
}

impl Detector {
    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(crate) fn feed(&mut self, bytes: &[u8], now: Instant, mut emit: impl FnMut(Candidate)) {
        self.recent
            .retain(|(_, seen)| now.saturating_duration_since(*seen).as_secs() < 30);
        for &byte in bytes {
            // OSC/DCS payloads are not visible text. Skip without retaining them.
            if self.escape == 3 || self.escape == 4 {
                if byte == 7 || (self.escape == 4 && byte == b'\\') {
                    self.escape = 0;
                } else {
                    self.escape = if byte == 0x1b { 4 } else { 3 };
                }
                continue;
            }
            if self.escape != 0 {
                self.escape_len += 1;
                if self.escape_len + self.carry.len() > 2048 {
                    self.reject();
                    continue;
                }
            }
            match self.escape {
                1 => {
                    if byte == b'[' {
                        self.escape = 2;
                    } else if b"]PX^_".contains(&byte) {
                        self.reject();
                        self.escape = 3;
                    } else {
                        self.reject();
                    }
                    continue;
                }
                2 => {
                    if byte == b'm' {
                        self.escape = 0;
                    } else if !byte.is_ascii_digit() && !b";:".contains(&byte) {
                        self.reject();
                    }
                    continue;
                }
                _ => {}
            }
            if byte == 0x1b {
                self.escape = 1;
                self.escape_len = 1;
            } else if b" \t\r\n\"'`<>()[]{}".contains(&byte) {
                if !self.discarded {
                    if let Some(candidate) = parse_candidate(&self.carry) {
                        if !self.recent.iter().any(|(pr, _)| pr == &candidate) {
                            if self.recent.len() == 128 {
                                self.recent.pop_front();
                            }
                            self.recent.push_back((candidate.clone(), now));
                            emit(candidate);
                        }
                    }
                }
                self.carry.clear();
                self.discarded = false;
            } else if byte.is_ascii_control() || !byte.is_ascii() {
                self.reject();
            } else if !self.discarded {
                if self.carry.len() == 2048 {
                    self.reject();
                } else {
                    self.carry.push(byte);
                }
            }
        }
    }

    fn reject(&mut self) {
        self.carry.clear();
        self.escape = 0;
        self.discarded = true;
    }
}

fn parse_candidate(bytes: &[u8]) -> Option<Candidate> {
    let text = std::str::from_utf8(bytes)
        .ok()?
        .trim_end_matches(['.', ',', ';', ':', '!', '?']);
    let path = text
        .strip_prefix("https://github.com/")
        .or_else(|| text.strip_prefix("http://github.com/"))?;
    let path = path.split(['?', '#']).next()?.trim_end_matches('/');
    let mut parts = path.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if parts.next()? != "pull" {
        return None;
    }
    let number = parts.next()?;
    if parts.next().is_some()
        || owner.is_empty()
        || repo.is_empty()
        || number.is_empty()
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        || !number.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let number = number.parse::<i64>().ok().filter(|n| *n > 0)?;
    Some(Candidate {
        owner: owner.to_ascii_lowercase(),
        repo: repo.to_ascii_lowercase(),
        number,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_terminal_controls_never_supply_url_boundaries_or_hidden_urls() {
        for text in [
            "https://github.com/acme/r/pull/42\x0c ",
            "https://github.com/acme/r/pull/42\x0b ",
            "\x1b]0;hidden https://github.com/acme/r/pull/42 \x07\n",
            "\x1bP hidden https://github.com/acme/r/pull/42 \x1b\\\n",
        ] {
            let mut found = Vec::new();
            Detector::default().feed(text.as_bytes(), Instant::now(), |pr| found.push(pr));
            assert!(found.is_empty(), "{text:?}");
        }
    }

    #[test]
    fn accepts_color_subparameters_and_canonical_url_suffixes() {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        for text in [
            "https://github.com/acme/r/pull/4\x1b[38:2:1:2:3m2\x1b[0m\n",
            "http://github.com/acme/r/pull/43/ ",
            "https://github.com/acme/r/pull/44?notification_referrer_id=1 ",
            "https://github.com/acme/r/pull/45#discussion_r123 ",
        ] {
            detector.feed(text.as_bytes(), Instant::now(), |pr| found.push(pr));
        }
        assert_eq!(
            found.iter().map(|pr| pr.number).collect::<Vec<_>>(),
            vec![42, 43, 44, 45]
        );
    }

    #[test]
    fn gap_or_replacement_discards_carry_and_recent_identity() {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        let now = Instant::now();
        detector.feed(b"https://github.com/acme/r/pull/42 ", now, |pr| {
            found.push(pr)
        });
        detector.feed(b"https://github.com/acme/r/pull/1", now, |pr| {
            found.push(pr)
        });
        detector.reset();
        detector.feed(b"23 ", now, |pr| found.push(pr));
        assert_eq!(found.len(), 1);
        detector.feed(b"https://github.com/acme/r/pull/42 ", now, |pr| {
            found.push(pr)
        });
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn rejects_malformed_controls_and_oversized_candidates_then_recovers() {
        let now = Instant::now();
        for invalid in [
            "https://github.com/acme/r/pull/12x ".to_string(),
            "https://github.com.evil/acme/r/pull/12 ".to_string(),
            "https://github.com/acme/r/pull/0 ".to_string(),
            "https://github.com/acme/r/pull/12\x1b[2K ".to_string(),
            "https://github.com/acme/r/pull/12\x08 ".to_string(),
            format!("https://github.com/{}/r/pull/12 ", "a".repeat(2100)),
        ] {
            let mut detector = Detector::default();
            let mut found = Vec::new();
            detector.feed(invalid.as_bytes(), now, |pr| found.push(pr));
            assert!(found.is_empty(), "accepted {invalid:?}");
            detector.feed(b"https://github.com/acme/r/pull/42\n", now, |pr| {
                found.push(pr)
            });
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].number, 42);
        }
    }

    #[test]
    fn deduplicates_canonical_identity_but_expires_and_evicts_old_entries() {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        let now = Instant::now();
        for url in [
            "https://github.com/ACME/r/pull/42 ",
            "https://github.com/acme/R/pull/042 ",
        ] {
            detector.feed(url.as_bytes(), now, |pr| found.push(pr));
        }
        assert_eq!(found.len(), 1);
        detector.feed(
            b"https://github.com/acme/r/pull/42 ",
            now + std::time::Duration::from_secs(31),
            |pr| found.push(pr),
        );
        assert_eq!(found.len(), 2);
        for number in 100..229 {
            detector.feed(
                format!("https://github.com/acme/r/pull/{number} ").as_bytes(),
                now + std::time::Duration::from_secs(31),
                |pr| found.push(pr),
            );
        }
        detector.feed(
            b"https://github.com/acme/r/pull/42 ",
            now + std::time::Duration::from_secs(31),
            |pr| found.push(pr),
        );
        assert_eq!(found.len(), 132);
    }

    #[test]
    fn waits_for_boundary_across_split_scheme_and_number_with_color() {
        let mut detector = Detector::default();
        let mut found = Vec::new();
        let now = Instant::now();
        for chunk in [
            "created (htt",
            "ps://github.com/Acme/widgets/pull/1",
            "\x1b[32m2",
            "3\x1b[0m",
        ] {
            detector.feed(chunk.as_bytes(), now, |pr| found.push(pr));
            assert!(found.is_empty());
        }
        detector.feed(b").\n", now, |pr| found.push(pr));
        assert_eq!(
            found,
            vec![Candidate {
                owner: "acme".into(),
                repo: "widgets".into(),
                number: 123
            }]
        );
    }
}
