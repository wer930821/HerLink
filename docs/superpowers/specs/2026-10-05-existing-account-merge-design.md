# Existing Account Merge Design

## Goal
Allow an existing HerLink anonymous identity to move safely into an already-registered Supabase email/password account without losing anonymous name, chats, messages, contacts, read state, recovery data, or easter-egg progress.

## Safety invariants
- Never sign out or delete the current anonymous Auth user before verification and merge complete.
- Never use email as ownership key; UUID remains the ownership key.
- Existing account credentials must be verified before any merge mutation.
- Merge runs server-side in one database transaction and rolls back on any conflict/error.
- Do not rewrite the partner side of unrelated sessions.
- Preserve message IDs, session IDs, timestamps, and anonymous display name.
- Verify before/after ownership counts before switching the browser session.
- Do not delete either Auth user as part of Phase 1.
- Never expose service-role credentials to the browser.

## Flow
1. Current anonymous session requests existing-account merge after `updateUser(email)` reports an already-registered email.
2. UI asks for the password of that existing HerLink account. The password is submitted directly to Supabase Auth; it is never stored by HerLink.
3. Capture anonymous UUID before credential verification. Verify the existing account with `signInWithPassword` and capture its UUID.
4. A trusted server endpoint receives both verified identities plus proof/session context and invokes one transaction-safe merge RPC.
5. RPC locks the affected rows, validates source and target identities, checks collisions, reassigns ownership-bearing UUID columns, resolves duplicate per-user rows deterministically, and returns before/after counts.
6. Server verifies the returned counts. Only then does the browser keep the existing-account session and reload the application.
7. On any failure, database changes roll back and the original anonymous browser session must be restored where still possible.

## Data coverage
The implementation must discover UUID foreign-key/reference columns from the current schema rather than assuming only a fixed list. At minimum inspect profiles, random_chat_sessions, messages, anonymous_contacts, random_chat_session_reads, anonymous_session_recovery_requests, random_session_icebreaker_events/icebreakers, and current easter-egg/progress tables.

## Conflict policy
- Sessions/messages: preserve records and IDs; replace only source-user ownership references.
- Contacts: if source→target conversion creates duplicate/canonical-pair conflicts, merge approval/status/timestamps into one canonical row rather than dropping relationship state.
- Read/progress/delivery rows: collapse duplicate `(user, object)` rows using the most advanced/latest state appropriate to the table.
- Profile: target Auth UUID becomes the surviving ownership UUID, while the source anonymous display name is preserved only after uniqueness checks. Never silently overwrite another active anonymous identity.
- Unknown ownership table or unresolved unique constraint: abort the entire transaction.

## Verification
Before enabling the UI in Production, run contract/unit tests plus an isolated integration fixture proving: merge success, rollback on conflict, no unrelated-user mutation, stable session/message IDs, preserved anonymous name, and successful login to the target account. Production data for 孤星企鵝 is not used as the integration fixture.
