# Summary

Admin recovery restores identity, not data ownership. Original anonymous profile remains canonical; current auth principal is mapped to it. Legacy recovery code remains supported, retries are idempotent, conflicts roll back, and CI prevents regression to data migration.