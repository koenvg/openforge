use std::time::{Duration, SystemTime, SystemTimeError, UNIX_EPOCH};

#[derive(Debug, thiserror::Error)]
pub(crate) enum UnixTimestampError {
    #[error("system time predates Unix epoch: {0}")]
    BeforeEpoch(#[from] SystemTimeError),
    #[error("unix timestamp exceeds the supported numeric range: {0}")]
    OutOfRange(#[from] std::num::TryFromIntError),
}

/// Converts a system time to whole seconds since the Unix epoch.
///
/// # Errors
///
/// Returns [`UnixTimestampError::BeforeEpoch`] for pre-epoch times and
/// [`UnixTimestampError::OutOfRange`] when the seconds do not fit in `i64`.
pub(crate) fn seconds(time: SystemTime) -> Result<i64, UnixTimestampError> {
    seconds_from_duration(elapsed_since_epoch(time)?)
}

/// Converts a system time to whole milliseconds since the Unix epoch.
///
/// # Errors
///
/// Returns [`UnixTimestampError::BeforeEpoch`] for pre-epoch times and
/// [`UnixTimestampError::OutOfRange`] when the milliseconds do not fit in `u64`.
pub(crate) fn milliseconds(time: SystemTime) -> Result<u64, UnixTimestampError> {
    milliseconds_from_duration(elapsed_since_epoch(time)?)
}

/// Converts a system time to whole milliseconds since the Unix epoch as `i64`.
///
/// # Errors
///
/// Returns [`UnixTimestampError::BeforeEpoch`] for pre-epoch times and
/// [`UnixTimestampError::OutOfRange`] when the milliseconds do not fit in `i64`.
pub(crate) fn milliseconds_i64(time: SystemTime) -> Result<i64, UnixTimestampError> {
    milliseconds_i64_from_duration(elapsed_since_epoch(time)?)
}

/// Converts a system time to whole nanoseconds since the Unix epoch.
///
/// # Errors
///
/// Returns [`UnixTimestampError::BeforeEpoch`] when `time` predates the Unix epoch.
pub(crate) fn nanoseconds(time: SystemTime) -> Result<u128, UnixTimestampError> {
    Ok(elapsed_since_epoch(time)?.as_nanos())
}

fn elapsed_since_epoch(time: SystemTime) -> Result<Duration, UnixTimestampError> {
    Ok(time.duration_since(UNIX_EPOCH)?)
}

fn seconds_from_duration(elapsed: Duration) -> Result<i64, UnixTimestampError> {
    Ok(i64::try_from(elapsed.as_secs())?)
}

fn milliseconds_from_duration(elapsed: Duration) -> Result<u64, UnixTimestampError> {
    Ok(u64::try_from(elapsed.as_millis())?)
}

fn milliseconds_i64_from_duration(elapsed: Duration) -> Result<i64, UnixTimestampError> {
    Ok(i64::try_from(elapsed.as_millis())?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn seconds_rejects_time_before_unix_epoch() {
        let before_unix_epoch = UNIX_EPOCH - Duration::from_secs(1);

        let error =
            seconds(before_unix_epoch).expect_err("a pre-epoch clock value should return an error");

        assert!(matches!(error, UnixTimestampError::BeforeEpoch(_)));
    }

    #[test]
    fn seconds_rejects_values_above_i64_range() {
        let max_i64 = u64::try_from(i64::MAX).expect("i64::MAX fits in u64");
        let elapsed = Duration::from_secs(max_i64 + 1);

        let error = seconds_from_duration(elapsed)
            .expect_err("seconds outside the i64 range should return an error");

        assert!(matches!(error, UnixTimestampError::OutOfRange(_)));
    }

    #[test]
    fn milliseconds_rejects_values_above_u64_range() {
        let elapsed = Duration::from_secs(u64::MAX);

        let error = milliseconds_from_duration(elapsed)
            .expect_err("milliseconds outside the u64 range should return an error");

        assert!(matches!(error, UnixTimestampError::OutOfRange(_)));
    }

    #[test]
    fn milliseconds_i64_rejects_values_above_i64_range() {
        let max_i64 = u64::try_from(i64::MAX).expect("i64::MAX fits in u64");
        let elapsed = Duration::from_millis(max_i64 + 1);

        let error = milliseconds_i64_from_duration(elapsed)
            .expect_err("milliseconds outside the i64 range should return an error");

        assert!(matches!(error, UnixTimestampError::OutOfRange(_)));
    }
}
