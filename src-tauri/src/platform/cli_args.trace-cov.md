# Trace Coverage — platform/cli_args.rs (and its callers for Chapter CLU)

Satellite file: records which implementation anchors cover which requirements and architecture sections
for Chapter CLU — Command-Line Usage. The export-flag parsing in `cli_args.rs` is recorded in
`../export.trace-cov.md`; the Windows console attach in `impls/windows.trace-cov.md`; the call in
`run()` in `../lib.trace-cov.md`.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-CLU-00001 **covers** REQ-LTTCE-CLU-00001, REQ-LTTCE-CLU-00002  (`classify`, `takes_value`,
  `is_known_option`, `check_options_in`, `usage_text`, `respond_to_options`, `HELP_OPTIONS`, `EXIT_USAGE`;
  also the `Platform::reads_command_line_options` default in `platform/mod.rs` and
  its `true` overrides in `impls/windows.rs`, `impls/linux.rs` and `impls/macos.rs`)
- IMPL-LTTCE-CLU-00001 **covers** ARCH-LTTCE-CLU-00001

## Tests

UTST-LTTCE-CLU-00001 — `cli_args.rs` `mod tests`, `check_options_in` and `classify`:

- valid command lines run; every help option asks for help; help wins over an unknown option either way;
- unknown long, short, `-` and `--` options are reported, the first one wins; near misses are unknown;
- a `--paper` value is not an option unless it starts with `-`; other `/…` arguments stay paths;
- a valued option never swallows the next option (`--color --paper a3`), and every scan — paths, paper,
  export format, option check — agrees on what each argument is;
- `argv[0]` is never an argument; macOS `-NS…` / `-Apple…` overrides are tolerated and their value is
  no file.

UTST-LTTCE-CLU-00002 — `usage_text` names every user option and paper, lists no host-injected argument,
has at most 15 lines of at most 80 columns; `respond_to_options` for Run, Help and Unknown, and with
failing writers.

- STST-LTTCE-CLU-00001 **covers** REQ-LTTCE-CLU-00001, REQ-LTTCE-CLU-00002 end to end:
  `examples/export_demo.rs` `scenario_usage`, on the release binary of every desktop CI[^ci] leg.
- `Platform::reads_command_line_options` on Android and iOS is the trait default (`false`): correct by
  construction; no device test exists.

[^ci]: Continuous Integration — the GitHub Actions build matrix (`.github/workflows/buildAndTest.yml`).
