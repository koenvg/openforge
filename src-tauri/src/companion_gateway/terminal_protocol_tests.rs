use super::terminal_protocol::{ClientTerminalControl, ServerTerminalControl};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct FixtureDocument {
    valid: Vec<Fixture>,
    invalid: Vec<Fixture>,
}

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    direction: String,
    message: serde_json::Value,
}

fn fixtures() -> FixtureDocument {
    serde_json::from_str(include_str!(
        "../../../docs/contracts/companion-terminal-v1-fixtures.json"
    ))
    .expect("terminal fixtures")
}

#[test]
fn shared_terminal_controls_decode_in_rust() {
    let fixtures = fixtures();
    for fixture in fixtures.valid {
        let encoded = serde_json::to_string(&fixture.message).expect("fixture JSON");
        let result = match fixture.direction.as_str() {
            "client" => ClientTerminalControl::decode(&encoded).map(|_| ()),
            "server" => ServerTerminalControl::decode(&encoded).map(|_| ()),
            direction => panic!("unknown fixture direction {direction}"),
        };
        assert!(result.is_ok(), "valid fixture {}: {result:?}", fixture.name);
    }
}

#[test]
fn shared_invalid_terminal_controls_are_rejected_in_rust() {
    let fixtures = fixtures();
    for fixture in fixtures.invalid {
        let encoded = serde_json::to_string(&fixture.message).expect("fixture JSON");
        let result = match fixture.direction.as_str() {
            "client" => ClientTerminalControl::decode(&encoded).map(|_| ()),
            "server" => ServerTerminalControl::decode(&encoded).map(|_| ()),
            direction => panic!("unknown fixture direction {direction}"),
        };
        assert!(result.is_err(), "invalid fixture {} decoded", fixture.name);
    }
}
