#[path = "../../../../app/src-tauri/src/update_signature.rs"]
mod signature;

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("Usage: sivio-update-verifier ARTIFACT SIG PUBLIC_KEY_FILE".into());
    }
    let bytes = std::fs::read(&args[0]).map_err(|e| e.to_string())?;
    let sig = std::fs::read_to_string(&args[1]).map_err(|e| e.to_string())?;
    let key = std::fs::read_to_string(&args[2]).map_err(|e| e.to_string())?;
    signature::verify(&bytes, &sig, &key)
}
