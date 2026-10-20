use reqwest::Client;

use super::utils::{get_text, get_trace_location};

use super::UnlockItem;

pub(crate) const CHATGPT_WEB_NAME: &str = "ChatGPT Web";

pub(super) async fn check_chatgpt(client: &Client) -> UnlockItem {
    let region = get_trace_location(client, "https://chat.openai.com/cdn-cgi/trace")
        .await
        .map(|loc| UnlockItem::region_label(&loc));

    let web_status = get_text(
        client,
        "https://api.openai.com/compliance/cookie_requirements",
    )
    .await
    .map(|body| classify_web_response(&body))
    .unwrap_or("Failed");

    UnlockItem::checked(CHATGPT_WEB_NAME, web_status, region)
}

fn classify_web_response(body: &str) -> &'static str {
    if body.to_ascii_lowercase().contains("unsupported_country") {
        return "Unsupported Country/Region";
    }
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(value)
            if value
                .get("show_cookie_consent")
                .and_then(serde_json::Value::as_bool)
                .is_some() =>
        {
            "Yes"
        }
        _ => "Unknown response",
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn challenge_html_and_unknown_payload_are_not_reported_as_available() {
        assert_ne!(classify_web_response("<html>403 challenge</html>"), "Yes");
        assert_ne!(classify_web_response("{}"), "Yes");
        assert_eq!(
            classify_web_response(r#"{"show_cookie_consent":false}"#),
            "Yes"
        );
        assert_eq!(
            classify_web_response(r#"{"error":"unsupported_country"}"#),
            "Unsupported Country/Region"
        );
    }
}
