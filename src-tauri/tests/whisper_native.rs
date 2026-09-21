//! Opt-in real inference checks for the native packaging workflow.
//! See docs/whisper-macos-toolchain.md for pinned model/audio setup.

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn transcribe_fixture(use_gpu: bool) -> Result<(), Box<dyn std::error::Error>> {
    let model = std::env::var("OPENFORGE_WHISPER_TEST_MODEL")?;
    let audio = std::env::var("OPENFORGE_WHISPER_TEST_AUDIO")?;
    let mut reader = hound::WavReader::open(audio)?;
    let spec = reader.spec();
    assert_eq!(spec.channels, 1);
    assert_eq!(spec.sample_rate, 16_000);
    assert_eq!(spec.bits_per_sample, 16);
    assert_eq!(spec.sample_format, hound::SampleFormat::Int);
    let samples = reader
        .samples::<i16>()
        .map(|sample| sample.map(|value| f32::from(value) / 32768.0))
        .collect::<Result<Vec<_>, _>>()?;

    let context = WhisperContext::new_with_params(
        &model,
        WhisperContextParameters {
            use_gpu,
            ..Default::default()
        },
    )?;
    let mut state = context.create_state()?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_n_threads(2);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    state.full(params, &samples)?;

    let mut text = String::new();
    for index in 0..state.full_n_segments() {
        let segment = state.get_segment(index).expect("valid segment index");
        text.push_str(&segment.to_str_lossy()?);
    }
    println!("use_gpu={use_gpu}: {text}");
    let normalized = text.to_lowercase();
    assert!(
        normalized.contains("ask not"),
        "unexpected transcript: {text}"
    );
    assert!(
        normalized.contains("what your country can do for you"),
        "unexpected transcript: {text}"
    );
    Ok(())
}

#[test]
#[ignore = "requires pinned model and JFK audio; run by whisper-macos CI"]
fn portable_cpu_transcribes_speech() -> Result<(), Box<dyn std::error::Error>> {
    transcribe_fixture(false)
}

#[test]
#[ignore = "requires pinned model and JFK audio; run by whisper-macos CI"]
fn metal_enabled_build_transcribes_speech() -> Result<(), Box<dyn std::error::Error>> {
    transcribe_fixture(true)
}
