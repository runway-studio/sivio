use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

// Real Unix HTTP framing and deliberately delayed frames exercise the same
// bounded reader used by ordinary and helper-controlled Mihomo.
async fn fixture() -> (tempfile::TempDir, NetworkState, tokio::task::JoinHandle<()>) {
    let dir = tempfile::Builder::new().prefix("sivio-metrics-").tempdir_in("/private/tmp").unwrap();
    let socket = dir.path().join("control.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let server = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut stream = BufReader::new(stream);
                let mut line = String::new();
                stream.read_line(&mut line).await.unwrap();
                let memory = line.contains("/memory");
                stream.get_mut().write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n").await.unwrap();
                tokio::time::sleep(Duration::from_millis(60)).await;
                let first = if memory { "{\"inuse\":0,\"oslimit\":0}\n" } else { "{\"up\":23,\"down\":45,\"upTotal\":67,\"downTotal\":89}\n" };
                let _ = stream.get_mut().write_all(first.as_bytes()).await;
                if memory {
                    tokio::time::sleep(Duration::from_millis(350)).await;
                    let _ = stream.get_mut().write_all(b"{\"inuse\":6543,\"oslimit\":0}\n").await;
                }
            });
        }
    });
    let state = NetworkState::default();
    {
        let mut runtime = state.runtime.lock().await;
        runtime.phase = "running".into();
        runtime.generation = 7;
        runtime.socket = socket;
    }
    (dir, state, server)
}

#[tokio::test]
async fn slow_memory_does_not_block_traffic_or_runtime_and_totals_stay_authoritative() {
    let (_dir, state, server) = fixture().await;
    let traffic = async { sample(&state, &json!({"metric":"traffic","generation":7})).await };
    let memory = async { sample(&state, &json!({"metric":"memory","generation":7})).await };
    let observer = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        drop(tokio::time::timeout(Duration::from_millis(30), state.runtime.lock()).await.unwrap());
    };
    let started = std::time::Instant::now();
    let traffic = async {
        let result = traffic.await.unwrap();
        assert!(started.elapsed() < Duration::from_millis(300));
        assert_eq!(result["traffic"]["upTotal"], 67);
        assert!(result.get("memory").is_none());
    };
    let (_, memory, _) = tokio::join!(traffic, memory, observer);
    assert_eq!(memory.unwrap()["memory"]["inuse"], 6543);
    server.abort();
}

#[tokio::test]
async fn stopped_or_restarted_core_rejects_late_samples_and_unknown_metrics() {
    let (_dir, state, server) = fixture().await;
    assert!(sample(&state, &json!({"metric":"connections"})).await.is_err());
    assert!(sample(&state, &json!({"metric":"traffic","generation":6})).await.is_err());
    for restart in [false, true] {
        {
            let mut runtime = state.runtime.lock().await;
            runtime.phase = "running".into();
            runtime.generation = 7;
        }
        let pending = async { sample(&state, &json!({"metric":"memory","generation":7})).await };
        let change = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let mut runtime = state.runtime.lock().await;
            if restart { runtime.generation += 1; } else { runtime.phase = "stopped".into(); }
        };
        let (result, _) = tokio::join!(pending, change);
        assert!(result.unwrap_err().to_string().contains("changed during sampling"));
    }
    server.abort();
}

#[tokio::test]
async fn legacy_combined_response_remains_supported() {
    let (_dir, state, server) = fixture().await;
    let result = sample(&state, &json!({})).await.unwrap();
    assert_eq!(result["traffic"]["downTotal"], 89);
    assert_eq!(result["memory"]["inuse"], 6543);
    assert_eq!(result["generation"], 7);
    server.abort();
}

#[tokio::test]
#[ignore = "requires bundled Mihomo and permission for isolated local sockets"]
async fn real_core_metric_cadence_benchmark() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap();
    let dir = tempfile::Builder::new().prefix("sivio-traffic-").tempdir_in("/private/tmp").unwrap();
    let socket = dir.path().join("control.sock");
    let core = root.join("build/cache/mihomo/aarch64-apple-darwin/stable/mihomo");
    assert_eq!(digest(&std::fs::read(&core).unwrap()), core_hash("stable").unwrap());
    std::fs::write(dir.path().join("config.yaml"), format!("mixed-port: 0\nmode: direct\nexternal-controller-unix: {}\nrules: ['MATCH,DIRECT']\n", socket.display())).unwrap();
    let mut child = Command::new(core).arg("-d").arg(dir.path()).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true).spawn().unwrap();
    let state = NetworkState::default();
    {
        let mut runtime = state.runtime.lock().await;
        runtime.phase = "running".into(); runtime.generation = 1; runtime.socket = socket;
    }
    for _ in 0..100 {
        if control(&*state.runtime.lock().await, "GET", "/version", None).await.is_ok() { break; }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let baseline = async {
        // Original production implementation, retained here for comparison:
        // joined traffic + second memory frame, followed by query's 1s delay.
        let mut times = vec![];
        let start = std::time::Instant::now();
        for _ in 0..3 {
            {
                let runtime = state.runtime.lock().await;
                let (traffic, memory) = tokio::join!(control(&runtime,"GET","/traffic",None), control(&runtime,"GET","/memory",None));
                assert!(traffic.is_ok() && memory.is_ok());
            }
            times.push(start.elapsed().as_secs_f64() * 1000.0);
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        times
    }.await;
    let memory = async { sample(&state, &json!({"metric":"memory","generation":1})).await };
    let optimized = async {
        let mut times = vec![];
        let start = std::time::Instant::now();
        for _ in 0..3 {
            sample(&state,&json!({"metric":"traffic","generation":1})).await.unwrap();
            times.push(start.elapsed().as_secs_f64() * 1000.0);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        times
    };
    let (optimized, memory) = tokio::join!(optimized, memory);
    assert!(memory.unwrap()["memory"]["inuse"].as_u64().unwrap() > 0);
    let old_interval = (baseline[2] - baseline[0]) / 2.0;
    let new_interval = (optimized[2] - optimized[0]) / 2.0;
    let report = json!({"source":"real pinned Mihomo v1.19.32, isolated Unix socket; original joined reader vs independent reader; renderer timer delays included", "baselineSampleTimesMs":baseline,"optimizedSampleTimesMs":optimized,"baselineMeanIntervalMs":old_interval,"optimizedMeanIntervalMs":new_interval});
    std::fs::write(root.join("build/reports/traffic-native-cadence.json"),serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    assert!(new_interval < old_interval * 0.6, "{report}");
    child.kill().await.unwrap();
}
