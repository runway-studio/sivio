//! Versioned authenticated backup envelopes; wrong passwords/tampering fail before restore.
use crate::error::AppError;
use argon2::{Algorithm, Argon2, Params, Version};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
const MAGIC: &[u8; 8] = b"SIENC002";
const HEADER: usize = 8 + 16 + 12 + 12;
const PARAMETERS: [u32; 3] = [65_536, 2, 1];
const MAX: usize = 512 * 1024 * 1024;
fn failure() -> AppError {
    AppError::Config("Encrypted backup authentication failed; check the password and file integrity. No active data was changed.".into())
}
pub fn validate_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err(AppError::Config(
            "Encrypted backups require a password of at least 12 characters (up to 1024 bytes)"
                .into(),
        ));
    }
    Ok(())
}
fn derive(password: &[u8], salt: &[u8]) -> Result<[u8; 32], AppError> {
    let params = Params::new(PARAMETERS[0], PARAMETERS[1], PARAMETERS[2], Some(32))
        .map_err(|_| failure())?;
    let mut bytes = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password, salt, &mut bytes)
        .map_err(|_| failure())?;
    Ok(bytes)
}
fn aad(header: &[u8], name: &str) -> Vec<u8> {
    let mut aad = header.to_vec();
    aad.extend_from_slice(name.as_bytes());
    aad
}
fn key(password: &str, salt: &[u8]) -> Result<aead::LessSafeKey, AppError> {
    let mut bytes = derive(password.as_bytes(), salt)?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &bytes).map_err(|_| failure())?;
    bytes.fill(0);
    Ok(aead::LessSafeKey::new(key))
}
pub fn encrypt(mut plain: Vec<u8>, password: &str, name: &str) -> Result<Vec<u8>, AppError> {
    validate_password(password)?;
    if plain.len() > MAX - HEADER - 16 {
        return Err(AppError::Config("Backup artifact exceeds 512 MiB".into()));
    }
    let random = SystemRandom::new();
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    random.fill(&mut salt).map_err(|_| failure())?;
    random.fill(&mut nonce).map_err(|_| failure())?;
    let key = key(password, &salt)?;
    let mut output = Vec::with_capacity(HEADER + plain.len() + 16);
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce);
    for parameter in PARAMETERS {
        output.extend_from_slice(&parameter.to_le_bytes());
    }
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(aad(&output, name)),
        &mut plain,
    )
    .map_err(|_| failure())?;
    output.extend_from_slice(&plain);
    Ok(output)
}
pub fn decrypt(encrypted: &[u8], password: &str, name: &str) -> Result<Vec<u8>, AppError> {
    if encrypted.len() < HEADER + 16
        || encrypted.len() > MAX + HEADER + 16
        || &encrypted[..8] != MAGIC
    {
        return Err(failure());
    }
    // Version 2 has one bounded Argon2id parameter set. Never allocate memory
    // or perform attacker-selected work based on unauthenticated parameters.
    for (index, expected) in PARAMETERS.iter().enumerate() {
        let offset = 36 + index * 4;
        if encrypted[offset..offset + 4] != expected.to_le_bytes() {
            return Err(failure());
        }
    }
    let key = key(password, &encrypted[8..24])?;
    let nonce: [u8; 12] = encrypted[24..36].try_into().map_err(|_| failure())?;
    let mut body = encrypted[HEADER..].to_vec();
    let plain = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(&encrypted[..HEADER], name)),
            &mut body,
        )
        .map_err(|_| failure())?;
    Ok(plain.to_vec())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn argon2id_matches_the_published_rustcrypto_reference_vector() {
        let bytes = derive(b"password", b"somesalt").unwrap();
        assert_eq!(
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7"
        );
    }
    #[test]
    fn wrong_password_tampering_and_artifact_swaps_are_rejected() {
        let password = "fixture-backup-password";
        let bytes = encrypt(b"fixture-private-value".to_vec(), password, "db.sql").unwrap();
        assert!(!bytes.windows(21).any(|w| w == b"fixture-private-value"));
        assert_eq!(
            decrypt(&bytes, password, "db.sql").unwrap(),
            b"fixture-private-value"
        );
        assert!(decrypt(&bytes, "wrong-fixture-password", "db.sql").is_err());
        assert!(decrypt(&bytes, password, "skills.zip").is_err());
        let mut tampered = bytes.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(decrypt(&tampered, password, "db.sql").is_err());
        for length in [0, 7, 8, 35, HEADER, HEADER + 15] {
            assert!(decrypt(&bytes[..length.min(bytes.len())], password, "db.sql").is_err());
        }
        let mut unsupported = bytes.clone();
        unsupported[36] = 0xff;
        assert!(decrypt(&unsupported, password, "db.sql").is_err());
        assert_ne!(
            bytes,
            encrypt(b"fixture-private-value".to_vec(), password, "db.sql").unwrap()
        );
    }
}
