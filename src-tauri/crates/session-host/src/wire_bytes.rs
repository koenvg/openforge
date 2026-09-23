//! Byte fields that session frames encode as base64 text and persisted JSON keeps as number arrays.
use base64::Engine;
use serde::{de, Deserializer, Serializer};

/// # Errors
/// Propagates serializer errors.
pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_bytes(bytes)
}

/// # Errors
/// Refuses values that are neither base64 text nor a byte array.
pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
    deserializer.deserialize_any(WireBytes)
}

struct WireBytes;
impl<'de> de::Visitor<'de> for WireBytes {
    type Value = Vec<u8>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("base64 text or a byte array")
    }

    fn visit_str<E: de::Error>(self, text: &str) -> Result<Vec<u8>, E> {
        base64::engine::general_purpose::STANDARD
            .decode(text)
            .map_err(E::custom)
    }

    fn visit_bytes<E: de::Error>(self, bytes: &[u8]) -> Result<Vec<u8>, E> {
        Ok(bytes.to_vec())
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut sequence: A) -> Result<Vec<u8>, A::Error> {
        let mut bytes = Vec::with_capacity(sequence.size_hint().unwrap_or(0).min(4096));
        while let Some(byte) = sequence.next_element()? {
            bytes.push(byte);
        }
        Ok(bytes)
    }
}
