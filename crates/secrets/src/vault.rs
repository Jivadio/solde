// SPDX-License-Identifier: AGPL-3.0-or-later
//! AES-256-GCM credential vault: seals bank credentials under the
//! [`MasterKey`](crate::MasterKey) and opens them again.
//!
//! The vault holds at most two keys: the current one and its predecessor,
//! so a master-key rotation keeps previously sealed rows readable until the
//! admin drops the old key. [`Vault`] never implements `Debug`, `Clone` or
//! `Serialize`, and its key material is wiped from memory on drop.
//!
//! ## AAD layout
//!
//! Every seal binds the row it belongs to, so swapping two sealed rows (or
//! replaying a row under different identifiers) fails authentication. The
//! additional authenticated data is, in order:
//!
//! ```text
//! b"solde-cred-v1"            // domain separator
//! u64 BE length of cred_id || cred_id
//! u64 BE length of conn_id || conn_id
//! u32 BE schema_version
//! ```
//!
//! Length prefixes keep the concatenation unambiguous: no two distinct
//! `(cred_id, conn_id, schema_version)` triples share an encoding.

use std::fmt;

use ring::rand::SecureRandom;
use ring::{aead, rand};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{MASTER_KEY_LEN, MasterKey};

/// Domain separator opening every AAD block (see the module docs).
pub const VAULT_AAD_DOMAIN: &[u8] = b"solde-cred-v1";

/// GCM nonce length in bytes (96 bits), one fresh random nonce per seal.
pub const NONCE_LEN: usize = aead::NONCE_LEN;

/// One key-encryption key held by the vault.
struct KeyEntry {
    id: u32,
    material: Zeroizing<[u8; MASTER_KEY_LEN]>,
}

/// Sealed envelope for one credential row: storable, but never plaintext.
///
/// The `ciphertext` holds the plaintext followed by the 16-byte GCM tag.
/// The envelope authenticates itself only together with the `(cred_id,
/// conn_id, schema_version)` triple passed to [`Vault::seal`]/[`Vault::unseal`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sealed {
    /// Which vault key sealed this row (current or previous).
    pub key_id: u32,
    /// Fresh random 96-bit nonce for this seal.
    pub nonce: [u8; NONCE_LEN],
    /// Plaintext plus the 16-byte GCM tag.
    pub ciphertext: Vec<u8>,
}

/// The credential vault: seals with the current key, opens with the current
/// or the previous key.
///
/// Like [`MasterKey`](crate::MasterKey), it implements neither `Debug`,
/// `Clone` nor `Serialize`, so key material cannot reach a log, a response
/// or a duplicated owner by accident.
pub struct Vault {
    current: KeyEntry,
    previous: Option<KeyEntry>,
}

impl Vault {
    /// Builds a vault holding a single key.
    pub fn new(master: &MasterKey, key_id: u32) -> Self {
        let mut material = Zeroizing::new([0_u8; MASTER_KEY_LEN]);
        material.copy_from_slice(master.as_bytes());
        Self {
            current: KeyEntry {
                id: key_id,
                material,
            },
            previous: None,
        }
    }

    /// Rotates to a new master key, keeping the old key readable.
    ///
    /// Rows sealed before the rotation still open (their [`Sealed::key_id`]
    /// selects the previous key); new seals use `new_key_id`. Call
    /// [`Vault::drop_previous`] once every row has been re-sealed to fail
    /// closed on the old key.
    ///
    /// Fails with [`VaultError::PreviousStillActive`] when a previous key is
    /// still held (drop or re-seal it first), and with
    /// [`VaultError::DuplicateKeyId`] when `new_key_id` equals the current
    /// id, leaving the vault unchanged in both cases.
    pub fn rotate(&mut self, new_master: &MasterKey, new_key_id: u32) -> Result<(), VaultError> {
        if self.previous.is_some() {
            return Err(VaultError::PreviousStillActive);
        }
        if new_key_id == self.current.id {
            return Err(VaultError::DuplicateKeyId);
        }
        let mut material = Zeroizing::new([0_u8; MASTER_KEY_LEN]);
        material.copy_from_slice(new_master.as_bytes());
        let old = std::mem::replace(
            &mut self.current,
            KeyEntry {
                id: new_key_id,
                material,
            },
        );
        self.previous = Some(old);
        Ok(())
    }

