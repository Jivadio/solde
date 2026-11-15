// SPDX-License-Identifier: AGPL-3.0-or-later
//! Narrow interface to `solde-sync` for `solde-api` and `solde-mcp`, so
//! neither reaches `solde-sync` nor `solde-secrets` (see AGENTS.md).
//!
//! Two feature-gated traits share secret-free DTOs:
//!
//! - `trigger`: [`SyncTrigger`] starts a sync and reads its status. This is
//!   all `solde-mcp` ever enables: the MCP server must never see credentials
//!   or 2FA challenges. Background syncs always run unattended.
//! - `intake`: [`CredentialIntake`] takes new bank credentials,
//!   [`ChallengeIntake`] surfaces and answers 2FA challenges, and
//!   [`SyncTrigger::request_interactive_sync`] (visible only with both
//!   `trigger` and `intake`) is the sole entry point that may yield a
//!   challenge. Only a sync requested by the connection owner through the
//!   API may carry an interactive challenge.
//!
//! Method selection replaces any declarative "origin" parameter: a caller
//! compiled with `trigger` only cannot even name the interactive entry
//! point. The M3b engine must still verify ownership engine-side (build an
//! interactive login context only for an owner-initiated job of the
//! connection owner) and prove it with an OTP-counter test on fake-bank:
//! background callers (MCP, scheduled, co-member) never start a challenge.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use solde_core_domain::{ConnectionId, HouseholdId, UserId};
#[cfg(feature = "intake")]
use zeroize::Zeroizing;

/// Who asks for an operation: one household member in one household.
///
/// Implementations scope every call to this pair (invisible objects answer
/// `NotFound`, never `Forbidden`-by-omission surprises).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Requester {
    /// The member performing the operation.
    pub user: UserId,
    /// The household the operation runs in.
    pub household: HouseholdId,
}

/// A credential string (password, OTP code): wiped from memory on drop.
///
/// It implements neither `Debug`, `Clone` nor `Serialize`, so it cannot
/// reach a log or a response by accident; it moves (never copies) into the
/// intake call that consumes it. Deserializing accepts a plain JSON string.
///
/// Only visible with the `intake` feature: the MCP server (`trigger` only)
/// never names this type.
#[cfg(feature = "intake")]
pub struct SecretString(Zeroizing<String>);

#[cfg(feature = "intake")]
impl SecretString {
    /// Wraps a credential string; the bytes are wiped on drop.
    pub fn new(secret: String) -> Self {
        Self(Zeroizing::new(secret))
    }

    /// Borrows the credential for the intake call that consumes it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(feature = "intake")]
impl From<String> for SecretString {
    fn from(secret: String) -> Self {
        Self::new(secret)
    }
}

#[cfg(feature = "intake")]
impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

/// New credentials for one connection, supplied by its owner.
///
/// Deserializes from `{"connection": "<uuid>", "credential": "<secret>"}`.
/// Never serialized back: credentials only flow inward.
///
/// Only visible with the `intake` feature.
#[cfg(feature = "intake")]
pub struct CredentialInput {
    /// The connection these credentials belong to.
    pub connection: ConnectionId,
    /// The credential itself (moved into the intake call).
    pub credential: SecretString,
}

#[cfg(feature = "intake")]
impl<'de> Deserialize<'de> for CredentialInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Wire {
            connection: String,
            credential: SecretString,
        }

        let wire = Wire::deserialize(deserializer)?;
        let connection = wire
            .connection
            .parse::<ConnectionId>()
            .map_err(de::Error::custom)?;
        // On a bad `connection` id, `wire` (including the credential) is
        // dropped here, so the secret is wiped by `SecretString`'s drop.
        Ok(Self {
            connection,
            credential: wire.credential,
        })
    }
}

/// What a sync job looks like from the outside: status only, no secrets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncJobView {
    /// Opaque job id assigned by the engine.
    pub job_id: String,
    /// The connection being synced.
    pub connection: ConnectionId,
    /// Where the job stands.
    pub status: SyncJobStatus,
}

