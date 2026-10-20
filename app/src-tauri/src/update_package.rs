//! Verify the signed macOS payload before the updater can replace the live app.
//! A correctly signed manifest is not proof that an operator uploaded the right
//! product, version or architecture.
use std::{
    fs,
    io::Read,
    path::{Component, Path},
};
fn failure() -> String {
    "Update package is invalid, incompatible or belongs to another app; the installed app was not changed".into()
}
fn compatible_macho(bytes: &[u8], arch: &str) -> bool {
    if bytes.len() < 32 || bytes[..4] != [0xcf, 0xfa, 0xed, 0xfe] {
        return false;
    }
    let cpu = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    matches!(
        (arch, cpu),
        ("aarch64", 0x0100000c) | ("x86_64", 0x01000007)
    )
}
pub(super) fn validate(bytes: &[u8], version: &str, arch: &str) -> Result<(), String> {
    let stage = tempfile::tempdir().map_err(|_| failure())?;
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut seen = std::collections::BTreeSet::new();
    let mut root = None;
    let mut total = 0u64;
    for entry in archive.entries().map_err(|_| failure())? {
        let entry = entry.map_err(|_| failure())?;
        let relative = entry.path().map_err(|_| failure())?.into_owned();
        if relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
            || relative.components().count() > 64
            || !seen.insert(relative.clone())
            || seen.len() > 30_000
        {
            return Err(failure());
        }
        let first = relative
            .components()
            .next()
            .ok_or_else(failure)?
            .as_os_str()
            .to_owned();
        if !Path::new(&first)
            .extension()
            .is_some_and(|extension| extension == "app")
        {
            return Err(failure());
        }
        if root.as_ref().is_some_and(|root| root != &first) {
            return Err(failure());
        }
        root = Some(first);
        let kind = entry.header().entry_type();
        // Our architecture-specific Tauri bundles contain no symlinks. Reject
        // links/special files instead of giving unpack a second path namespace.
        if !kind.is_file() && !kind.is_dir() {
            return Err(failure());
        }
        let mode = entry.header().mode().map_err(|_| failure())?;
        if mode & 0o6000 != 0 {
            return Err(failure());
        }
        let size = entry.size();
        total = total.checked_add(size).ok_or_else(failure)?;
        if size > 512 * 1024 * 1024 || total > 1024 * 1024 * 1024 {
            return Err(failure());
        }
        let destination = stage.path().join(&relative);
        if kind.is_dir() {
            fs::create_dir_all(&destination).map_err(|_| failure())?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|_| failure())?;
            }
            // The stage is private and entry names cannot repeat or link out.
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(|_| failure())?;
            let count =
                std::io::copy(&mut entry.take(size + 1), &mut file).map_err(|_| failure())?;
            if count != size {
                return Err(failure());
            }
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(mode & 0o777))
                .map_err(|_| failure())?;
        }
    }
    let app = stage.path().join(root.ok_or_else(failure)?);
    let info = plist::Value::from_file(app.join("Contents/Info.plist")).map_err(|_| failure())?;
    let info = info.as_dictionary().ok_or_else(failure)?;
    let field = |key: &str| info.get(key).and_then(plist::Value::as_string);
    if field("CFBundleIdentifier") != Some("local.siassist.desktop")
        || field("CFBundleExecutable") != Some("sivio-desktop")
        || field("CFBundleShortVersionString") != Some(version.trim_start_matches('v'))
    {
        return Err(failure());
    }
    let binary = app.join("Contents/MacOS/sivio-desktop");
    let mut header = [0u8; 32];
    fs::File::open(&binary)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| failure())?;
    use std::os::unix::fs::PermissionsExt;
    if !compatible_macho(&header, arch)
        || fs::metadata(&binary)
            .map_err(|_| failure())?
            .permissions()
            .mode()
            & 0o100
            == 0
    {
        return Err(failure());
    }
    let verified = std::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&app)
        .output()
        .map_err(|_| failure())?;
    if !verified.status.success() {
        return Err(failure());
    }
    let identity = std::process::Command::new("/usr/bin/codesign")
        .args(["-d", "--verbose=2"])
        .arg(&app)
        .output()
        .map_err(|_| failure())?;
    if !identity.status.success()
        || !String::from_utf8_lossy(&identity.stderr)
            .lines()
            .any(|line| line == "Identifier=local.siassist.desktop")
    {
        return Err(failure());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrong_architecture_and_truncated_executables_are_rejected() {
        let mut header = [0u8; 32];
        header[..4].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe]);
        header[4..8].copy_from_slice(&0x0100000cu32.to_le_bytes());
        assert!(compatible_macho(&header, "aarch64"));
        assert!(!compatible_macho(&header, "x86_64"));
        assert!(!compatible_macho(&header[..8], "aarch64"));
        assert!(validate(b"not an archive", "0.2.0", std::env::consts::ARCH).is_err());
    }
    #[test]
    fn a_real_signed_owned_bundle_is_checked_before_installation() {
        let temp = tempfile::tempdir().unwrap();
        let app = temp.path().join("Sivio.app");
        let mac = app.join("Contents/MacOS");
        fs::create_dir_all(&mac).unwrap();
        let source = temp.path().join("fixture.c");
        fs::write(&source, "int main(void){return 0;}").unwrap();
        let binary = mac.join("sivio-desktop");
        assert!(std::process::Command::new("/usr/bin/clang")
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .status()
            .unwrap()
            .success());
        let mut dictionary = plist::Dictionary::new();
        for (key, value) in [
            ("CFBundleIdentifier", "local.siassist.desktop"),
            ("CFBundleExecutable", "sivio-desktop"),
            ("CFBundleShortVersionString", "0.2.0"),
            ("CFBundlePackageType", "APPL"),
        ] {
            dictionary.insert(key.into(), plist::Value::String(value.into()));
        }
        let info = plist::Value::Dictionary(dictionary);
        info.to_file_xml(app.join("Contents/Info.plist")).unwrap();
        assert!(std::process::Command::new("/usr/bin/codesign")
            .args([
                "--force",
                "--sign",
                "-",
                "--identifier",
                "local.siassist.desktop"
            ])
            .arg(&app)
            .output()
            .unwrap()
            .status
            .success());
        let gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut tar = tar::Builder::new(gzip);
        tar.append_dir_all("Sivio.app", &app).unwrap();
        let bytes = tar.into_inner().unwrap().finish().unwrap();
        validate(&bytes, "0.2.0", std::env::consts::ARCH).unwrap();
        assert!(validate(&bytes, "0.3.0", std::env::consts::ARCH).is_err());
        let other = if std::env::consts::ARCH == "aarch64" {
            "x86_64"
        } else {
            "aarch64"
        };
        assert!(validate(&bytes, "0.2.0", other).is_err());
        assert!(app.join("Contents/Info.plist").exists());
    }
}
