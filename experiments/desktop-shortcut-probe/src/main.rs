//! A temporary, non-privileged conflict fixture. It registers exactly one known
//! test accelerator and releases it when its owner closes stdin or sends a line.
use std::str::FromStr;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = global_hotkey::GlobalHotKeyManager::new()?;
    let key = global_hotkey::hotkey::HotKey::from_str("Command+Control+Option+Shift+F18")?;
    manager.register(key)?;
    println!("SI Assist test accelerator reserved; send a newline to release");
    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    manager.unregister(key)?;
    Ok(())
}
