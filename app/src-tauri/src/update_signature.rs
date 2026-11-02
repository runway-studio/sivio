use base64::Engine;
fn decoded(raw: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|_| "Invalid base64 update signature material")?;
    String::from_utf8(bytes).map_err(|_| "Invalid UTF-8 update signature material".into())
}
pub(crate) fn public_key(key: &str) -> Result<minisign_verify::PublicKey, String> {
    minisign_verify::PublicKey::decode(&decoded(key)?)
        .map_err(|_| "Invalid Tauri/minisign update public key".into())
}
pub(crate) fn verify(bytes: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let signature = minisign_verify::Signature::decode(&decoded(signature)?)
        .map_err(|_| "Invalid update artifact signature")?;
    public_key(key)?
        .verify(bytes, &signature, true)
        .map_err(|_| {
            "Update signature verification failed; the installed app was not changed".into()
        })
}
