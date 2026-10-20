#[cfg(unix)]
use platform_lib as libc;
#[path = "../../../log_retention.rs"]
mod log_retention;
use std::{collections::VecDeque, time::Duration};

use anyhow::Result;
use flexi_logger::{
    Cleanup, Criterion, DeferredNow, FileSpec, Naming, WriteMode,
    writers::{FileLogWriter, FileLogWriterBuilder, LogWriter as _},
};
use log::{Level, Record};
use once_cell::sync::{Lazy, OnceCell};
use parking_lot::{Mutex, RwLock};
use tracing_estuary::{Pipeline, PipelineBuilder};

use crate::core::paths::{ensure_persistent_state_layout, service_paths};
use crate::core::platform_security;
use crate::core::structure::WriterConfig;

// Buffered writes avoid flexi's one-syscall-per-line default; the background
// flusher bounds the hard-kill loss window.
const WRITE_BUFFER_CAPACITY: usize = 64 * 1024;
const WRITE_FLUSH_INTERVAL: Duration = Duration::from_millis(500);

const SERVICE_LOG_MAX_SIZE: u64 = 10 * 1024 * 1024;
const SERVICE_LOG_MAX_FILES: usize = 3;

static GLOBAL_WRITER: RwLock<Option<FileLogWriter>> = RwLock::new(None);
static SERVICE_LOG: OnceCell<Pipeline> = OnceCell::new();

/// Logs to stdout and to the service log file, since launchd and the Windows SCM discard stdout.
pub fn init_service_logging() {
    let (pipeline, file_error) =
        match service_log_writer().and_then(|writer| PipelineBuilder::new().file_writer(writer).init()) {
            Ok(pipeline) => (Ok(pipeline), None),
            Err(error) => (PipelineBuilder::new().init(), Some(error)),
        };
    match pipeline {
        Ok(pipeline) => {
            let _ = SERVICE_LOG.set(pipeline);
        }
        Err(error) => eprintln!("Failed to install service logging: {error:#}"),
    }
    if let Some(error) = file_error {
        tracing::warn!("Service log file unavailable, logging to stdout only: {error:#}");
    }
}

/// Writes out queued service log lines before the process exits.
pub fn flush_service_log() {
    if let Some(pipeline) = SERVICE_LOG.get() {
        pipeline.flush_all();
    }
}

fn service_log_writer() -> anyhow::Result<FileLogWriterBuilder> {
    ensure_persistent_state_layout()?;
    let directory = service_paths()?.logs_dir();
    platform_security::ensure_private_service_directory(&directory)?;
    log_retention::cleanup(&directory, crate::SERVICE_SLUG, &format!("{}_latest.log", crate::SERVICE_SLUG), 7, true)?;
    Ok(FileLogWriter::builder(
        FileSpec::default()
            .directory(directory)
            .basename(crate::SERVICE_SLUG)
            .suppress_timestamp(),
    )
    .format(tracing_estuary::file_format_with_level)
    // Unbuffered, so a killed service keeps its last lines.
    .write_mode(WriteMode::Direct)
    // A restart must not rotate the previous run away.
    .append()
    .rotate(
        Criterion::Size(SERVICE_LOG_MAX_SIZE),
        Naming::TimestampsCustomFormat {
            current_infix: Some("latest"),
            format: "%Y-%m-%d_%H-%M-%S",
        },
        Cleanup::KeepLogFiles(SERVICE_LOG_MAX_FILES),
    ))
}

fn service_writer_builder(config: &WriterConfig) -> FileLogWriterBuilder {
    let _ = log_retention::cleanup(std::path::Path::new(&config.directory), "service", "service_latest.log", 7, GLOBAL_WRITER.read().is_none());
    FileLogWriter::builder(
        FileSpec::default()
            .directory(config.directory.clone())
            .basename("service")
            .suppress_timestamp(),
    )
    .format(tracing_estuary::file_format_without_level)
    .write_mode(WriteMode::BufferAndFlushWith(
        WRITE_BUFFER_CAPACITY,
        WRITE_FLUSH_INTERVAL,
    ))
    .rotate(
        Criterion::Size(config.max_log_size),
        Naming::TimestampsCustomFormat {
            current_infix: Some("latest"),
            format: "%Y-%m-%d_%H-%M-%S",
        },
        Cleanup::KeepLogFiles(config.max_log_files),
    )
}

