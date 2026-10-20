# Release gate

Do not merge solely because the migration compiles. Require focused regression tests plus existing permanent-recovery verification, inspect the diff for ownership rewrites, and require GitHub Actions success.