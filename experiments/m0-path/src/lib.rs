use axum::{body::{Body, to_bytes}, extract::{Request, State}, http::StatusCode, response::Response, Router};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
pub enum Outbound { Direct, ManagedNetwork(reqwest::Url), CustomProxy(reqwest::Url) }

#[derive(Clone)]
pub struct Route {
    upstream: reqwest::Url,
    client: reqwest::Client,
}

impl Route {
    pub fn new(upstream: reqwest::Url, outbound: Outbound) -> Result<Self, String> {
        if !matches!(upstream.scheme(), "http"|"https") { return Err("INVALID_UPSTREAM_SCHEME".into()); }
        let mut builder = reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(2))
            .redirect(reqwest::redirect::Policy::none());
        match outbound {
            Outbound::Direct => {},
            Outbound::ManagedNetwork(proxy)|Outbound::CustomProxy(proxy) => {
                if !matches!(proxy.scheme(), "http"|"https") { return Err("INVALID_PROXY_SCHEME".into()); }
                builder = builder.proxy(reqwest::Proxy::all(proxy.as_str()).map_err(|_| "INVALID_PROXY")?);
            }
        }
        Ok(Self { upstream, client:builder.build().map_err(|_| "CLIENT_BUILD")? })
    }
}

pub fn router(route: Route) -> Router {
    Router::new().fallback(forward).with_state(Arc::new(route))
}

async fn forward(State(route): State<Arc<Route>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let body = match to_bytes(body, 16*1024*1024).await {
        Ok(body) => body,
        Err(_) => return Response::builder().status(StatusCode::PAYLOAD_TOO_LARGE).body(Body::empty()).unwrap(),
    };
    let mut url = route.upstream.clone();
    url.set_path(parts.uri.path());url.set_query(parts.uri.query());
    let mut upstream = route.client.request(parts.method, url).body(body);
    for (key,value) in &parts.headers {
        if !matches!(key.as_str(),"host"|"connection"|"content-length"|"transfer-encoding"|"proxy-authorization"|"proxy-connection"|"upgrade"|"te"|"trailer"|"keep-alive") {
            upstream=upstream.header(key,value);
        }
    }
    match upstream.send().await {
        Ok(response) => {
            let mut builder=Response::builder().status(response.status().as_u16());
            for (key,value) in response.headers() {
                if !matches!(key.as_str(),"connection"|"content-length"|"transfer-encoding"|"upgrade"|"te"|"trailer"|"keep-alive") { builder=builder.header(key,value); }
            }
            builder.body(Body::from_stream(response.bytes_stream())).unwrap()
        },
        Err(_) => Response::builder().status(StatusCode::BAD_GATEWAY).body(Body::from("OUTBOUND_UNAVAILABLE")).unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, extract::State};
    use futures::StreamExt;
    use std::{io::Write, sync::atomic::{AtomicUsize,Ordering}};

    struct Server { address:std::net::SocketAddr, task:tokio::task::JoinHandle<()> }
    impl Drop for Server { fn drop(&mut self) { self.task.abort(); } }
    async fn serve(app:Router)->Server {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address=listener.local_addr().unwrap();
        let task=tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        Server{address,task}
    }
    async fn fixture(State(hits):State<Arc<AtomicUsize>>,body:String)->Response {
        hits.fetch_add(1,Ordering::SeqCst);
        if body=="stream" {
            let chunks=async_stream::stream! {
                yield Ok::<_,std::io::Error>("data: first\n\n");
                tokio::time::sleep(Duration::from_secs(2)).await;
                yield Ok::<_,std::io::Error>("data: second\n\n");
            };
            Response::builder().header("content-type","text/event-stream").body(Body::from_stream(chunks)).unwrap()
        }else{Response::builder().body(Body::from(body)).unwrap()}
    }
    #[tokio::test]
    async fn direct_managed_custom_and_core_failure_use_real_mihomo() {
        let binary=std::env::var("SI_MIHOMO_BINARY").expect("set SI_MIHOMO_BINARY to a hash-verified binary");
        let dir=tempfile::tempdir().unwrap();
        let reserved=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port=reserved.local_addr().unwrap().port();
        let config=dir.path().join("config.yaml");
        let mut file=std::fs::File::create(&config).unwrap();
        write!(file,"mixed-port: {port}\nbind-address: 127.0.0.1\nallow-lan: false\nmode: direct\nlog-level: silent\nrules:\n  - MATCH,DIRECT\n").unwrap();
        drop(file);drop(reserved);
        let mut core=tokio::process::Command::new(binary).arg("-d").arg(dir.path()).arg("-f").arg(config)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true).spawn().unwrap();
        let ready=tokio::time::timeout(Duration::from_secs(10),async {
            loop { if tokio::net::TcpStream::connect(("127.0.0.1",port)).await.is_ok(){break;}
                assert!(core.try_wait().unwrap().is_none(),"Mihomo exited before bind");
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }).await;
        assert!(ready.is_ok(),"Mihomo did not bind");
        let hits=Arc::new(AtomicUsize::new(0));
        let mock=serve(Router::new().route("/v1/messages",post(fixture)).with_state(hits.clone())).await;
        let upstream=reqwest::Url::parse(&format!("http://{}",mock.address)).unwrap();
        let proxy=reqwest::Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();
        let client=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(5)).build().unwrap();
        for mode in [Outbound::Direct,Outbound::ManagedNetwork(proxy.clone()),Outbound::CustomProxy(proxy.clone())] {
            let host=serve(router(Route::new(upstream.clone(),mode).unwrap())).await;
            let reply=client.post(format!("http://{}/v1/messages",host.address)).body("fixture").send().await.unwrap();
            assert_eq!(reply.status(),200);assert_eq!(reply.text().await.unwrap(),"fixture");
        }
        assert_eq!(hits.load(Ordering::SeqCst),3);
        let host=serve(router(Route::new(upstream.clone(),Outbound::ManagedNetwork(proxy.clone())).unwrap())).await;
        let start=std::time::Instant::now();
        let stream=client.post(format!("http://{}/v1/messages",host.address)).body("stream").send().await.unwrap();
        let mut stream=stream.bytes_stream();
        assert_eq!(stream.next().await.unwrap().unwrap(),"data: first\n\n");
        assert!(start.elapsed()<Duration::from_secs(2),"response was buffered");
        drop(stream);
        tokio::time::sleep(Duration::from_millis(100)).await;
        core.kill().await.unwrap();core.wait().await.unwrap();
        let prior=hits.load(Ordering::SeqCst);
        let host=serve(router(Route::new(upstream,Outbound::ManagedNetwork(proxy)).unwrap())).await;
        let reply=client.post(format!("http://{}/v1/messages",host.address)).body("must-not-reach-upstream").send().await.unwrap();
        assert_eq!(reply.status(),502);
        assert_eq!(hits.load(Ordering::SeqCst),prior,"managed-network silently connected direct");
    }
}
