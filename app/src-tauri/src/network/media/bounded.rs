//! Public media endpoints are still untrusted response bodies.
use anyhow::{ensure, Result};
use serde::de::DeserializeOwned;
pub(super) trait BoundedResponse {
    fn bounded_text(self) -> impl std::future::Future<Output = Result<String>> + Send;
    fn bounded_json<T: DeserializeOwned + Send>(
        self,
    ) -> impl std::future::Future<Output = Result<T>> + Send;
}
impl BoundedResponse for reqwest::Response {
    async fn bounded_text(mut self) -> Result<String> {
        self = self.error_for_status()?;
        const LIMIT: usize = 3 * 1024 * 1024;
        ensure!(
            self.content_length().unwrap_or(0) <= LIMIT as u64,
            "media response exceeds limit"
        );
        let mut body = Vec::new();
        while let Some(chunk) = self.chunk().await? {
            ensure!(
                body.len() + chunk.len() <= LIMIT,
                "media response exceeds limit"
            );
            body.extend_from_slice(&chunk);
        }
        Ok(String::from_utf8_lossy(&body).into_owned())
    }
    async fn bounded_json<T: DeserializeOwned + Send>(self) -> Result<T> {
        Ok(serde_json::from_str(&self.bounded_text().await?)?)
    }
}
