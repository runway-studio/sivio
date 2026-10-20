use super::*;
#[tokio::test]
async fn invalid_or_stale_delay_requests_are_rejected_before_connecting() {
    let state = NetworkState::default();
    let valid =
        json!({"node":"香港 + 1","url":"https://example.com/204","timeout":5000,"generation":1});
    for (key, value) in [
        ("url", json!("file:///etc/passwd")),
        ("url", json!("https://user:secret@example.com")),
        ("timeout", json!(60000)),
        ("node", json!("")),
    ] {
        let mut args = valid.clone();
        args[key] = value;
        assert!(measure(&state, &args).await.is_err());
    }
    assert!(measure(&state, &valid).await.is_err());
}
#[tokio::test]
#[ignore = "requires isolated local core and sockets"]
async fn real_encoded_node_delay_keeps_runtime_responsive_and_rejects_restart() {
    use std::net::Ipv4Addr;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let dir = tempfile::Builder::new()
        .prefix("sivio-delay-")
        .tempdir_in("/private/tmp")
        .unwrap();
    let socket = dir.path().join("control.sock");
    let server = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = server.local_addr().unwrap().port();
    let upstream = tokio::spawn(async move {
        axum::serve(
            server,
            axum::Router::new().route(
                "/204",
                axum::routing::get(|| async {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    axum::http::StatusCode::NO_CONTENT
                }),
            ),
        )
        .await
        .unwrap();
    });
    let core = root.join("build/cache/mihomo/aarch64-apple-darwin/stable/mihomo");
    assert_eq!(
        digest(&std::fs::read(&core).unwrap()),
        core_hash("stable").unwrap()
    );
    std::fs::write(dir.path().join("config.yaml"),format!("mixed-port: 0\nexternal-controller-unix: {}\nproxies:\n  - name: '香港 + 1'\n    type: direct\nproxy-groups:\n  - name: '测速组'\n    type: select\n    proxies: ['香港 + 1', DIRECT]\n  - name: auto-test\n    type: url-test\n    proxies: ['香港 + 1', REJECT]\n    url: http://127.0.0.1:1/204\n    interval: 86400\n    lazy: true\nrules: ['MATCH,测速组']\n",socket.display())).unwrap();
    let mut child = Command::new(core)
        .arg("-d")
        .arg(dir.path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let state = NetworkState::default();
    {
        let mut runtime = state.runtime.lock().await;
        runtime.phase = "running".into();
        runtime.generation = 1;
        runtime.socket = socket;
    }
    for _ in 0..100 {
        if control(&*state.runtime.lock().await, "GET", "/version", None)
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    let args = json!({"node":"香港 + 1","url":format!("http://127.0.0.1:{port}/204"),"timeout":2000,"generation":1});
    let pending = measure(&state, &args);
    let observe = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(
            tokio::time::timeout(Duration::from_millis(30), state.runtime.lock())
                .await
                .unwrap(),
        );
    };
    let (result, _) = tokio::join!(pending, observe);
    let value = result.unwrap();
    assert!(value["delay"].as_u64().unwrap() >= 150);
    assert_eq!(value["generation"], 1);
    control(
        &*state.runtime.lock().await,
        "PUT",
        "/proxies/auto-test",
        Some(json!({"name":"REJECT"})),
    )
    .await
    .unwrap();
    let settings = Settings {
        auto_delay_minutes: 1,
        latency_url: format!("http://127.0.0.1:{port}/204"),
        latency_timeout: 2000,
        ..Default::default()
    };
    let observe = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(
            tokio::time::timeout(Duration::from_millis(30), state.runtime.lock())
                .await
                .unwrap(),
        );
    };
    let (result, _) = tokio::join!(automatic(&state, &settings), observe);
    result.unwrap();
    let group = control(
        &*state.runtime.lock().await,
        "GET",
        "/proxies/auto-test",
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        group["fixed"], "REJECT",
        "background probes must retain the forced choice"
    );
    // Demonstrate the old background endpoint clears the persisted forced
    // selection. `now` may legitimately fail over from an unhealthy REJECT;
    // `fixed` is Mihomo's authoritative manual-selection field.
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("url", &settings.latency_url)
        .append_pair("timeout", "2000")
        .finish();
    let _ = control(
        &*state.runtime.lock().await,
        "GET",
        &format!("/group/auto-test/delay?{query}"),
        None,
    )
    .await;
    let group = control(
        &*state.runtime.lock().await,
        "GET",
        "/proxies/auto-test",
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        group["fixed"], "",
        "old group endpoint reproduces the selection reset"
    );
    let restart = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        state.runtime.lock().await.generation = 2;
    };
    let (result, _) = tokio::join!(measure(&state, &args), restart);
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("changed during delay"));
    child.kill().await.unwrap();
    upstream.abort();
}

#[test]
fn automatic_probes_deduplicate_members_and_exclude_groups_and_rejects() {
    let nodes = automatic_nodes(&json!({"proxies": {
        "one": {"type":"Direct"}, "two": {"type":"Socks5"},
        "REJECT": {"type":"Reject"},
        "nested": {"type":"URLTest","all":["one","two","REJECT"]},
        "outer": {"type":"Selector","all":["nested","one","missing"]}
    }}));
    assert_eq!(nodes, ["one", "two"]);
}
