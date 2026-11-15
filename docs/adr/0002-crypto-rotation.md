# ADR-0002: Credential Crypto and Key Rotation

- Status: accepted (M3a implements the vault; the sync engine behavior lands in M3b)
- Date: 2026-11-15

## Decision

- Credentials are sealed with AES-256-GCM (`ring::aead`, `AES_256_GCM`), one
  fresh random 96-bit nonce per seal (`ring::rand::SystemRandom`).
- The key-encryption key is the instance master key (`MasterKey`, 256 bits).
  The `Vault` holds at most two keys: current and previous.
- Storage schema (M3b rows): `Sealed { key_id: u32, nonce: [u8; 12],
  ciphertext: Vec<u8> }`, where `ciphertext` is plaintext plus the 16-byte
  GCM tag.
- AAD binds the owning row, in order: `b"solde-cred-v1"`, `u64` BE length +
  `cred_id`, `u64` BE length + `conn_id`, `u32` BE `schema_version`. Length
  prefixes keep the encoding unambiguous, so swapping two rows (or replaying
  a row under different ids) fails authentication.
- `unseal` picks the key by `key_id`: current, else previous, else
  `UnknownKeyId`. Every other failure (bad key, tampered data, wrong AAD,
  RNG failure) is one generic error with no oracle detail.
- Rotation: `rotate(new_master, new_id)` keeps the old key readable;
  `drop_previous()` fails old rows closed (`UnknownKeyId`). Rows are
  re-sealed lazily; dropping the previous key is an explicit admin step
  (M3b `rotate-master-key` command).
- Engine behavior (M3b, not this ADR's code): the server refuses to start
  without a master key (already true); a sync job never resumes across a
  restart while a 2FA challenge is pending, and unattended/scheduled/MCP
  syncs never start an interactive 2FA/SCA challenge.

## Drivers

- A stolen database dump without the key file must yield nothing.
- Losing the key must be survivable: re-enter credentials, not re-install.
- No oracle for tamper probing; no cross-row replay.

## Alternatives considered

- Per-credential DEKs wrapped by the KEK (rejected for now: one KEK plus
  rotation grace covers the threat model; revisit if a connector needs
  per-row export).
- Key version in the database with server-side migration (rejected: `key_id`
  in the envelope plus lazy re-seal needs no migration and no downtime).
- Auto-generating the key into the data volume (rejected in ADR-0001: the
  keygen init container owns key creation).

## Consequences

- Losing the key still forces re-entering credentials (accepted, ADR-0001).
- Only `solde-sync` may depend on `solde-secrets`; `api`/`mcp` reach sync
  through `sync-facade` (`trigger`, plus `intake` for the API in M3b; `mcp`
  stays trigger-only, enforced by `cargo xtask check-deps` rule 5).
- A 2FA login cannot resume after a restart (accepted, ADR-0001).

## Follow-ups (M3b, explicitly out of M3a)

- `credentials` rows in both backends, `rotate-master-key` admin command,
  sync engine wiring (`SyncTrigger`/`CredentialIntake`/`ChallengeIntake`
  implementations, unattended refusal, no `--resume` of pending challenges).
