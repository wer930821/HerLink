# TDD order

The regression test must be committed before the replacement migration. It should demonstrate failure specifically because the current implementation migrates the original identity into the replacement profile. The migration commit then makes the same test pass.