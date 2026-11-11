# Stable Admin Recovery Execution Checklist

Implementation follows `2026-10-20-stable-admin-recovery.md` and its design spec.

- RED: add focused test proving original anonymous identity is preserved.
- GREEN: add replacement migration that binds current auth principal to original identity.
- Compatibility: keep legacy 8-character admin recovery entry point.
- CI: prevent source-to-target chat/session/contact migration from returning.
- Verification: run focused recovery and permanent-recovery tests before PR readiness.

No production IDs or one-off repair SQL belong in this change.