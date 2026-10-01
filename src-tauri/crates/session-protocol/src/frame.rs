use crate::{transport, Error, MAX_FRAME_BYTES, VERSION};
use base64::{engine::general_purpose::STANDARD, write::EncoderWriter};
use serde::{
    de::{self, DeserializeOwned, DeserializeSeed},
    Deserialize, Serialize,
};
use std::{
    io::{Read, Write},
    marker::PhantomData,
};

#[derive(Debug, Serialize)]
pub struct Envelope<T> {
    pub version: u32,
    pub body: T,
}

/// Reads one length-prefixed JSON frame. The length is checked before allocation.
///
/// # Errors
/// Rejects oversized frames, unsupported versions, invalid JSON and truncated I/O.
pub fn read_frame<R: Read, T: DeserializeOwned>(reader: &mut R) -> Result<T, Error> {
    let mut size = [0; 4];
    reader.read_exact(&mut size).map_err(transport)?;
    let size = u32::from_be_bytes(size) as usize;
    if size > MAX_FRAME_BYTES {
        return Err(Error::Capacity);
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).map_err(transport)?;
    let mut json = serde_json::Deserializer::from_slice(&bytes);
    let body = VersionedBody(PhantomData)
        .deserialize(&mut json)
        .and_then(|body| json.end().map(|()| body))
        .map_err(|_| Error::InvalidRequest)?;
    body.ok_or(Error::Version)
}

/// Writes one bounded length-prefixed frame.
///
/// # Errors
/// Rejects values exceeding the frame budget and reports transport errors.
pub fn write_frame<W: Write, T: Serialize>(
    writer: &mut W,
    envelope: &Envelope<T>,
) -> Result<(), Error> {
    let mut bytes = LimitedBytes(Vec::new());
    envelope
        .serialize(&mut serde_json::Serializer::with_formatter(
            &mut bytes,
            Base64Bytes,
        ))
        .map_err(|_| Error::Capacity)?;
    let size = u32::try_from(bytes.0.len()).map_err(|_| Error::Capacity)?;
    writer.write_all(&size.to_be_bytes()).map_err(transport)?;
    writer.write_all(&bytes.0).map_err(transport)?;
    writer.flush().map_err(transport)
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum EnvelopeField {
    Version,
    Body,
}

struct VersionedBody<T>(PhantomData<T>);

impl<'de, T: Deserialize<'de>> DeserializeSeed<'de> for VersionedBody<T> {
    type Value = Option<T>;
    fn deserialize<D: de::Deserializer<'de>>(self, deserializer: D) -> Result<Option<T>, D::Error> {
        deserializer.deserialize_struct("Envelope", &["version", "body"], self)
    }
}

impl<'de, T: Deserialize<'de>> de::Visitor<'de> for VersionedBody<T> {
    type Value = Option<T>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a versioned session frame")
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<Option<T>, A::Error> {
        if !matches!(map.next_key()?, Some(EnvelopeField::Version)) {
            return Err(de::Error::missing_field("version"));
        }
        if map.next_value::<u32>()? != VERSION {
            while map
                .next_entry::<de::IgnoredAny, de::IgnoredAny>()?
                .is_some()
            {}
            return Ok(None);
        }
        if !matches!(map.next_key()?, Some(EnvelopeField::Body)) {
            return Err(de::Error::missing_field("body"));
        }
        let body = map.next_value()?;
        if map.next_key::<EnvelopeField>()?.is_some() {
            return Err(de::Error::custom("duplicate envelope field"));
        }
        Ok(Some(body))
    }
}

struct Base64Bytes;
impl serde_json::ser::Formatter for Base64Bytes {
    fn write_byte_array<W: ?Sized + Write>(
        &mut self,
        writer: &mut W,
        value: &[u8],
    ) -> std::io::Result<()> {
        writer.write_all(b"\"")?;
        {
            let mut encoder = EncoderWriter::new(&mut *writer, &STANDARD);
            encoder.write_all(value)?;
            encoder.finish()?;
        }
        writer.write_all(b"\"")
    }
}

struct LimitedBytes(Vec<u8>);
impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_FRAME_BYTES {
            return Err(std::io::Error::other("frame capacity"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
