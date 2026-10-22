# Stable Admin Recovery Design

## Goal

Make administrator-assisted anonymous recovery restore the original anonymous identity instead of moving that identity's chats, messages, contacts, or display name onto a replacement Web/auth profile.

## Identity model

`profiles.id` for the original anonymous identity is canonical and remains the owner of anonymous chat data. A replacement/current auth user is only a device/auth principal. Recovery binds that principal to the original anonymous identity through `anonymous_identity_device_state`.

## Admin recovery behavior

Given an approved legacy 8-character session recovery request:

1. Resolve the selected session side as the original anonymous identity.
2. Resolve the requester/current Web user as the active auth principal.
3. Validate that the requester is not the opposite participant and that both profiles exist.
4. Preserve the original profile name and ID.
5. Do not rewrite `random_chat_sessions`, `random_chat_messages`, `anonymous_contacts`, or the original profile to the replacement ID.
6. Remove a stale device-state mapping for the current auth principal when it points to a different identity, then bind `active_auth_user_id` to the original `anonymous_identity_id`.
7. Increment generation on an existing mapping so stale devices can be invalidated consistently.
8. Mark the recovery request approved only after the stable identity binding succeeds in the same recovery transaction/operation.

## Compatibility

Legacy 8-character admin recovery remains supported. Existing permanent/self-service recovery continues using the same stable identity concept. No new third identity mechanism is introduced.

## Conflict and rollback rules

Recovery must fail without partial mutation when the selected session does not exist, the side is invalid, the current auth user is the opposite participant, either profile is missing, or the current auth principal cannot be uniquely bound to the original identity. Unique violations must surface as an administrator-readable recovery conflict.

The operation must be idempotent: retrying a completed recovery repairs/refreshes the same original-identity mapping rather than moving data or creating another identity.

## UI/API contract

The admin Web client keeps its existing recovery action shape. The backing RPC is changed so the successful result means stable identity restoration, not data migration. The admin UI should continue to show success/failure without requiring operators to understand device-state internals.

## Verification

Automated coverage must prove:

- original anonymous profile ID and display name remain unchanged;
- original active sessions remain owned by the original ID;
- messages remain attributed to the original ID;
- active contacts remain attached to the original ID;
- current auth user resolves to the original identity after recovery;
- retry is idempotent;
- conflicts roll back rather than producing a split identity;
- legacy 8-character recovery remains callable from the admin client.

## Deployment safety

Implement on `fix/stable-admin-recovery`. Do not modify production data as part of development. Run recovery-focused tests and the existing stable-identity verification before merging to `main`.