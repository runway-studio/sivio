//! Redact before core output reaches a file, not only when the UI reads it.
#[derive(Default)]
pub struct Redactor {
    secrets: Vec<String>,
}
impl Redactor {
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        let value: serde_yaml_ng::Value =
            serde_yaml_ng::from_str(yaml).map_err(|_| "invalid runtime YAML for log redaction")?;
        fn collect(value: &serde_yaml_ng::Value, key: &str, output: &mut Vec<String>) {
            use serde_yaml_ng::Value;
            match value {
                Value::Mapping(map) => {
                    for (k, v) in map {
                        collect(v, k.as_str().unwrap_or(""), output);
                    }
                }
                Value::Sequence(items) => {
                    for value in items {
                        collect(value, key, output);
                    }
                }
                Value::String(text) if !text.is_empty() => {
                    let key = key.to_ascii_lowercase().replace(['-', '_'], "");
                    if [
                        "password",
                        "token",
                        "secret",
                        "uuid",
                        "privatekey",
                        "apikey",
                        "authorization",
                        "cookie",
                    ]
                    .iter()
                    .any(|part| key.contains(part))
                        || key == "url"
                    {
                        output.push(text.clone());
                    }
                    if key == "authentication" {
                        output.push(text.clone());
                        if let Some((_, password)) = text.split_once(':') {
                            if !password.is_empty() {
                                output.push(password.into());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        let mut secrets = Vec::new();
        collect(&value, "", &mut secrets);
        secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
        secrets.dedup();
        Ok(Self { secrets })
    }
    pub fn redact(&self, line: &str) -> String {
        let mut line = line.to_owned();
        for secret in &self.secrets {
            line = line.replace(secret, "[REDACTED]");
        }
        for scheme in ["https://", "http://", "socks5h://", "socks5://"] {
            while let Some(start) = line.find(scheme) {
                let tail = &line[start..];
                let len = tail
                    .find(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | '<' | '>'))
                    .unwrap_or(tail.len());
                line.replace_range(start..start + len, "[URL]");
            }
        }
        line
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_credentials_and_urls_before_persistence() {
        let redactor=Redactor::from_yaml("authentication: ['user:fixture-password']\nproxies: [{name: keep-name, password: fixture-node-password}]\nproxy-providers: {x: {url: 'https://example.invalid/private-token'}}").unwrap();
        let result=redactor.redact("keep-name: fixture-password fixture-node-password https://user:pass@example.invalid/other?token=hidden");
        assert!(result.contains("keep-name"));
        for secret in [
            "fixture-password",
            "fixture-node-password",
            "user:pass",
            "hidden",
        ] {
            assert!(!result.contains(secret));
        }
    }
}