    /// Forgets the previous key. Afterwards, rows sealed under it fail with
    /// [`VaultError::UnknownKeyId`].
    pub fn drop_previous(&mut self) {
        self.previous = None;
    }

    /// The id new seals are stamped with.
    pub fn key_id(&self) -> u32 {
        self.current.id
    }

    /// Seals `plaintext` for the `(cred_id, conn_id, schema_version)` row.
    ///
    /// Uses a fresh random 96-bit nonce on every call, so sealing the same
    /// plaintext twice yields different envelopes.
    ///
    /// The in-progress buffer is a `Zeroizing<Vec<u8>>` until the seal
    /// succeeds; the caller's `plaintext` copy stays its own responsibility
    /// (wipe it or keep it in a `Zeroizing` wrapper).
    pub fn seal(
        &self,
        cred_id: &[u8],
        conn_id: &[u8],
        schema_version: u32,
        plaintext: &[u8],
    ) -> Result<Sealed, VaultError> {
        let key = less_safe(&self.current)?;
        let rng = rand::SystemRandom::new();
        let mut nonce_bytes = [0_u8; NONCE_LEN];
        rng.fill(&mut nonce_bytes)
            .map_err(|_| VaultError::OperationFailed)?;
        let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
        let mut in_out = Zeroizing::new(plaintext.to_vec());
        key.seal_in_place_append_tag(
            nonce,
            aead::Aad::from(aad(cred_id, conn_id, schema_version)),
            &mut *in_out,
        )
        .map_err(|_| VaultError::OperationFailed)?;
        Ok(Sealed {
            key_id: self.current.id,
            nonce: nonce_bytes,
            ciphertext: std::mem::take(&mut *in_out),
        })
    }

    /// Opens a row sealed with [`Vault::seal`].
    ///
    /// The key is picked by [`Sealed::key_id`]: the current key first, then
    /// the previous one, else [`VaultError::UnknownKeyId`]. Any tampering
    /// (ciphertext, nonce, or the `(cred_id, conn_id, schema_version)`
    /// triple) fails with the generic [`VaultError::OperationFailed`: no
    /// oracle tells wrong-key, wrong-AAD and corrupted-data apart.
    ///
    /// [`VaultError::OperationFailed`]: VaultError::OperationFailed
    pub fn unseal(
        &self,
        sealed: &Sealed,
        cred_id: &[u8],
        conn_id: &[u8],
        schema_version: u32,
    ) -> Result<Zeroizing<Vec<u8>>, VaultError> {
        let entry = if sealed.key_id == self.current.id {
            &self.current
        } else {
            match self.previous.as_ref() {
                Some(old) if sealed.key_id == old.id => old,
                _ => return Err(VaultError::UnknownKeyId),
            }
        };
        let key = less_safe(entry)?;
        let nonce = aead::Nonce::assume_unique_for_key(sealed.nonce);
        let mut in_out = Zeroizing::new(sealed.ciphertext.clone());
        let opened = key
            .open_in_place(
                nonce,
                aead::Aad::from(aad(cred_id, conn_id, schema_version)),
                &mut in_out,
            )
            .map_err(|_| VaultError::OperationFailed)?;
        let len = opened.len();
        in_out.truncate(len);
        Ok(in_out)
    }
}

fn less_safe(entry: &KeyEntry) -> Result<aead::LessSafeKey, VaultError> {
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, &entry.material[..])
        .map_err(|_| VaultError::OperationFailed)?;
    Ok(aead::LessSafeKey::new(unbound))
}

/// Builds the AAD block documented at the top of this module.
fn aad(cred_id: &[u8], conn_id: &[u8], schema_version: u32) -> Vec<u8> {
    let mut out =
        Vec::with_capacity(VAULT_AAD_DOMAIN.len() + 8 + cred_id.len() + 8 + conn_id.len() + 4);
    out.extend_from_slice(VAULT_AAD_DOMAIN);
    out.extend_from_slice(&(cred_id.len() as u64).to_be_bytes());
    out.extend_from_slice(cred_id);
    out.extend_from_slice(&(conn_id.len() as u64).to_be_bytes());
    out.extend_from_slice(conn_id);
    out.extend_from_slice(&schema_version.to_be_bytes());
    out
}

