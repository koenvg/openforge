use super::{GitHubClient, GitHubError};
use serde::de::DeserializeOwned;

const PAGE_SIZE: usize = 100;

impl GitHubClient {
    pub(super) async fn get_all_pages<T: DeserializeOwned>(
        &self,
        url: &str,
        token: &str,
    ) -> Result<Vec<T>, GitHubError> {
        let separator = if url.contains('?') { '&' } else { '?' };
        let mut page = 1;
        let mut all_items = Vec::new();

        loop {
            let page_url = format!("{url}{separator}page={page}");
            let mut items: Vec<T> = self.get_with_etag(&page_url, token).await?;
            let page_was_full = items.len() == PAGE_SIZE;
            all_items.append(&mut items);
            if !page_was_full {
                return Ok(all_items);
            }
            page += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::Query, routing::get, Json, Router};
    use std::collections::HashMap;

    #[tokio::test]
    async fn fetches_every_full_page() {
        async fn items(
            Query(query): Query<HashMap<String, String>>,
        ) -> Json<Vec<serde_json::Value>> {
            let page = query
                .get("page")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1);
            let count = if page == 1 { PAGE_SIZE } else { 1 };
            Json(
                (0..count)
                    .map(|index| serde_json::json!({ "page": page, "index": index }))
                    .collect(),
            )
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = tokio::spawn(async move {
            axum::serve(listener, Router::new().route("/items", get(items)))
                .await
                .expect("serve paginated fixture");
        });
        let client = GitHubClient::new();

        let items: Vec<serde_json::Value> = client
            .get_all_pages(&format!("http://{address}/items?per_page=100"), "token")
            .await
            .expect("fetch every page");

        server.abort();
        assert_eq!(items.len(), 101);
        assert_eq!(items[100]["page"], 2);
    }
}
