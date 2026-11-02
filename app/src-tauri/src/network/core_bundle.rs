//! Both pinned cores share one offline XZ stream. Verify both before publishing
//! either; valid cached executables are never replaced while they may be running.
use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const NAMES: [&str; 2] = ["mihomo", "mihomo-alpha"];
const MAGIC: &[u8; 8] = b"SIVCORE1";
const MAX_CORE: u64 = 256 * 1024 * 1024;

pub(super) fn checked(bundle: &Path, cache: &Path, channel: &str) -> Result<PathBuf> {
    let index = match channel {
        "stable" => 0,
        "alpha" => 1,
        _ => anyhow::bail!("unsupported core channel"),
    };
    restore(
        bundle,
        cache,
        index,
        [super::core_hash("stable")?, super::core_hash("alpha")?],
    )
}

fn valid(path: &Path, expected: &str) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > MAX_CORE {
        return false;
    }
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o100 == 0 {
        return false;
    }
    let mut hash = Sha256::new();
    let mut reader = file.take(MAX_CORE + 1);
    std::io::copy(&mut reader, &mut hash).is_ok() && format!("{:x}", hash.finalize()) == expected
}

fn restore(bundle: &Path, cache: &Path, index: usize, hashes: [&str; 2]) -> Result<PathBuf> {
    let paths = NAMES.map(|name| cache.join(name));
    if valid(&paths[index], hashes[index]) {
        return Ok(paths[index].clone());
    }
    super::private_dir(cache)?;
    // Limit the decoder dictionary independently of the bounded output sizes.
    let stream = xz2::stream::Stream::new_stream_decoder(128 * 1024 * 1024, 0)?;
    let mut input = xz2::read::XzDecoder::new_stream(
        File::open(bundle).context("offline bundled cores are missing")?,
        stream,
    );
    let mut header = [0u8; 24];
    input
        .read_exact(&mut header)
        .context("invalid core bundle header")?;
    ensure!(&header[..8] == MAGIC, "unsupported core bundle format");
    let sizes = [
        u64::from_le_bytes(header[8..16].try_into()?),
        u64::from_le_bytes(header[16..24].try_into()?),
    ];
    ensure!(
        sizes.iter().all(|size| *size > 0 && *size <= MAX_CORE),
        "invalid bundled core size"
    );
    let mut staged = Vec::new();
    for (size, expected) in sizes.into_iter().zip(hashes) {
        let mut output = tempfile::NamedTempFile::new_in(cache)?;
        let mut hash = Sha256::new();
        let mut remaining = size;
        let mut buffer = [0u8; 64 * 1024];
        while remaining > 0 {
            let limit = remaining.min(buffer.len() as u64) as usize;
            input
                .read_exact(&mut buffer[..limit])
                .context("truncated bundled core")?;
            hash.update(&buffer[..limit]);
            output.write_all(&buffer[..limit])?;
            remaining -= limit as u64;
        }
        ensure!(
            format!("{:x}", hash.finalize()) == expected,
            "bundled Mihomo digest mismatch"
        );
        use std::os::unix::fs::PermissionsExt;
        output
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o700))?;
        output.as_file().sync_all()?;
        staged.push(output);
    }
    // Consume the XZ footer/checksum before making any executable visible.
    ensure!(
        input.read(&mut [0u8; 1])? == 0,
        "unexpected core bundle payload"
    );
    for ((output, path), expected) in staged.into_iter().zip(&paths).zip(hashes) {
        if !valid(path, expected) {
            output.persist(path)?;
        }
    }
    File::open(cache)?.sync_all()?;
    Ok(paths[index].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    fn payload() -> Vec<u8> {
        [
            MAGIC.as_slice(),
            &6u64.to_le_bytes(),
            &5u64.to_le_bytes(),
            b"stable",
            b"alpha",
        ]
        .concat()
    }
    fn hashes() -> [String; 2] {
        [
            super::super::digest(b"stable"),
            super::super::digest(b"alpha"),
        ]
    }
    fn pack(path: &Path, bytes: &[u8]) {
        let mut encoder = xz2::write::XzEncoder::new(File::create(path).unwrap(), 6);
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap();
    }
    fn run(bundle: &Path, cache: &Path, index: usize) -> Result<PathBuf> {
        let h = hashes();
        restore(bundle, cache, index, [&h[0], &h[1]])
    }

    #[test]
    fn offline_fresh_install_restores_both_and_cache_needs_no_archive() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("cores.xz");
        let cache = dir.path().join("cache");
        pack(&bundle, &payload());
        run(&bundle, &cache, 1).unwrap();
        for (name, bytes) in NAMES.into_iter().zip([b"stable".as_slice(), b"alpha"]) {
            let path = cache.join(name);
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            assert_eq!(path.metadata().unwrap().permissions().mode() & 0o777, 0o700);
        }
        std::fs::remove_file(&bundle).unwrap();
        run(&bundle, &cache, 0).unwrap();
        run(&bundle, &cache, 1).unwrap();
    }

    #[test]
    fn repairs_deleted_corrupted_and_non_executable_cache_without_replacing_good_core() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("cores.xz");
        let cache = dir.path().join("cache");
        pack(&bundle, &payload());
        run(&bundle, &cache, 0).unwrap();
        let stable_inode = cache.join(NAMES[0]).metadata().unwrap().ino();
        for failure in ["deleted", "corrupt", "mode", "group-only"] {
            let path = cache.join(NAMES[1]);
            match failure {
                "deleted" => std::fs::remove_file(&path).unwrap(),
                "corrupt" => std::fs::write(&path, b"broken").unwrap(),
                "group-only" => {
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o610)).unwrap()
                }
                _ => {
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap()
                }
            }
            run(&bundle, &cache, 1).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), b"alpha");
            assert_eq!(cache.join(NAMES[0]).metadata().unwrap().ino(), stable_inode);
        }
    }

    #[test]
    fn invalid_hash_header_length_or_trailing_data_never_publishes_cores() {
        let mut bad_hash = payload();
        *bad_hash.last_mut().unwrap() = b'!';
        let mut bad_magic = payload();
        bad_magic[0] = b'!';
        let mut bad_size = payload();
        bad_size[8..16].copy_from_slice(&(MAX_CORE + 1).to_le_bytes());
        let mut extra = payload();
        extra.push(1);
        for bytes in [
            bad_hash,
            bad_magic,
            bad_size,
            extra,
            payload()[..28].to_vec(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let bundle = dir.path().join("cores.xz");
            let cache = dir.path().join("cache");
            pack(&bundle, &bytes);
            assert!(run(&bundle, &cache, 0).is_err());
            assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 0);
        }
    }

    #[test]
    fn corrupt_xz_footer_preserves_existing_core_and_publishes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("cores.xz");
        let cache = dir.path().join("cache");
        pack(&bundle, &payload());
        run(&bundle, &cache, 0).unwrap();
        std::fs::remove_file(cache.join(NAMES[1])).unwrap();
        let mut bytes = std::fs::read(&bundle).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        std::fs::write(&bundle, bytes).unwrap();
        assert!(run(&bundle, &cache, 1).is_err());
        assert_eq!(std::fs::read(cache.join(NAMES[0])).unwrap(), b"stable");
        assert!(!cache.join(NAMES[1]).exists());
    }

    #[test]
    #[ignore = "requires packaged dual-core archive; runs entirely offline"]
    fn real_bundled_cores_restore_and_recover_offline() {
        let bundle = std::env::var_os("SIVIO_TEST_CORE_BUNDLE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/network/mihomo-cores.xz")
            });
        let cache = tempfile::tempdir().unwrap();
        for channel in ["stable", "alpha"] {
            let path = checked(&bundle, cache.path(), channel).unwrap();
            assert_eq!(
                super::super::digest(&std::fs::read(&path).unwrap()),
                super::super::core_hash(channel).unwrap()
            );
            std::fs::write(&path, b"corrupted cached core").unwrap();
            checked(&bundle, cache.path(), channel).unwrap();
        }
    }
}
