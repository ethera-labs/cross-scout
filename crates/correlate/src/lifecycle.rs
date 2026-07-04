//! The per-XT lifecycle state machine.
//!
//! Events arrive out of order, from several chains, and some never arrive.
//! [`next_stage`] is a pure transition table: given an XT's current [`Stage`]
//! and one decoded [`EventKind`], it returns the stage the XT should move to,
//! or `None` if the event doesn't advance it (duplicate, out-of-order, or
//! unrelated). Persisted advances are monotonic, so a `None` or a backward
//! transition is simply dropped by the store.
//!
//! Only the transitions with a live on-chain signal appear here. Settlement
//! advances (`Settled`/`Finalized`) are set-based and applied by the engine
//! straight through the store; the abort path (`RolledBack`) is driven by the
//! stall watchdog.

use cross_scout_types::event::EventKind;
pub use cross_scout_types::Stage;

/// Compute the next stage for `current` given `kind`. Returns `None` when the
/// pair is not a forward transition (duplicate, out-of-order, or unrelated).
pub fn next_stage(current: Stage, kind: &EventKind) -> Option<Stage> {
    use EventKind as E;
    use Stage::*;

    match (current, kind) {
        // A mailbox write observed in a sealed block is the inclusion proof.
        // The publisher's 2PC phases (Scheduled..Decided) happen off-chain
        // between these two points, so the visible lifecycle skips them.
        (Requested, E::MessageDispatched { .. } | E::MessageDelivered { .. }) => Some(Included),

        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{Address, B256};

    fn dispatched() -> EventKind {
        EventKind::MessageDispatched {
            key: B256::ZERO,
            session: B256::ZERO,
            src_chain: 1,
            dst_chain: 2,
            sender: Address::ZERO,
            receiver: Address::ZERO,
            label: "eth-transfer".to_string(),
        }
    }

    fn delivered() -> EventKind {
        EventKind::MessageDelivered {
            key: B256::ZERO,
            session: B256::ZERO,
            src_chain: 1,
            dst_chain: 2,
            sender: Address::ZERO,
            receiver: Address::ZERO,
            label: "eth-transfer".to_string(),
        }
    }

    #[test]
    fn sealed_mailbox_write_includes_a_requested_xt() {
        assert_eq!(
            next_stage(Stage::Requested, &dispatched()),
            Some(Stage::Included)
        );
        assert_eq!(
            next_stage(Stage::Requested, &delivered()),
            Some(Stage::Included)
        );
    }

    #[test]
    fn duplicate_mailbox_write_does_not_advance() {
        assert_eq!(next_stage(Stage::Included, &dispatched()), None);
        assert_eq!(next_stage(Stage::Settled, &delivered()), None);
    }

    #[test]
    fn ingress_events_do_not_advance() {
        let requested = EventKind::XtRequested {
            session: B256::ZERO,
            src_chain: 1,
            dst_chain: 2,
            sender: Address::ZERO,
            receiver: Address::ZERO,
            asset: None,
            amount: Default::default(),
            message_id: None,
        };
        assert_eq!(next_stage(Stage::Requested, &requested), None);
    }

    #[test]
    fn settlement_events_do_not_advance_via_the_table() {
        // Settled/Finalized are set-based, applied by the engine straight
        // through the store, so the transition table never emits them.
        let finalized = EventKind::SuperblockFinalized {
            number: 1,
            anchor_root: B256::ZERO,
        };
        assert_eq!(next_stage(Stage::Included, &finalized), None);
        assert_eq!(next_stage(Stage::Settled, &finalized), None);
    }
}
