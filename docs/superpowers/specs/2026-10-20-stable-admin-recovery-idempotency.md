# Idempotency

Repeating a successful admin recovery for the same original identity and active auth principal must not move data or create another anonymous identity. It may advance the device-state generation and refresh `updated_at` while preserving the same identity mapping.