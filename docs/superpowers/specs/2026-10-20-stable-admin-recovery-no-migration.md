# Forbidden recovery behavior

Admin recovery must not update `random_chat_sessions`, `random_chat_messages`, or `anonymous_contacts` merely to replace the canonical anonymous ID with the current auth ID. Such ownership rewrites are the regression this change prevents.