/// Why a seal or open failed. Deliberately coarse: authentication failures
/// never say whether the key, the nonce, the ciphertext or the AAD was at
/// fault, and errors never carry key material.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum VaultError {
    /// The envelope names a key the vault no longer holds.
    UnknownKeyId,
    /// A previous key is still held: drop it before rotating again.
    PreviousStillActive,
    /// The new key id equals the current one: ids must be unique.
    DuplicateKeyId,
    /// Generic seal/open failure: tampered data, wrong identifiers, or an
    /// internal crypto/RNG failure. No oracle, no details.
    OperationFailed,
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::UnknownKeyId => f.write_str("unknown sealing key id"),
            VaultError::PreviousStillActive => {
                f.write_str("a previous sealing key is still active (drop it before rotating again)")
            }
            VaultError::DuplicateKeyId => f.write_str("the new sealing key id is already in use"),
            VaultError::OperationFailed => {
                f.write_str("cannot seal or open the credential (wrong key, corrupted data or wrong identifiers)")
            }
        }
    }
}

impl std::error::Error for VaultError {}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    fn master(first_byte: u8) -> MasterKey {
        let bytes: Vec<u8> = (0..32).map(|i| first_byte.wrapping_add(i)).collect();
        MasterKey::from_base64(&STANDARD.encode(&bytes)).expect("test key is valid")
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn matches_nist_sp_800_38d_empty_vector() {
        // NIST SP 800-38D, section F.5 (GCM test cases), 256-bit case with
        // empty plaintext and empty AAD: key and IV all zero, so the output
        // is the authentication tag alone. Cross-checked against OpenSSL
        // (`node:crypto` AES-256-GCM), which agrees with `ring` here.
        let key = aead::LessSafeKey::new(
            aead::UnboundKey::new(&aead::AES_256_GCM, &[0_u8; 32]).expect("zero key is valid"),
        );
        let nonce = aead::Nonce::assume_unique_for_key([0_u8; NONCE_LEN]);
        let mut in_out = Vec::new();
        key.seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut in_out)
            .expect("sealing empty input works");
        assert_eq!(hex(&in_out), "530f8afbc74536b9a963b4f1c4cb738b");
    }

    #[test]
    fn round_trips_and_uses_fresh_nonces() {
        let vault = Vault::new(&master(0), 1);
        let plaintext = b"fake oauth refresh token";
        let first = vault
            .seal(b"cred-1", b"conn-1", 1, plaintext)
            .expect("seal works");
        assert_eq!(first.key_id, 1);
        assert_eq!(first.ciphertext.len(), plaintext.len() + aead::MAX_TAG_LEN);
        let opened = vault
            .unseal(&first, b"cred-1", b"conn-1", 1)
            .expect("unseal works");
        assert_eq!(opened.as_slice(), plaintext);

        // The same plaintext seals differently every time (random nonce).
        let second = vault
            .seal(b"cred-1", b"conn-1", 1, plaintext)
            .expect("seal works");
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
        // ... yet both open.
        assert_eq!(
            vault
                .unseal(&second, b"cred-1", b"conn-1", 1)
                .expect("unseal works")
                .as_slice(),
            plaintext
        );
    }

    #[test]
    fn tampering_fails_closed_without_oracle() {
        let vault = Vault::new(&master(10), 1);
        let sealed = vault
            .seal(b"cred-9", b"conn-9", 3, b"fake bank secret")
            .expect("seal works");

        // Bit flip in the ciphertext (plaintext or tag).
        let mut tampered = sealed.clone();
        tampered.ciphertext[0] ^= 1;
        assert_eq!(
            vault.unseal(&tampered, b"cred-9", b"conn-9", 3),
            Err(VaultError::OperationFailed)
        );
        // Bit flip in the nonce.
        let mut tampered = sealed.clone();
        tampered.nonce[0] ^= 1;
        assert_eq!(
            vault.unseal(&tampered, b"cred-9", b"conn-9", 3),
            Err(VaultError::OperationFailed)
        );
        // Wrong AAD in any position.
        for (cred, conn, version) in [
            (b"cred-X".as_slice(), b"conn-9".as_slice(), 3_u32),
            (b"cred-9".as_slice(), b"conn-X".as_slice(), 3_u32),
            (b"cred-9".as_slice(), b"conn-9".as_slice(), 4_u32),
        ] {
            assert_eq!(
                vault.unseal(&sealed, cred, conn, version),
                Err(VaultError::OperationFailed),
                "cred={cred:?} conn={conn:?} version={version}"
            );
        }
        // The error text says nothing about which check failed.
        assert!(!VaultError::OperationFailed.to_string().contains("nonce"));
        assert!(!VaultError::OperationFailed.to_string().contains("tag"));
    }

    #[test]
    fn swapped_rows_do_not_open() {
        let vault = Vault::new(&master(20), 1);
        let row_a = vault
            .seal(b"cred-a", b"conn-a", 1, b"secret for row A")
            .expect("seal works");
        let row_b = vault
            .seal(b"cred-b", b"conn-b", 1, b"secret for row B")
            .expect("seal works");
        // Each envelope opens only under its own identifiers.
        assert_eq!(
            vault.unseal(&row_a, b"cred-b", b"conn-b", 1),
            Err(VaultError::OperationFailed)
        );
        assert_eq!(
            vault.unseal(&row_b, b"cred-a", b"conn-a", 1),
            Err(VaultError::OperationFailed)
        );
        assert_eq!(
            vault
                .unseal(&row_a, b"cred-a", b"conn-a", 1)
                .expect("own row opens")
                .as_slice(),
            b"secret for row A"
        );
    }

    #[test]
    fn rotation_keeps_old_rows_until_previous_is_dropped() {
        let mut vault = Vault::new(&master(30), 1);
        let old = vault
            .seal(b"cred-r", b"conn-r", 1, b"sealed before rotation")
            .expect("seal works");

        vault.rotate(&master(40), 2).expect("first rotation works");
        assert_eq!(vault.key_id(), 2);

        // Old rows still open after rotation...
        assert_eq!(
            vault
                .unseal(&old, b"cred-r", b"conn-r", 1)
                .expect("old row still opens")
                .as_slice(),
            b"sealed before rotation"
        );
        // ... and new seals carry the new key id.
        let fresh = vault
            .seal(b"cred-r", b"conn-r", 1, b"sealed after rotation")
            .expect("seal works");
        assert_eq!(fresh.key_id, 2);
        assert_eq!(
            vault
                .unseal(&fresh, b"cred-r", b"conn-r", 1)
                .expect("new row opens")
                .as_slice(),
            b"sealed after rotation"
        );

        // Dropping the previous key fails old rows closed.
        vault.drop_previous();
        assert_eq!(
            vault.unseal(&old, b"cred-r", b"conn-r", 1),
            Err(VaultError::UnknownKeyId)
        );
        // New rows are unaffected.
        assert!(vault.unseal(&fresh, b"cred-r", b"conn-r", 1).is_ok());
    }

    #[test]
    fn rotating_twice_without_dropping_fails() {
        let mut vault = Vault::new(&master(60), 1);
        vault.rotate(&master(61), 2).expect("first rotation works");
        assert_eq!(
            vault.rotate(&master(62), 3),
            Err(VaultError::PreviousStillActive)
        );
        // The failed rotation leaves the vault unchanged: new seals still
        // use key 2 and the pre-rotation row still opens.
        assert_eq!(vault.key_id(), 2);

        // After dropping the previous key, rotating again works.
        vault.drop_previous();
        vault
            .rotate(&master(62), 3)
            .expect("rotation works after drop");
        assert_eq!(vault.key_id(), 3);
    }

    #[test]
    fn rotating_to_the_current_key_id_fails() {
        let mut vault = Vault::new(&master(70), 1);
        assert_eq!(
            vault.rotate(&master(71), 1),
            Err(VaultError::DuplicateKeyId)
        );
        assert_eq!(vault.key_id(), 1);
    }

    #[test]
    fn unknown_key_id_is_rejected() {
        let vault = Vault::new(&master(50), 1);
        let sealed = Sealed {
            key_id: 99,
            nonce: [0_u8; NONCE_LEN],
            ciphertext: vec![0_u8; 16],
        };
        assert_eq!(
            vault.unseal(&sealed, b"cred", b"conn", 1),
            Err(VaultError::UnknownKeyId)
        );
    }
}
