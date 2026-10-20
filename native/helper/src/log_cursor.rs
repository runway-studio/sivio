//! Revision 9 bounded, ordered read-only log batches.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LogCursor {
    pub stream: Option<String>,
    pub after: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogBatch {
    pub stream: String,
    pub next: u64,
    pub dropped: bool,
    pub lines: Vec<String>,
}