/// Job lifecycle states visible through the facade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncJobStatus {
    /// Accepted, not started yet.
    Queued,
    /// Currently running.
    Running,
    /// Finished and stored new data.
    Succeeded,
    /// Finished without storing (error or refused challenge while unattended).
    Failed,
}

/// A 2FA challenge waiting for the connection owner's answer: ids and kind
/// only, never credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChallengeView {
    /// Opaque challenge id for [`ChallengeIntake::answer_challenge`].
    pub challenge_id: String,
    /// The connection the challenge belongs to.
    pub connection: ConnectionId,
    /// What the owner must do.
    pub kind: ChallengeKind,
}

/// The kinds of 2FA challenges the intake can surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeKind {
    /// A one-time code the owner types in.
    OneTimeCode,
    /// An approval the owner taps in the bank's own app.
    AppApproval,
}

/// Why a facade call failed. Never carries secrets or personal data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FacadeError {
    /// Unknown id, or an object the requester cannot see. Both answer the
    /// same: one household member never learns another's private objects
    /// exist, including through errors.
    NotFound,
    /// The requester may not perform this operation.
    Forbidden,
    /// The operation cannot run right now (e.g. a sync is already running
    /// for this connection).
    Conflict,
}

impl fmt::Display for FacadeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FacadeError::NotFound => f.write_str("not found"),
            FacadeError::Forbidden => f.write_str("forbidden"),
            FacadeError::Conflict => f.write_str("conflict"),
        }
    }
}

impl std::error::Error for FacadeError {}

/// Starts syncs and reads their status (feature `trigger`).
///
/// This is the whole surface `solde-mcp` sees: a background sync never
/// starts an interactive 2FA/SCA challenge. The interactive entry point
/// ([`SyncTrigger::request_interactive_sync`]) only exists when `intake` is
/// also enabled, so a `trigger`-only caller cannot call it by construction.
/// The M3b engine must additionally verify ownership engine-side: build an
/// interactive login context only for an owner-initiated job of the
/// connection owner (MCP, scheduled and co-member jobs stay unattended),
/// proven by an OTP-counter test on fake-bank.
#[cfg(feature = "trigger")]
pub trait SyncTrigger: Send + Sync {
    /// Starts an unattended sync of `connection` for `requester`.
    ///
    /// MCP-triggered, scheduled, and non-owner syncs all enter here: the
    /// engine runs them unattended, so they never start an interactive
    /// 2FA/SCA challenge.
    fn trigger_background_sync(
        &self,
        requester: Requester,
        connection: ConnectionId,
    ) -> impl std::future::Future<Output = Result<SyncJobView, FacadeError>> + Send;

    /// Requests an interactive sync of `connection` for `requester`
    /// (features `trigger` + `intake`).
    ///
    /// Reserved for the connection owner through the API: this is the sole
    /// facade entry point that may yield a 2FA challenge.
    #[cfg(feature = "intake")]
    fn request_interactive_sync(
        &self,
        requester: Requester,
        connection: ConnectionId,
    ) -> impl std::future::Future<Output = Result<SyncJobView, FacadeError>> + Send;

    /// Reads one job started earlier.
    fn get_job(
        &self,
        requester: Requester,
        job_id: &str,
    ) -> impl std::future::Future<Output = Result<SyncJobView, FacadeError>> + Send;
}

/// Takes new bank credentials (feature `intake`).
///
/// Only the connection owner may supply credentials, and only over an
/// explicit user action: intake never pulls secrets on its own.
#[cfg(feature = "intake")]
pub trait CredentialIntake: Send + Sync {
    /// Stores `input.credential` for `input.connection`.
    fn submit_credential(
        &self,
        requester: Requester,
        input: CredentialInput,
    ) -> impl std::future::Future<Output = Result<(), FacadeError>> + Send;
}

/// Surfaces 2FA challenges and takes the owner's answers (feature `intake`).
#[cfg(feature = "intake")]
pub trait ChallengeIntake: Send + Sync {
    /// The challenge currently waiting on `connection`, if any.
    fn get_challenge(
        &self,
        requester: Requester,
        connection: ConnectionId,
    ) -> impl std::future::Future<Output = Result<Option<ChallengeView>, FacadeError>> + Send;

