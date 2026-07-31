use super::AppState;
use axum::http::{HeaderMap, StatusCode};

pub(super) fn require_backend_token(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    let Some(expected) = state.backend_token.as_deref() else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "backend token is not configured".to_string(),
        ));
    };

    let Some(actual) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "missing backend authorization token".to_string(),
        ));
    };

    if actual != expected {
        return Err((
            StatusCode::UNAUTHORIZED,
            "invalid backend authorization token".to_string(),
        ));
    }

    Ok(())
}
