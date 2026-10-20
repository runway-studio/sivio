// Adapted from Clash Verge Rev 4337bd8, config/prfitem.rs (GPL-3.0-only).
use url::Url;
pub fn normalize_profile_home_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw.trim()).ok()?;

    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }

    url.host_str()?;
    Some(url.to_string().into())
}

