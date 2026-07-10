//! Mailbox-specific correlation helpers.

use alloy::primitives::Address;
use cross_scout_store::write::XtIdentity;

const ACK_LABEL: &str = "ACK";

pub(crate) fn xt_identity_from_mailbox<'a>(
    label: &'a str,
    src_chain: i32,
    dst_chain: i32,
    sender: &'a Address,
    receiver: &'a Address,
) -> Option<XtIdentity<'a>> {
    (label != ACK_LABEL).then_some(XtIdentity::new(
        src_chain,
        dst_chain,
        sender,
        receiver,
        Some(label),
    ))
}

#[cfg(test)]
mod tests {
    use alloy::primitives::Address;

    use super::{xt_identity_from_mailbox, ACK_LABEL};

    #[test]
    fn ack_mailbox_message_does_not_supply_xt_identity() {
        let sender = Address::repeat_byte(0x11);
        let receiver = Address::repeat_byte(0x22);

        assert!(xt_identity_from_mailbox(ACK_LABEL, 2, 1, &sender, &receiver).is_none());
    }

    #[test]
    fn non_ack_mailbox_message_supplies_xt_identity() {
        let sender = Address::repeat_byte(0x11);
        let receiver = Address::repeat_byte(0x22);

        let identity =
            xt_identity_from_mailbox("eth-transfer", 1, 2, &sender, &receiver).expect("identity");

        assert_eq!(identity.src_chain, 1);
        assert_eq!(identity.dst_chain, 2);
        assert_eq!(identity.sender, &sender);
        assert_eq!(identity.receiver, &receiver);
        assert_eq!(identity.label, Some("eth-transfer"));
    }
}
