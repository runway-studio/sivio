//! Synthetic, single-candidate model probes. No production scheduler or breaker access.
use super::{get_adapter, get_claude_api_format, AuthStrategy};
use crate::{app_config::AppType, provider::Provider};
use futures::StreamExt;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug)]
pub(crate) enum Protocol {
    Anthropic,
    Chat,
    Responses,
    Gemini,
}
pub(crate) struct Request {
    url: String,
    headers: http::HeaderMap,
    body: Value,
    protocol: Protocol,
}
pub(crate) fn prepare(
    app: &AppType,
    provider: &Provider,
    model: &str,
) -> Result<Request, &'static str> {
    if !matches!(
        app,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    ) {
        return Err("model_verification_unsupported");
    }
    if model.trim().is_empty() || model.len() > 512 || model.chars().any(char::is_control) {
        return Err("invalid_model");
    }
    if provider.uses_managed_account_auth()
        || (matches!(app, AppType::Codex) && super::is_codex_official_provider(provider))
    {
        return Err("credential_verification_unsupported");
    }
    let adapter = get_adapter(app).ok_or("model_verification_unsupported")?;
    let auth = adapter.extract_auth(provider).ok_or(
        if provider.category.as_deref() == Some("official") {
            "credential_verification_unsupported"
        } else {
            "credentials_missing"
        },
    )?;
    if !matches!(
        auth.strategy,
        AuthStrategy::Anthropic
            | AuthStrategy::ClaudeAuth
            | AuthStrategy::Bearer
            | AuthStrategy::Google
    ) || auth.api_key.is_empty()
        || auth.api_key.starts_with("ya29.")
    {
        return Err("credential_verification_unsupported");
    }
    let base = adapter
        .extract_base_url(provider)
        .map_err(|_| "endpoint_invalid")?;
    let protocol = match app {
        AppType::Claude => match get_claude_api_format(provider) {
            "openai_chat" => Protocol::Chat,
            "openai_responses" => Protocol::Responses,
            "gemini_native" => Protocol::Gemini,
            _ => Protocol::Anthropic,
        },
        AppType::Gemini => Protocol::Gemini,
        _ if super::codex::codex_provider_uses_anthropic(provider) => Protocol::Anthropic,
        _ if super::codex::codex_provider_uses_chat_completions(provider) => Protocol::Chat,
        _ => Protocol::Responses,
    };
    let prompt = "Reply with OK.";
    let (endpoint, body) = match protocol {
        Protocol::Anthropic => (
            "/v1/messages".into(),
            json!({"model": model, "max_tokens":16,"stream":true,"messages":[{"role":"user","content":prompt}]}),
        ),
        Protocol::Chat => (
            "/v1/chat/completions".into(),
            json!({"model":model,"max_tokens":16,"stream":true,"messages":[{"role":"user","content":prompt}]}),
        ),
        Protocol::Responses => (
            "/v1/responses".into(),
            json!({"model":model,"max_output_tokens":16,"stream":true,"input":prompt,"store":false}),
        ),
        Protocol::Gemini => {
            // Encode model as a single path component, never as an endpoint supplied by UI.
            let model: String = url::form_urlencoded::byte_serialize(model.as_bytes()).collect();
            (
                format!("/v1beta/models/{model}:streamGenerateContent?alt=sse"),
                json!({"contents":[{"role":"user","parts":[{"text":prompt}]}],"generationConfig":{"maxOutputTokens":16}}),
            )
        }
    };
    let url = if provider
        .meta
        .as_ref()
        .and_then(|m| m.is_full_url)
        .unwrap_or(false)
    {
        base
    } else {
        adapter.build_url(&base, &endpoint)
    };
    let parsed = url::Url::parse(&url).map_err(|_| "endpoint_invalid")?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("endpoint_invalid");
    }
    if crate::proxy::http_client::is_loopback_url(&url)
        && [16721, crate::proxy::http_client::get_proxy_port()]
            .contains(&parsed.port_or_known_default().unwrap_or(0))
    {
        return Err("endpoint_invalid");
    }
    let mut headers = http::HeaderMap::new();
    for (key, value) in adapter
        .get_auth_headers(&auth)
        .map_err(|_| "credentials_invalid")?
    {
        headers.insert(key, value);
    }
    headers.insert(
        "content-type",
        http::HeaderValue::from_static("application/json"),
    );
    if matches!(protocol, Protocol::Anthropic) {
        headers.insert(
            "anthropic-version",
            http::HeaderValue::from_static("2023-06-01"),
        );
    }
    Ok(Request {
        url,
        headers,
        body,
        protocol,
    })
}

