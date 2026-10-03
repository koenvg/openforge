use std::io::Read;

/// Read one Content-Length-framed test message, retaining its original headers.
/// `prefix_limit` bounds bytes buffered until the header delimiter is found,
/// including any body bytes received in the same read. EOF and read errors return None.
pub(super) fn read(
    stream: &mut impl Read,
    body_limit: usize,
    prefix_limit: usize,
) -> Option<(String, Vec<u8>)> {
    let mut bytes = Vec::new();
    let (end, length) = loop {
        let mut buffer = [0; 4096];
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() <= prefix_limit);
        if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
            let length: usize = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length: "))
                .unwrap()
                .parse()
                .unwrap();
            assert!(length <= body_limit);
            break (end + 4, length);
        }
    };
    while bytes.len() < end + length {
        let mut buffer = [0; 4096];
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Some((
        String::from_utf8(bytes[..end].to_vec()).unwrap(),
        bytes[end..end + length].to_vec(),
    ))
}

#[cfg(test)]
mod tests {
    use super::read;
    use std::io::{Cursor, Read};

    #[test]
    fn reads_fragmented_headers_and_body_without_trailing_bytes() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\ncOnTeNt-LeNgTh: 5\r")
            .chain(Cursor::new(b"\n\r"))
            .chain(Cursor::new(b"\nhe"))
            .chain(Cursor::new(b"lloextra"));

        assert_eq!(
            read(&mut input, 5, 128),
            Some((
                "HTTP/1.1 200 OK\r\ncOnTeNt-LeNgTh: 5\r\n\r\n".into(),
                b"hello".to_vec(),
            ))
        );
    }

    #[test]
    fn reads_empty_body() {
        let mut input = Cursor::new(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n");
        assert_eq!(
            read(&mut input, 0, 128),
            Some((
                "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".into(),
                Vec::new(),
            ))
        );
    }

    #[test]
    fn preserves_binary_body() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n\x00\xff");
        assert_eq!(read(&mut input, 2, 128).unwrap().1, [0, 255]);
    }

    #[test]
    fn returns_none_on_eof_in_headers_or_body() {
        for bytes in [
            b"".as_slice(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r",
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhe",
        ] {
            assert_eq!(read(&mut Cursor::new(bytes), 5, 128), None);
        }
    }

    struct ReadError(std::io::ErrorKind);

    impl Read for ReadError {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(self.0.into())
        }
    }

    #[test]
    fn returns_none_on_timeout_or_read_error_in_headers_or_body() {
        for kind in [
            std::io::ErrorKind::TimedOut,
            std::io::ErrorKind::WouldBlock,
            std::io::ErrorKind::ConnectionReset,
        ] {
            for prefix in [
                b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r".as_slice(),
                b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhe",
            ] {
                let mut input = Cursor::new(prefix).chain(ReadError(kind));
                assert_eq!(read(&mut input, 5, 128), None, "{kind:?}");
            }
        }
    }

    #[test]
    fn accepts_exact_body_and_prefix_limits() {
        let bytes = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello";
        assert_eq!(
            read(&mut Cursor::new(bytes), 5, bytes.len()).unwrap().1,
            b"hello"
        );
    }

    #[test]
    #[should_panic]
    fn rejects_declared_body_over_limit_before_reading_body() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\n");
        read(&mut input, 5, 128);
    }

    #[test]
    #[should_panic]
    fn rejects_prefix_over_limit_without_header_delimiter() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\n");
        read(&mut input, 128, 16);
    }

    #[test]
    #[should_panic]
    fn prefix_limit_includes_body_bytes_received_with_headers() {
        let bytes = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello";
        read(&mut Cursor::new(bytes), 5, bytes.len() - 1);
    }

    #[test]
    fn prefix_limit_does_not_apply_to_later_body_reads() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\nContent-Length: 48\r\n\r\n")
            .chain(Cursor::new([b'x'; 48]));
        assert_eq!(read(&mut input, 48, 40).unwrap().1, [b'x'; 48]);
    }

    #[test]
    #[should_panic]
    fn rejects_missing_content_length() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\n\r\n");
        read(&mut input, 5, 128);
    }

    #[test]
    #[should_panic]
    fn rejects_invalid_content_length() {
        let mut input = Cursor::new(b"HTTP/1.1 200 OK\r\nContent-Length: nope\r\n\r\n");
        read(&mut input, 5, 128);
    }
}
