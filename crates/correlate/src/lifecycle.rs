//! The per-XT lifecycle state machine.
//!
//! Events arrive out of order, from several chains, and some never arrive.
//! [`next_stage`] is a pure transition table: given an XT's current [`Stage`]
//! and one decoded [`EventKind`], it returns the stage the XT should move to,
//! or `None` if the event doesn't advance it (duplicate, out-of-order, or
//! unrelated). Persisted advances are monotonic, so a `None` or a backward
//! transition is simply dropped by the store.

use cross_scout_types::event::EventKind;
pub use cross_scout_types::Stage;

/// Compute the next stage for `current` given `kind`. Returns `None` when the
/// pair is not a forward transition (duplicate, out-of-order, or unrelated).
pub fn next_stage(current: Stage, kind: &EventKind) -> Option<Stage> {
    use EventKind as E;
    use Stage::*;

    let next = match (current, kind) {
        // request → scheduled once the Shared Publisher opens the instance
        (Requested, E::InstanceStarted { .. }) => Scheduled,

        // scheduled → simulating on the first mailbox message we can attribute
        (Scheduled, E::MessageDispatched { .. }) | (Scheduled, E::MessageDelivered { .. }) => {
            Simulating
        }

        // → voting on the first sequencer vote (mailbox stage may be skipped)
        (Scheduled, E::SequencerVoted { .. }) | (Simulating, E::SequencerVoted { .. }) => Voting,

        // any abort decision rolls the XT (and its sibling effects) back - 2PC
        (_, E::InstanceDecided { commit: false, .. }) => RolledBack,

        // unanimous commit → decided
        (Voting, E::InstanceDecided { commit: true, .. })
        | (Simulating, E::InstanceDecided { commit: true, .. }) => Decided,

        // decided → included via a flashblock pre-conf or a sealed block
        (Decided, E::Flashblock { .. }) | (Decided, E::BlockSealed { .. }) => Included,

        // included → settled when its superblock is proposed
        (Included, E::SuperblockProposed { .. }) => Settled,

        // settled → validated → finalized as the superblock proves out on L1
        (Settled, E::SuperblockValidated { .. }) => Validated,
        (Validated, E::SuperblockFinalized { .. }) => Finalized,

        _ => return None,
    };
    Some(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::B256;

    #[test]
    fn happy_path_walks_all_nine_stages() {
        let started = EventKind::InstanceStarted {
            instance_id: B256::ZERO,
            period: 1,
            seq: 0,
            chains: vec![1, 2],
            xt_hash: B256::ZERO,
        };
        let dispatched = EventKind::MessageDispatched {
            id: B256::ZERO,
            dst_chain_id: 2,
            session: B256::ZERO,
            header: Default::default(),
            body_hash: B256::ZERO,
        };
        let voted = EventKind::SequencerVoted {
            instance_id: B256::ZERO,
            chain_id: 1,
            commit: true,
        };
        let decided = EventKind::InstanceDecided {
            instance_id: B256::ZERO,
            commit: true,
        };
        let flash = EventKind::Flashblock {
            chain_id: 1,
            xt_hash: B256::ZERO,
            index: 0,
        };
        let proposed = EventKind::SuperblockProposed {
            number: 10,
            mailbox_root: B256::ZERO,
            chains: vec![1, 2],
        };
        let validated = EventKind::SuperblockValidated {
            number: 10,
            proof_id: B256::ZERO,
        };
        let finalized = EventKind::SuperblockFinalized {
            number: 10,
            l1_tx: B256::ZERO,
            l1_block: 100,
        };

        let mut s = Stage::Requested;
        for (ev, expect) in [
            (&started, Stage::Scheduled),
            (&dispatched, Stage::Simulating),
            (&voted, Stage::Voting),
            (&decided, Stage::Decided),
            (&flash, Stage::Included),
            (&proposed, Stage::Settled),
            (&validated, Stage::Validated),
            (&finalized, Stage::Finalized),
        ] {
            s = next_stage(s, ev).expect("transition should apply");
            assert_eq!(s, expect);
        }
    }

    #[test]
    fn abort_rolls_back_from_voting() {
        assert_eq!(
            next_stage(
                Stage::Voting,
                &EventKind::InstanceDecided {
                    instance_id: B256::ZERO,
                    commit: false,
                },
            ),
            Some(Stage::RolledBack)
        );
    }

    #[test]
    fn duplicate_event_does_not_advance() {
        // already Decided, a stray vote must not move it
        assert_eq!(
            next_stage(
                Stage::Decided,
                &EventKind::SequencerVoted {
                    instance_id: B256::ZERO,
                    chain_id: 1,
                    commit: true
                }
            ),
            None
        );
    }
}
