# Transaction behavior

Validation and device-state takeover are one database operation. Any validation or uniqueness failure aborts the operation. Canonical anonymous chat data is never rewritten during recovery, so a failed recovery cannot leave chats split between old and replacement identities.