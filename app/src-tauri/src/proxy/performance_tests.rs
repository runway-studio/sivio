//! Explicit opt-in real loopback benchmarks; no accounts, user DB or external API.
use super::{server::ProxyServer, ProxyConfig};
use crate::{database::Database, provider::Provider};
use axum::{
    body::Body, extract::State, http::header, response::Response, routing::post, Json, Router,
};
use futures::StreamExt;
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

struct Active(Arc<AtomicUsize>);
impl Drop for Active {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
async fn upstream(State(active): State<Arc<AtomicUsize>>, Json(body): Json<Value>) -> Response {
    let id = body["input"].as_str().unwrap().to_string();
    if body["stream"] != true {
        return Response::builder().header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"id":id,"object":"response","status":"completed","model":"fixture","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}).to_string())).unwrap();
    }
    active.fetch_add(1, Ordering::SeqCst);
    let guard = Active(active);
    let stream = futures::stream::unfold((0usize, id, guard), |(index, id, guard)| async move {
        if index > 601 {
            return None;
        }
        let event = if index == 0 {
            json!({"type":"response.created","response":{"id":id,"object":"response","status":"in_progress","model":"fixture","output":[]}})
        } else if index == 601 {
            json!({"type":"response.completed","response":{"id":id,"status":"completed","model":"fixture","output":[],"usage":{"input_tokens":1,"output_tokens":600,"total_tokens":601}}})
        } else {
            tokio::time::sleep(Duration::from_secs(1)).await;
            json!({"type":"response.output_text.delta","response_id":id,"item_id":"item-fixture","output_index":0,"content_index":0,"delta":format!("{id}:{index:04}")})
        };
        let frame = format!(
            "event: {}\ndata: {}\n\n",
            event["type"].as_str().unwrap(),
            event
        );
        Some((Ok::<_, Infallible>(frame), (index + 1, id, guard)))
    });
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from_stream(stream))
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "10 minute real loopback performance and cancellation acceptance; run explicitly"]
async fn router_performance_and_stream_soak() {
    super::http_client::init(None).unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_url = format!("http://{}/v1/responses", listener.local_addr().unwrap());
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/v1/responses", post(upstream))
        .with_state(active.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let db = Arc::new(Database::memory().unwrap());
    let provider = Provider::with_id(
        "soak-fixture".into(),
        "soak fixture".into(),
        json!({"base_url":base,"auth":{"OPENAI_API_KEY":"fixture-only"}}),
        None,
    );
    db.save_provider("codex", &provider).unwrap();
    db.set_current_provider("codex", &provider.id).unwrap();
    let proxy = ProxyServer::new(
        ProxyConfig {
            listen_port: 0,
            non_streaming_timeout: 10,
            ..Default::default()
        },
        db,
        None,
    );
    let port = proxy.start().await.unwrap().port;
    let proxy_url = format!("http://127.0.0.1:{port}/v1/responses");
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(660))
        .build()
        .unwrap();
    let mut overhead = Vec::new();
    let mut routed = Vec::new();
    for i in 0..105 {
        let mut times = [0.0; 2];
        for (position, url) in [&upstream_url, &proxy_url].into_iter().enumerate() {
            let started = Instant::now();
            let response = client
                .post(url)
                .json(&json!({"model":"fixture","input":format!("nonstream-{i}"),"stream":false}))
                .send()
                .await
                .unwrap();
            assert!(
                response.status().is_success(),
                "{}",
                response.text().await.unwrap()
            );
            let body: Value = response.json().await.unwrap();
            assert_eq!(body["id"], format!("nonstream-{i}"));
            times[position] = started.elapsed().as_secs_f64() * 1000.0;
        }
        if i >= 5 {
            overhead.push((times[1] - times[0]).max(0.0));
            routed.push(times[1]);
        }
    }
    overhead.sort_by(f64::total_cmp);
    routed.sort_by(f64::total_cmp);
    println!(
        "BENCHMARK {}",
        json!({"requests":100,"warmups":5,"p95AddedMs":overhead[94],"p95RoutedMs":routed[94]})
    );
    assert!(overhead[94] <= 50.0, "router overhead p95 exceeded 50ms");
    // Each aborted downstream must release its upstream stream before soak.
    for i in 0..20 {
        let response = client
            .post(&proxy_url)
            .json(&json!({"model":"fixture","input":format!("cancel-{i}"),"stream":true}))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let mut stream = response.bytes_stream();
        assert!(stream.next().await.unwrap().is_ok());
        drop(stream);
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        while active.load(Ordering::SeqCst) != 0 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("cancelled upstream streams leaked");
    println!("BENCHMARK cancellation: 20/20 upstream streams released");
    let started = Instant::now();
    let mut tasks = tokio::task::JoinSet::new();
    for lane in 0..20 {
        let client = client.clone();
        let url = proxy_url.clone();
        tasks.spawn(async move {
            let id = format!("lane-{lane:02}");
            let response = client
                .post(url)
                .json(&json!({"model":"fixture","input":id,"stream":true}))
                .send()
                .await
                .unwrap();
            assert!(response.status().is_success());
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut next = 1;
            while let Some(chunk) = stream.next().await {
                buffer.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap());
                while let Some(end) = buffer.find("\n\n") {
                    let frame: String = buffer.drain(..end + 2).collect();
                    for line in frame.lines().filter_map(|line| line.strip_prefix("data: ")) {
                        let value: Value = serde_json::from_str(line).unwrap();
                        if value["type"] == "response.output_text.delta" {
                            assert_eq!(
                                value["delta"],
                                format!("{id}:{next:04}"),
                                "cross-stream or dropped frame"
                            );
                            next += 1;
                        }
                    }
                }
                assert!(buffer.len() < 65536, "unbounded SSE buffer");
            }
            assert_eq!(next, 601);
        });
    }
    while let Some(task) = tasks.join_next().await {
        task.unwrap();
    }
    assert!(started.elapsed() >= Duration::from_secs(600));
    assert_eq!(active.load(Ordering::SeqCst), 0);
    println!(
        "BENCHMARK {}",
        json!({"concurrency":20,"frames":12000,"durationSeconds":started.elapsed().as_secs_f64(),"crossStream":false,"lostFrames":0})
    );
    proxy.stop().await.unwrap();
    server.abort();
}
