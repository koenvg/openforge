//! Deterministic loopback provider drives Pi's actual tool-call path without external inference.
use super::*;
use std::io::Write;
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

pub(super) struct Provider {
    pub port: u16,
    complete: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Provider {
    pub fn new(command: String) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let complete = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&complete);
        let thread = std::thread::spawn(move || {
            for index in 0..2 {
                let deadline = Instant::now() + Duration::from_secs(60);
                let mut stream = loop {
                    if stopping.load(Ordering::Acquire) {
                        return;
                    }
                    assert!(
                        Instant::now() < deadline,
                        "Pi did not reach the local model provider"
                    );
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(10))
                        }
                        Err(error) => panic!("{error}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let (headers, body) = super::http::read(&mut stream, 1024 * 1024).unwrap();
                assert!(headers.starts_with("POST /v1/chat/completions "));
                let request: Value = serde_json::from_slice(&body).unwrap();
                let (delta, reason) = if index == 0 {
                    assert!(request["tools"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|tool| tool["function"]["name"] == "bash"));
                    (
                        json!({"role":"assistant","tool_calls":[{"index":0,"id":"call_live","type":"function","function":{"name":"bash","arguments":json!({"command":command,"timeout":90}).to_string()}}]}),
                        "tool_calls",
                    )
                } else {
                    assert!(
                        request["messages"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|message| message["role"] == "tool"
                                && message["content"].to_string().contains("PI_CHILD_FINISHED")),
                        "the real tool result was not returned to the model"
                    );
                    (json!({"role":"assistant","content":"MODEL_DONE"}), "stop")
                };
                let chunk = |delta: Value, finish: Value| json!({"id":"fixture","object":"chat.completion.chunk","created":1,"model":"fixture","choices":[{"index":0,"delta":delta,"finish_reason":finish}]});
                let body = format!(
                    "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                    chunk(delta, Value::Null),
                    chunk(json!({}), json!(reason))
                );
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                count.fetch_add(1, Ordering::Release);
            }
        });
        Self {
            port,
            complete,
            stop,
            thread: Some(thread),
        }
    }
    pub fn completed(&self) -> usize {
        self.complete.load(Ordering::Acquire)
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let joined = self.thread.take().unwrap().join();
        if !std::thread::panicking() {
            assert!(joined.is_ok(), "local provider fixture failed");
        }
    }
}
