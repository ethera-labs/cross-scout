//! Conversions between the three representations a value passes through:
//! `alloy` primitives (in-memory events), Postgres columns (`bytea` / `numeric`
//! / `timestamptz`) and the hex/decimal/RFC-3339 strings the DTOs carry.

use std::str::FromStr;

use alloy::primitives::{Address, B256, U256};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};

/// `bytea` bytes to `0x`-prefixed lowercase hex, for DTO fields.
pub fn hex_prefixed(bytes: &[u8]) -> String {
    alloy::hex::encode_prefixed(bytes)
}

/// Optional `bytea` to optional hex string.
pub fn opt_hex(bytes: &Option<Vec<u8>>) -> Option<String> {
    bytes.as_ref().map(|b| hex_prefixed(b))
}

/// Fixed 32-byte hash to owned bytes for a `bytea` bind.
pub fn b256_bytes(h: &B256) -> Vec<u8> {
    h.as_slice().to_vec()
}

/// 20-byte address to owned bytes for a `bytea` bind.
pub fn address_bytes(a: &Address) -> Vec<u8> {
    a.as_slice().to_vec()
}

/// `U256` wei to an arbitrary-precision decimal for a `numeric` bind.
pub fn u256_decimal(v: &U256) -> BigDecimal {
    // U256::to_string is the canonical base-10 form and always parses.
    BigDecimal::from_str(&v.to_string()).unwrap_or_default()
}

/// `numeric` decimal to the canonical integer decimal string a DTO carries.
pub fn decimal_string(v: &BigDecimal) -> String {
    v.with_scale(0).to_string()
}

/// `timestamptz` to RFC-3339 string.
pub fn rfc3339(ts: &DateTime<Utc>) -> String {
    ts.to_rfc3339()
}

/// Optional `timestamptz` to optional RFC-3339 string.
pub fn opt_rfc3339(ts: &Option<DateTime<Utc>>) -> Option<String> {
    ts.as_ref().map(rfc3339)
}
