# Lattice — Documentation Index

## Hand-written docs (always with help of AI)

| #   | File                                                         | Content                                                              |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 00  | [00-Docs-ReadMe.md](00-Docs-ReadMe.md)                       | List of formal Documents and general remarks for the documentation   |
| 10  | [10-System-Requirements.md](10-System-Requirements.md)       | System requirements by subsystem chapter; REQ-LTTCE-… anchors        |
| 11  | [11-Traceability-Requirements.md](11-Traceability-Requirements.md) | Traceability system rules and ASPICE compliance founding doc   |
| 30  | [30-architecture.md](30-architecture.md)                     | Architecture, technology stack, data flow, CI, feature design        |
| 30t | [30-architecture.trace-cov.md](30-architecture.trace-cov.md) | Trace satellite: ARCH → REQ coverage for 30-architecture.md         |
| 60  | [60-test-strategy.md](60-test-strategy.md)                   | Test pipeline: unit, integration, E2E, coverage, linting             |

## Generated API docs

Generated on every CI run from source code and placed in `docs/gen/`.

| Path                                             | Content                                  |
| ------------------------------------------------ | ---------------------------------------- |
| [gen/frontend/](gen/frontend/frontend-readme.md) | TypeDoc — React/TypeScript API reference |
| [gen/backend/](gen/backend/)                     | `cargo doc` — Rust crate reference       |