    /// Answers a challenge previously returned by
    /// [`ChallengeIntake::get_challenge`].
    fn answer_challenge(
        &self,
        requester: Requester,
        challenge_id: &str,
        answer: SecretString,
    ) -> impl std::future::Future<Output = Result<(), FacadeError>> + Send;
}

impl Serialize for SyncJobView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut out = serializer.serialize_struct("SyncJobView", 3)?;
        out.serialize_field("job_id", &self.job_id)?;
        out.serialize_field("connection", &self.connection.to_string())?;
        out.serialize_field("status", &self.status)?;
        out.end()
    }
}

impl<'de> Deserialize<'de> for SyncJobView {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Wire {
            job_id: String,
            connection: String,
            status: SyncJobStatus,
        }

        let wire = Wire::deserialize(deserializer)?;
        let connection = wire
            .connection
            .parse::<ConnectionId>()
            .map_err(de::Error::custom)?;
        Ok(Self {
            job_id: wire.job_id,
            connection,
            status: wire.status,
        })
    }
}

impl Serialize for ChallengeView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut out = serializer.serialize_struct("ChallengeView", 3)?;
        out.serialize_field("challenge_id", &self.challenge_id)?;
        out.serialize_field("connection", &self.connection.to_string())?;
        out.serialize_field("kind", &self.kind)?;
        out.end()
    }
}

impl<'de> Deserialize<'de> for ChallengeView {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Wire {
            challenge_id: String,
            connection: String,
            kind: ChallengeKind,
        }

        let wire = Wire::deserialize(deserializer)?;
        let connection = wire
            .connection
            .parse::<ConnectionId>()
            .map_err(de::Error::custom)?;
        Ok(Self {
            challenge_id: wire.challenge_id,
            connection,
            kind: wire.kind,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;

    fn connection() -> ConnectionId {
        ConnectionId::from_u128(0x1234_5678_1234_5678_1234_5678_1234_5678)
    }

    #[test]
    #[cfg(feature = "intake")]
    fn secret_string_deserializes_from_plain_string() {
        let parsed: SecretString =
            serde_json::from_value(json!("fake-password")).expect("valid secret");
        assert_eq!(parsed.as_str(), "fake-password");
        let owned = SecretString::from("fake-password".to_owned());
        assert_eq!(owned.as_str(), "fake-password");
    }

    #[test]
    #[cfg(feature = "intake")]
    fn credential_input_parses_connection_and_holds_secret() {
        let parsed: CredentialInput = serde_json::from_value(json!({
            "connection": "12345678-1234-5678-1234-567812345678",
            "credential": "fake-password",
        }))
        .expect("valid input");
        assert_eq!(parsed.connection, connection());
        assert_eq!(parsed.credential.as_str(), "fake-password");

        let bad: Result<CredentialInput, _> = serde_json::from_value(json!({
            "connection": "not-an-id",
            "credential": "fake-password",
        }));
        assert!(bad.is_err());
    }

    #[test]
    fn views_round_trip_without_secrets() {
        let job = SyncJobView {
            job_id: "job-1".to_owned(),
            connection: connection(),
            status: SyncJobStatus::Running,
        };
        let json = serde_json::to_value(&job).expect("serializes");
        assert_eq!(
            json,
            json!({
                "job_id": "job-1",
                "connection": "12345678-1234-5678-1234-567812345678",
                "status": "running",
            })
        );
        assert_eq!(
            serde_json::from_value::<SyncJobView>(json).expect("round-trips"),
            job
        );

        let challenge = ChallengeView {
            challenge_id: "ch-1".to_owned(),
            connection: connection(),
            kind: ChallengeKind::OneTimeCode,
        };
        let json = serde_json::to_value(&challenge).expect("serializes");
        assert_eq!(json["kind"], json!("one_time_code"));
        assert_eq!(
            serde_json::from_value::<ChallengeView>(json).expect("round-trips"),
            challenge
        );
    }

    #[test]
    fn errors_stay_generic() {
        assert_eq!(FacadeError::NotFound.to_string(), "not found");
        assert!(!FacadeError::NotFound.to_string().contains("household"));
    }
}
