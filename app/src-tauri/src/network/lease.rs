//! Keep the helper lease alive independently of UI/control/lifecycle locks.
use super::*;
use tokio::sync::watch;

pub(super) struct Heartbeat {
    task: tokio::task::JoinHandle<()>,
    status: watch::Receiver<std::result::Result<(), String>>,
}

impl Heartbeat {
    pub fn start(owner: ipc::OwnerCredentials, proof: ipc::OwnerSessionProof) -> Self {
        Self::spawn(Duration::from_secs(5), move || {
            let owner = owner.clone();
            let proof = proof.clone();
            async move {
                match tokio::time::timeout(Duration::from_secs(3), ipc::renew_owner(&owner, &proof))
                    .await
                {
                    Ok(Ok(response)) if response.code == 0 => Ok(()),
                    Ok(Ok(response)) => Err(response.message),
                    Ok(Err(error)) => Err(error.to_string()),
                    Err(_) => Err("helper lease renewal timed out".into()),
                }
            }
        })
    }

    fn spawn<F, Fut>(period: Duration, mut renew: F) -> Self
    where
        F: FnMut() -> Fut + Send + 'static,
        Fut: std::future::Future<Output = std::result::Result<(), String>> + Send,
    {
        let (sender, status) = watch::channel(Ok(()));
        let task = tokio::spawn(async move {
            let mut timer = tokio::time::interval(period);
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                let result = renew().await;
                if result != *sender.borrow() {
                    if let Err(error) = &result {
                        log::warn!("Network helper lease renewal failed: {error}");
                    }
                }
                if sender.send(result).is_err() {
                    break;
                }
            }
        });
        Self { task, status }
    }

    pub fn latest(&self) -> std::result::Result<(), String> {
        self.status.borrow().clone()
    }
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn renews_while_runtime_is_locked_and_stops_with_session() {
        let state = NetworkState::default();
        let mut runtime = state.runtime.lock().await;
        let (sender, mut ticks) = tokio::sync::mpsc::unbounded_channel();
        runtime.lease = Some(Heartbeat::spawn(Duration::from_millis(5), move || {
            let sender = sender.clone();
            async move {
                sender.send(()).unwrap();
                Ok(())
            }
        }));
        // Retain the same lock used by long controller and lifecycle operations.
        for _ in 0..3 {
            tokio::time::timeout(Duration::from_secs(1), ticks.recv())
                .await
                .unwrap()
                .unwrap();
        }
        let lease = runtime.lease.take().unwrap();
        let task = lease.task.abort_handle();
        drop(lease);
        tokio::time::timeout(Duration::from_secs(1), async {
            while !task.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        while ticks.try_recv().is_ok() {}
        assert_eq!(ticks.recv().await, None);
    }

    #[tokio::test]
    async fn reports_failure_and_subsequent_recovery() {
        let mut attempts = 0;
        let mut heartbeat = Heartbeat::spawn(Duration::from_millis(5), move || {
            attempts += 1;
            let result = if attempts == 1 {
                Err("unavailable".into())
            } else {
                Ok(())
            };
            async move { result }
        });
        heartbeat.status.changed().await.unwrap();
        assert_eq!(heartbeat.latest(), Err("unavailable".into()));
        heartbeat.status.changed().await.unwrap();
        assert_eq!(heartbeat.latest(), Ok(()));
    }
}
