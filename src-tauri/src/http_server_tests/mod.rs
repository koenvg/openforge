use super::*;
use axum::body::{to_bytes, Body};
use axum::http::Request;
use std::sync::Arc;
use tower::util::ServiceExt;

async fn response_body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read response body");
    serde_json::from_slice(&bytes).expect("parse response JSON")
}

async fn response_body_text(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read response body");
    String::from_utf8(bytes.to_vec()).expect("response body should be UTF-8")
}

fn test_state(name: &str) -> (AppState, tempfile::TempDir) {
    crate::test_support::test_state(name, |_, _| {})
}

mod handlers;
mod hook_lifecycle;
mod models;
mod project_resolution;
mod shutdown;
mod transport;
