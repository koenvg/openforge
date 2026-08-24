#[allow(dead_code)]
#[path = "../build.rs"]
mod build_script;

use serde_json::Value;

const CONFORMANCE_FIXTURES: &str =
    include_str!("../../fixtures/openforge-cli-runtime-asset-manifests.json");

#[test]
fn runtime_asset_manifest_matches_shared_conformance_fixtures() {
    let fixtures: Value = serde_json::from_str(CONFORMANCE_FIXTURES)
        .expect("conformance fixtures must be valid JSON");
    let cases = fixtures["cases"]
        .as_array()
        .expect("conformance fixtures must contain a cases array");

    for case in cases {
        let name = case["name"]
            .as_str()
            .expect("each conformance fixture must have a name");
        let expected_valid = case["valid"]
            .as_bool()
            .expect("each conformance fixture must declare whether it is valid");
        let result = build_script::runtime_file_names(&case["manifest"]);

        assert_eq!(
            result.is_ok(),
            expected_valid,
            "Rust validator disagreed with conformance fixture: {name}: {result:?}"
        );

        if expected_valid {
            let expected_files = case["runtimeFiles"]
                .as_array()
                .expect("valid conformance fixtures must list expected runtime files")
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .expect("expected runtime filenames must be strings")
                })
                .collect::<Vec<_>>();
            assert_eq!(
                result.expect("valid fixture must pass"),
                expected_files,
                "{name}"
            );
        }
    }
}
