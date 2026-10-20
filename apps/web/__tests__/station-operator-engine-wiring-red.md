# Station Operator Repair Engine wiring RED checkpoint

Expected failure before implementation:
- runner does not forward `mode` or `repairEngine` to `processClaimedJob`.
- station operator route does not construct/inject `repairEngine`.

The regression tests in this branch must fail until both boundaries are wired.