fn text(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty())
}
fn text_parts(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|parts| parts.iter().any(|p| text(p.get("text"))))
}
#[derive(Default)]
struct Evidence {
    text: bool,
    terminal: bool,
    error: bool,
}
impl Evidence {
    fn observe(&mut self, p: Protocol, v: &Value) {
        self.error |= v.get("error").is_some()
            || matches!(
                v.get("type").and_then(Value::as_str),
                Some("error" | "response.failed" | "response.incomplete")
            );
        match p {
            Protocol::Anthropic => {
                self.text |= text(v.pointer("/delta/text"))
                    || text(v.pointer("/content_block/text"))
                    || text_parts(v.get("content"));
                self.terminal |= v.get("type").and_then(Value::as_str) == Some("message_stop")
                    || v.get("stop_reason").is_some_and(|x| !x.is_null());
            }
            Protocol::Chat => {
                if let Some(choices) = v.get("choices").and_then(Value::as_array) {
                    for choice in choices {
                        self.text |= text(choice.pointer("/delta/content"))
                            || text(choice.pointer("/message/content"));
                        self.terminal |= matches!(
                            choice.get("finish_reason").and_then(Value::as_str),
                            Some("stop" | "length")
                        );
                    }
                }
            }
            Protocol::Responses => {
                self.text |= v.get("type").and_then(Value::as_str)
                    == Some("response.output_text.delta")
                    && text(v.get("delta"));
                let response = v.get("response").unwrap_or(v);
                self.text |= response
                    .get("output")
                    .and_then(Value::as_array)
                    .is_some_and(|items| items.iter().any(|i| text_parts(i.get("content"))));
                self.terminal |=
                    response.get("status").and_then(Value::as_str) == Some("completed");
            }
            Protocol::Gemini => {
                if let Some(candidates) = v.get("candidates").and_then(Value::as_array) {
                    for c in candidates {
                        self.text |= text_parts(c.pointer("/content/parts"));
                        self.terminal |= matches!(
                            c.get("finishReason").and_then(Value::as_str),
                            Some("STOP" | "MAX_TOKENS")
                        );
                    }
                }
            }
        }
    }
    fn result(&self) -> Result<(), &'static str> {
        if self.error {
            Err("upstream_error")
        } else if self.text && self.terminal {
            Ok(())
        } else {
            Err("no_valid_model_response")
        }
    }
}
/// Caller owns the total deadline and cancellation; dropping this future drops the body stream.
pub(crate) async fn send(client: reqwest::Client, request: Request) -> Result<(), &'static str> {
    let response = client
        .post(&request.url)
        .headers(request.headers)
        .json(&request.body)
        .send()
        .await
        .map_err(|_| "outbound_failed")?;
    match response.status().as_u16() {
        401 | 403 => return Err("authentication_failed"),
        429 => return Err("rate_limited"),
        500..=599 => return Err("upstream_failed"),
        200..=299 => {}
        _ => return Err("upstream_rejected"),
    }
    let sse = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    let mut total = 0;
    let mut evidence = Evidence::default();
    // Keep only incomplete SSE frames and stop at the protocol terminal, not TCP EOF.
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "response_interrupted")?;
        total += chunk.len();
        if total > 256 * 1024 {
            return Err("response_too_large");
        }
        bytes.extend_from_slice(&chunk);
        if sse {
            while let Some(end) = bytes.iter().enumerate().find_map(|(i, _)| {
                if bytes[i..].starts_with(b"\n\n") {
                    Some(i + 2)
                } else if bytes[i..].starts_with(b"\r\n\r\n") {
                    Some(i + 4)
                } else {
                    None
                }
            }) {
                let frame = std::str::from_utf8(&bytes[..end]).map_err(|_| "invalid_response")?;
                let data = frame
                    .lines()
                    .filter_map(|l| l.strip_prefix("data:"))
                    .map(str::trim_start)
                    .collect::<Vec<_>>()
                    .join("\n");
                if !data.is_empty() && data != "[DONE]" {
                    evidence.observe(
                        request.protocol,
                        &serde_json::from_str::<Value>(&data).map_err(|_| "invalid_response")?,
                    );
                }
                bytes.drain(..end);
                if evidence.error || evidence.terminal {
                    return evidence.result();
                }
            }
        }
    }
    if !sse {
        evidence.observe(
            request.protocol,
            &serde_json::from_slice::<Value>(&bytes).map_err(|_| "invalid_response")?,
        );
    }
    evidence.result()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::post, Router};
    use std::sync::{Arc, Mutex};
    fn provider(app: &AppType, base: &str) -> Provider {
        let config = match app {
            AppType::Claude => {
                json!({"env":{"ANTHROPIC_BASE_URL":base,"ANTHROPIC_AUTH_TOKEN":"fixture-key"}})
            }
            AppType::Gemini => {
                json!({"env":{"GOOGLE_GEMINI_BASE_URL":base,"GEMINI_API_KEY":"fixture-key"}})
            }
            _ => json!({"base_url":base,"auth":{"OPENAI_API_KEY":"fixture-key"}}),
        };
        Provider::with_id("p".into(), "Fixture".into(), config, None)
    }
    #[tokio::test]
    async fn four_clients_send_one_fixed_prompt_and_validate_json() {
        for (app, body) in [
            (
                AppType::Claude,
                json!({"content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn"}),
            ),
            (
                AppType::Codex,
                json!({"status":"completed","output":[{"content":[{"type":"output_text","text":"OK"}]}]}),
            ),
            (
                AppType::GrokBuild,
                json!({"status":"completed","output":[{"content":[{"text":"OK"}]}]}),
            ),
            (
                AppType::Gemini,
                json!({"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}),
            ),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let received = Arc::new(Mutex::new(Vec::new()));
            let capture = received.clone();
            let router = Router::new().fallback(post(
                move |headers: axum::http::HeaderMap, axum::Json(input): axum::Json<Value>| {
                    let received = capture.clone();
                    let body = body.clone();
                    async move {
                        received.lock().unwrap().push((headers, input));
                        axum::Json(body)
                    }
                },
            ));
            let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
            let request = prepare(&app, &provider(&app, &base), "fixture-model").unwrap();
            assert!(send(
                reqwest::Client::builder().no_proxy().build().unwrap(),
                request
            )
            .await
            .is_ok());
            let requests = received.lock().unwrap();
            assert_eq!(requests.len(), 1);
            let body = &requests[0].1;
            assert!(body.to_string().contains("Reply with OK."));
            assert!(!body.to_string().contains("fixture-key"));
            assert!(
                requests[0].0.contains_key("authorization")
                    || requests[0].0.contains_key("x-goog-api-key")
            );
            server.abort();
        }
    }
    async fn response(
        status: u16,
        content_type: &'static str,
        body: &'static str,
    ) -> Result<(), &'static str> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new().fallback(post(move || async move {
            (
                StatusCode::from_u16(status).unwrap(),
                [("content-type", content_type)],
                body,
            )
        }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let result = send(
            reqwest::Client::builder().no_proxy().build().unwrap(),
            prepare(&AppType::Claude, &provider(&AppType::Claude, &base), "m").unwrap(),
        )
        .await;
        server.abort();
        result
    }
    #[tokio::test]
    async fn http_success_is_not_model_success_and_errors_are_classified() {
        for (status, reason) in [
            (401, "authentication_failed"),
            (403, "authentication_failed"),
            (429, "rate_limited"),
            (500, "upstream_failed"),
            (400, "upstream_rejected"),
        ] {
            assert_eq!(
                response(status, "application/json", "{}").await,
                Err(reason)
            );
        }
        assert_eq!(
            response(200, "application/json", "{}").await,
            Err("no_valid_model_response")
        );
        assert_eq!(
            response(200, "application/json", r#"{"content":[{"text":"OK"}]}"#).await,
            Err("no_valid_model_response")
        );
    }
    #[tokio::test]
    async fn sse_requires_content_and_terminal_without_error() {
        let success="data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"OK\"}}\r\n\r\ndata: {\"type\":\"message_stop\"}\r\n\r\n";
        assert_eq!(response(200, "text/event-stream", success).await, Ok(()));
        assert_eq!(
            response(
                200,
                "text/event-stream",
                "data: {\"type\":\"message_stop\"}\n\n"
            )
            .await,
            Err("no_valid_model_response")
        );
        assert_eq!(
            response(
                200,
                "text/event-stream",
                "data: {\"type\":\"error\",\"error\":{}}\n\n"
            )
            .await,
            Err("upstream_error")
        );
    }
    #[tokio::test]
    async fn fragmented_sse_finishes_without_waiting_for_connection_close() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new().fallback(post(|| async {
            let chunks = futures::stream::iter([
                Ok::<_, std::io::Error>(
                    "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"OK\"}}\r",
                ),
                Ok("\n\r\ndata: {\"type\":\"message_stop\"}\n"),
                Ok("\n"),
            ])
            .chain(futures::stream::pending());
            (
                [("content-type", "text/event-stream")],
                axum::body::Body::from_stream(chunks),
            )
        }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            send(
                reqwest::Client::builder().no_proxy().build().unwrap(),
                prepare(&AppType::Claude, &provider(&AppType::Claude, &base), "m").unwrap(),
            ),
        )
        .await;
        server.abort();
        assert_eq!(result.unwrap(), Ok(()));
    }
    #[tokio::test]
    async fn waiting_body_can_be_dropped_on_cancel_or_timeout() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let router =
            Router::new().fallback(post(|| async { std::future::pending::<String>().await }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let request = prepare(&AppType::Claude, &provider(&AppType::Claude, &base), "m").unwrap();
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(30),
            send(reqwest::Client::new(), request)
        )
        .await
        .is_err());
        let request = prepare(&AppType::Claude, &provider(&AppType::Claude, &base), "m").unwrap();
        let (tx, mut rx) = tokio::sync::watch::channel(false);
        let worker = tokio::spawn(async move {
            tokio::select! { _=rx.changed()=>true, _=send(reqwest::Client::new(),request)=>false }
        });
        tx.send(true).unwrap();
        assert!(worker.await.unwrap());
        server.abort();
    }
    #[test]
    fn managed_and_non_gateway_credentials_are_explicitly_unsupported() {
        let mut p = provider(&AppType::Claude, "https://example.invalid");
        p.category = Some("official".into());
        assert_eq!(
            prepare(&AppType::Codex, &p, "m").err(),
            Some("credential_verification_unsupported")
        );
        assert_eq!(
            prepare(&AppType::OpenCode, &p, "m").err(),
            Some("model_verification_unsupported")
        );
    }
}