/// Resets the writer in place instead of rebuilding it: flexi's flusher thread
/// cannot be stopped, so every dropped writer would leak a thread and an fd.
pub fn set_or_update_writer(config: &WriterConfig) -> Result<()> {
    let builder = service_writer_builder(config);
    let mut slot = GLOBAL_WRITER.write();
    match slot.as_ref() {
        Some(writer) => {
            // Propagate the drain failure so the buffered tail stays retryable.
            writer.flush()?;
            writer.reset(&builder)?;
        }
        None => *slot = Some(builder.try_build()?),
    }
    Ok(())
}

pub fn write_core_line(level: Level, line: &str) {
    let guard = GLOBAL_WRITER.read();
    if let Some(writer) = guard.as_ref() {
        let mut now = DeferredNow::default();
        let args = format_args!("{line}");
        let record = Record::builder().args(args).level(level).target("service").build();
        let _ = writer.write(&mut now, &record);
    }
}

pub fn flush_writer() {
    let guard = GLOBAL_WRITER.read();
    if let Some(writer) = guard.as_ref() {
        let _ = writer.flush();
    }
}

const LOGS_QUEUE_LEN: usize = 100;

pub struct LogRing {
    inner: Mutex<(u64, VecDeque<(u64,String)>)>,
    stream: String,
}

impl LogRing {
    fn new() -> Self {
        Self {
            inner: Mutex::new((0,VecDeque::with_capacity(LOGS_QUEUE_LEN))),
            stream:uuid::Uuid::new_v4().to_string(),
        }
    }

    pub fn append_log(&self, log: String) {
        let mut guard = self.inner.lock();
        if guard.1.len() >= LOGS_QUEUE_LEN {guard.1.pop_front();}
        guard.0=guard.0.saturating_add(1);let sequence=guard.0;
        let mut end=log.len().min(16*1024);while !log.is_char_boundary(end) {end-=1;}
        guard.1.push_back((sequence,log[..end].to_owned()));
    }
    pub fn get_logs(&self) -> Vec<String> {self.inner.lock().1.iter().map(|(_,line)|line.clone()).collect()}
    pub fn since(&self,cursor:&crate::log_cursor::LogCursor) -> crate::log_cursor::LogBatch {
        let guard=self.inner.lock();let same=cursor.stream.as_ref()==Some(&self.stream);
        let after=if same {cursor.after} else {0};let mut bytes=0;let mut lines=Vec::new();let mut next=after;
        for (sequence,line) in &guard.1 {
            if *sequence<=after {continue;}
            if bytes+line.len()>256*1024 {break;}
            bytes+=line.len();lines.push(line.clone());next=*sequence;
        }
        if lines.is_empty() {next=guard.0;}
        crate::log_cursor::LogBatch{stream:self.stream.clone(),next,dropped:same && guard.1.front().is_some_and(|(first,_)|*first>after.saturating_add(1)),lines}
    }
    pub fn clear_logs(&self) {self.inner.lock().1.clear();}

}

pub static LOG_RING: Lazy<LogRing> = Lazy::new(LogRing::new);

#[cfg(test)]
mod cursor_tests {
    use super::*;
    #[test] fn ordered_cursor_retains_identical_records_and_reports_bounded_loss() {
        let ring=LogRing::new();ring.append_log("same".into());
        let first=ring.since(&Default::default());ring.append_log("same".into());
        let next=ring.since(&crate::log_cursor::LogCursor{stream:Some(first.stream.clone()),after:first.next});
        assert_eq!(next.lines,vec!["same"]);assert!(next.next>first.next);assert!(!next.dropped);
        for _ in 0..150 {ring.append_log("same".into());}
        assert!(ring.since(&crate::log_cursor::LogCursor{stream:Some(first.stream),after:first.next}).dropped);
        ring.clear_logs();ring.append_log("new run".into());assert!(ring.since(&Default::default()).lines.contains(&"new run".into()));
    }
}
