//! Optional authenticated loopback dashboard bridge. Root Mihomo retains its Unix-only controller.
use super::*;
use anyhow::Context as _;
use axum::{
    body::Bytes,
    extract::ws::{Message, WebSocketUpgrade},
    extract::{DefaultBodyLimit, OriginalUri, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get},
    Router,
};
#[derive(Clone)]
struct Context {
    app: tauri::AppHandle,
    state: NetworkState,
    generation: u64,
    streams: Arc<tokio::sync::Semaphore>,
    mutations: Arc<tokio::sync::Semaphore>,
}
#[derive(Clone)]
struct Access {
    secret: String,
    origins: Vec<String>,
    permits: Arc<tokio::sync::Semaphore>,
}

fn origin_allowed(headers: &HeaderMap, origins: &[String]) -> bool {
    headers.get("origin").map_or(true, |origin| {
        origin
            .to_str()
            .is_ok_and(|value| origins.iter().any(|allowed| allowed == value))
    })
}
fn authorized(headers: &HeaderMap, secret: &str) -> bool {
    let Some(token) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return false;
    };
    use subtle::ConstantTimeEq;
    token.as_bytes().ct_eq(secret.as_bytes()).into()
}
async fn guard(
    State(context): State<Access>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    if !origin_allowed(headers, &context.origins) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let origin = headers.get("origin").cloned();
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else if !authorized(headers, &context.secret)
        && !(request.method() == Method::GET
            && headers
                .get("upgrade")
                .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"websocket"))
            && ["/traffic", "/memory", "/connections", "/logs"].contains(&request.uri().path())
            && url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes()).any(
                |(key, value)| {
                    use subtle::ConstantTimeEq;
                    key == "token" && bool::from(value.as_bytes().ct_eq(context.secret.as_bytes()))
                },
            ))
    {
        StatusCode::UNAUTHORIZED.into_response()
    } else {
        let Ok(_permit) = context.permits.clone().try_acquire_owned() else {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        };
        match tokio::time::timeout(Duration::from_secs(8), next.run(request)).await {
            Ok(response) => response,
            Err(_) => StatusCode::GATEWAY_TIMEOUT.into_response(),
        }
    };
    let headers = response.headers_mut();
    if let Some(origin) = origin {
        headers.insert("access-control-allow-origin", origin);
        headers.insert("vary", HeaderValue::from_static("Origin"));
    }
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, PUT, PATCH, POST, DELETE, OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("Authorization, Content-Type"),
    );
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    if response.status() != StatusCode::SWITCHING_PROTOCOLS {
        response
            .headers_mut()
            .insert("connection", HeaderValue::from_static("close"));
    }
    response
}
async fn request(
    State(context): State<Context>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    bytes: Bytes,
) -> Response {
    let mutation = method != Method::GET;
    let mutations = context.mutations.clone();
    let result = async move {
        let generation = context.state.runtime.lock().await.generation;
        ensure!(
            generation == context.generation,
            "Network generation changed"
        );
        let body = if bytes.is_empty() {
            None
        } else {
            Some(serde_json::from_slice::<Value>(&bytes)?)
        };
        let path = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
        if method == Method::PATCH && path == "/configs" {
            let body = body.context("Mode required")?;
            ensure!(
                body.as_object().is_some_and(|v| v.len() == 1),
                "Only mode can be changed through the dashboard"
            );
            let mode = text(&body, "mode")?;
            ensure!(["rule", "global", "direct"].contains(&mode), "Invalid mode");
            return super::shortcut_generation(
                &context.app,
                &format!("clash_mode_{mode}"),
                Some(context.generation),
            )
            .await;
        }
        super::controller_request(&context.state, json!({"method":method.as_str(),"path":path,"body":body,"expectedGeneration":context.generation})).await
    };
    // Once dispatched, a mode/node mutation finishes even if the browser disconnects
    // or its HTTP deadline expires. Keep one owned permit until completion; callers
    // cannot accumulate detached writes while a restart or Keychain access is slow.
    let result = if mutation {
        match mutations.try_acquire_owned() {
            Ok(permit) => tokio::spawn(async move {
                let _permit = permit;
                result.await
            })
            .await
            .unwrap_or_else(|_| Err(anyhow::anyhow!("Controller operation interrupted"))),
            Err(_) => return StatusCode::TOO_MANY_REQUESTS.into_response(),
        }
    } else {
        result.await
    };
    match result {Ok(value)=>axum::Json(value).into_response(),Err(_)=>(StatusCode::BAD_REQUEST,axum::Json(json!({"message":"Unsupported operation or unavailable network; use Sivio for service and configuration changes"}))).into_response()}
}
async fn live(
    State(context): State<Context>,
    OriginalUri(uri): OriginalUri,
    websocket: Option<WebSocketUpgrade>,
) -> Response {
    let path = uri.path().to_owned();
    let Some(websocket) = websocket else {
        return match super::controller_request(
            &context.state,
            json!({"method":"GET","path":path,"expectedGeneration":context.generation}),
        )
        .await
        {
            Ok(value) => axum::Json(value).into_response(),
            Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
    };
    let Ok(permit) = context.streams.clone().try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let level = url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .find(|(k, _)| k == "level")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| "info".into());
    websocket.max_message_size(16*1024).max_frame_size(16*1024).write_buffer_size(4096).max_write_buffer_size(2*1024*1024).on_upgrade(move |mut socket| async move {
        let _permit=permit;
        let mut cursor=ipc::log_cursor::LogCursor::default();let mut ordinary=super::log_stream::Cursor::default();
        let mut tick=tokio::time::interval(Duration::from_secs(1));tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                message=socket.recv()=>{if !matches!(message,Some(Ok(Message::Ping(_)|Message::Pong(_)))) {break;}},
                _=tick.tick()=>{
                    let values=tokio::time::timeout(Duration::from_secs(3),async {
                        let runtime=context.state.runtime.lock().await;
                        ensure!(runtime.generation==context.generation && runtime.phase=="running","Network stopped or changed");
                        if path=="/logs" {
                            let (lines,dropped)=if runtime.managed {
                                let response=ipc::get_clash_logs_since(&credentials()?,&cursor).await?;
                                ensure!(response.code==0,"Live logs require helper revision 9");let batch=response.data.context("Log batch unavailable")?;
                                cursor=ipc::log_cursor::LogCursor{stream:Some(batch.stream),after:batch.next};(batch.lines,batch.dropped)
                            } else {super::log_stream::read(&mut ordinary,&root()?.join("runtime/core.log"))?};
                            let active=runtime.active.clone();drop(runtime);
                            let mut values=Vec::new();
                            if dropped {values.push(json!({"type":"warning","payload":"Sivio: older records were dropped by the bounded log buffer"}));}
                            for line in super::redacted_logs(lines,active.as_deref())? {
                                let kind=if line.contains("level=error") || line.contains("[ERROR]") {"error"} else if line.contains("level=warn") || line.contains("[WARN]") {"warning"} else if line.contains("level=debug") || line.contains("[DEBUG]") {"debug"} else {"info"};
                                let rank=|value:&str|match value {"silent"=>5,"error"=>4,"warning"|"warn"=>3,"info"=>2,_=>1};
                                if rank(kind)>=rank(&level) {values.push(json!({"type":kind,"payload":line}));}
                            }
                            Ok::<_,anyhow::Error>(values)
                        } else {Ok(vec![super::control(&runtime,"GET",&path,None).await?])}
                    }).await;
                    let Ok(Ok(values))=values else {break;};
                    for value in values {
                        if !matches!(tokio::time::timeout(Duration::from_secs(3),socket.send(Message::Text(value.to_string()))).await,Ok(Ok(()))) {return;}
                    }
                }
            }
        }
        let _=tokio::time::timeout(Duration::from_secs(1),socket.close()).await;
    }).into_response()
}
pub(super) fn validate(settings: &Settings) -> Result<Vec<String>> {
    ensure!(settings.web_ui_list.len() <= 20, "At most 20 dashboards");
    let mut origins = Vec::new();
    for raw in &settings.web_ui_list {
        ensure!(raw.len() <= 2048, "Dashboard URL is too long");
        let url = url::Url::parse(raw)?;
        ensure!(
            url.username().is_empty() && url.password().is_none() && url.host_str().is_some(),
            "Dashboard URL must not contain credentials"
        );
        ensure!(
            url.scheme() == "https"
                || (url.scheme() == "http" && crate::proxy::http_client::is_loopback_url(raw)),
            "Dashboards require HTTPS or local HTTP"
        );
        origins.push(url.origin().ascii_serialization());
    }
    if settings.controller_enabled {
        ensure!(
            settings.controller_port > 1024
                && settings.controller_secret.len() >= 32
                && settings.controller_secret.len() <= 256
                && settings
                    .controller_secret
                    .bytes()
                    .all(|byte| byte.is_ascii_graphic())
                && !settings
                    .controller_secret
                    .contains(crate::portable_credentials::MISSING),
            "Controller needs an unprivileged port and a 32–256 character connection secret"
        );
    }
    Ok(origins)
}
pub(super) fn start(
    app: &tauri::AppHandle,
    state: &NetworkState,
    settings: &Settings,
    generation: u64,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<tokio::task::JoinHandle<()>>> + Send>>
{
    let app = app.clone();
    let state = state.clone();
    let settings = settings.clone();
    Box::pin(async move {
        let context = Context {
            app: app.clone(),
            state: state.clone(),
            generation,
            streams: Arc::new(tokio::sync::Semaphore::new(4)),
            mutations: Arc::new(tokio::sync::Semaphore::new(1)),
        };
        let access = Access {
            secret: settings.controller_secret.clone(),
            origins: validate(&settings)?,
            permits: Arc::new(tokio::sync::Semaphore::new(4)),
        };
        let listener = tokio::net::TcpListener::bind((
            std::net::Ipv4Addr::LOCALHOST,
            settings.controller_port,
        ))
        .await
        .context("Controller port is occupied; existing process was left untouched")?;
        let router = Router::new()
            .route("/traffic", get(live))
            .route("/memory", get(live))
            .route("/logs", get(live))
            .route("/connections", get(live).delete(request))
            .fallback(any(request))
            .layer(DefaultBodyLimit::max(16 * 1024))
            .layer(middleware::from_fn_with_state(access, guard))
            .with_state(context);
        Ok(tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        }))
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn real_http_rejects_missing_credentials_foreign_origins_and_oversized_bodies() {
        let access = Access {
            secret: "fixture-controller-only-secret-32-chars".into(),
            origins: vec!["https://trusted.invalid".into()],
            permits: Arc::new(tokio::sync::Semaphore::new(4)),
        };
        let app = Router::new()
            .route(
                "/",
                any(|body: Bytes| async move { body.len().to_string() }),
            )
            .layer(DefaultBodyLimit::max(16 * 1024))
            .layer(middleware::from_fn_with_state(access.clone(), guard));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("http://{address}/");
        assert_eq!(client.get(&url).send().await.unwrap().status(), 401);
        assert_eq!(
            client
                .get(&url)
                .bearer_auth(&access.secret)
                .header("origin", "https://attacker.invalid")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        let response = client
            .get(&url)
            .bearer_auth(&access.secret)
            .header("origin", "https://trusted.invalid")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            "https://trusted.invalid"
        );
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(&access.secret)
                .body(vec![b'x'; 20 * 1024])
                .send()
                .await
                .unwrap()
                .status(),
            413
        );
        server.abort();
    }
    #[tokio::test]
    async fn websocket_query_auth_is_limited_to_read_only_streams_and_exact_origins() {
        use futures::StreamExt;
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let access = Access {
            secret: "fixture-controller-only-secret-32-chars".into(),
            origins: vec!["https://trusted.invalid".into()],
            permits: Arc::new(tokio::sync::Semaphore::new(4)),
        };
        async fn upgrade(socket: WebSocketUpgrade) -> Response {
            socket
                .on_upgrade(|mut socket| async move {
                    let _ = socket.send(Message::Text("fixture".into())).await;
                })
                .into_response()
        }
        let router = Router::new()
            .route("/traffic", get(upgrade))
            .route("/configs", get(upgrade))
            .layer(middleware::from_fn_with_state(access.clone(), guard));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let uri = format!("ws://{address}/traffic?token={}", access.secret);
        let mut request = uri.clone().into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", "https://trusted.invalid".parse().unwrap());
        let (mut socket, response) = tokio_tungstenite::connect_async(request).await.unwrap();
        assert_eq!(response.status(), 101);
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            "fixture"
        );
        for (path, origin, expected) in [
            ("/traffic", "https://attacker.invalid", 403),
            ("/configs", "https://trusted.invalid", 401),
        ] {
            let mut request = format!("ws://{address}{path}?token={}", access.secret)
                .into_client_request()
                .unwrap();
            request
                .headers_mut()
                .insert("origin", origin.parse().unwrap());
            let error = tokio_tungstenite::connect_async(request).await.unwrap_err();
            let tokio_tungstenite::tungstenite::Error::Http(response) = error else {
                panic!("expected HTTP rejection")
            };
            assert_eq!(response.status().as_u16(), expected);
        }
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/traffic?token={}", access.secret))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 401);
        server.abort();
    }
    #[test]
    fn dashboard_auth_and_origins_never_allow_untrusted_browser_origins() {
        let mut headers = HeaderMap::new();
        let secret = "fixture-test-only-secret-at-least-32";
        assert!(!authorized(&headers, secret));
        headers.insert("authorization", format!("Bearer {secret}").parse().unwrap());
        assert!(authorized(&headers, secret));
        assert!(!authorized(
            &headers,
            "another-test-only-secret-at-least-32"
        ));
        headers.insert(
            "origin",
            HeaderValue::from_static("https://attacker.invalid"),
        );
        assert!(!origin_allowed(
            &headers,
            &["https://trusted.invalid".into()]
        ));
        let settings = Settings {
            controller_enabled: true,
            controller_secret: secret.into(),
            web_ui_list: vec!["https://trusted.invalid/dashboard".into()],
            ..Default::default()
        };
        assert_eq!(
            validate(&settings).unwrap(),
            vec!["https://trusted.invalid"]
        );
        assert!(validate(&Settings {
            controller_secret: "short".into(),
            ..settings
        })
        .is_err());
    }
}
