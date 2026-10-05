# Trace Coverage — export.rs / paper.rs / lib.rs (`build_window_with_file_ex`) / platform/cli_args.rs / platform/mod.rs (`print_to_pdf`, `PdfDone`, `written_pdf_result`) / platform/impls/{windows,linux,macos}.rs / src/lib/print-style.ts / src/lib/export-document.ts

Satellite file: records which implementation anchors in the headless `--export-html` / `--export-pdf`
path cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

## HTML export

- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00002
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00003 **covers** ARCH-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00004 **covers** REQ-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00004 **covers** ARCH-LTTCE-XPT-00001
- IMPL-LTTCE-XPT-00008 **covers** REQ-LTTCE-XPT-00013  (`export-document.ts` `buildExportDocument`:
  doctype, UTF-8 head, file-name title, KaTeX's sheet with its woff2 fonts as `data:` URLs; the body
  unchanged)
- IMPL-LTTCE-XPT-00008 **covers** ARCH-LTTCE-XPT-00004
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00013  (`App.tsx` HTML launch branch loads
  `export-document.ts` with a dynamic `import()` and wraps `buildExportHtml`'s output)
- IMPL-LTTCE-XPT-00008 **covers** REQ-LTTCE-XPT-00014  (`export-document.ts` also embeds
  `preview-theme.css` and github-markdown-css and wraps the body in a themed `.markdown-body` article)
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00014  (`App.tsx` passes the preview root's
  `data-theme`, read from the DOM)
- IMPL-LTTCE-XPT-00001 **covers** REQ-LTTCE-XPT-00014  (`preview-copy.ts` `waitForPreviewSettled` waits
  for code highlighting too — see `src/components/Mermaid.trace-cov.md`)
- IMPL-LTTCE-PRV-00002 **covers** REQ-LTTCE-XPT-00014  (`HighlightedCode.tsx` marks a block pending
  while its parser loads — see `src/components/HighlightedCode.trace-cov.md`)

## PDF export

- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00004  (frontend launch branch, `App.tsx`)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00004  (orchestration + output naming, `export.rs`)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00005
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00006  (bounded `PDF_PRINT_TIMEOUT`, per-file failure)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00008  (`render_timeout(is_first_export)`: 90 s for
  the first export of a process, 45 s after; the elapsed budget is named in the timeout message)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00009  (`settle_budget(render_timeout(..))` handed
  to the frontend as `exportSettleMs` via `ExportLaunch` / `build_window_with_file_ex`; one derived
  bound instead of a separate frontend clock)
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00010  (`build_window_with_file_ex` builds export
  windows with `background_throttling(Disabled)`, so WebKit does not throttle the invisible page;
  macOS 14+, a no-op elsewhere) — no unit test: a builder call with no logic of its own, exercised by
  ITST-LTTCE-XPT-00010 on the macOS legs
- IMPL-LTTCE-XPT-00004 **covers** REQ-LTTCE-XPT-00006  (non-zero process exit code)
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00004  (host-WebView print backends)
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00006  (unsupported platform reported as a failure)
- IMPL-LTTCE-XPT-00005 **covers** ARCH-LTTCE-XPT-00002
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00007  (Linux: GTK file print backend + named printer,
  so no configured printer is needed; Windows and macOS never involved one)
- IMPL-LTTCE-XPT-00006 **covers** REQ-LTTCE-XPT-00004  (shared print stylesheet, `lib/print-style.ts`)
- IMPL-LTTCE-XPT-00006 **covers** ARCH-LTTCE-XPT-00002

## Page geometry (paper and margins)

- IMPL-LTTCE-XPT-00007 **covers** REQ-LTTCE-XPT-00011  (`paper.rs` `PaperSize`; `cli_args.rs`
  `paper_size_in` / `file_paths_in` / `VALUED_OPTIONS`; `setup_handler` validates before any window)
- IMPL-LTTCE-XPT-00007 **covers** REQ-LTTCE-XPT-00012  (`paper.rs` `PageMargins` — 2 cm all round
  with header/footer, otherwise 1 cm top/right/bottom and 2 cm left — and portrait sizes;
  `platform::page_margins()` over `Platform::draws_page_header_footer`, `true` on Windows only)
- IMPL-LTTCE-XPT-00007 **covers** ARCH-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00012  (per-host page setup: `windows_print_settings`,
  `linux_page_setup`, `macos_print_info`; macOS print operation instead of the snapshot API)
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00004  (macOS now paginates — the snapshot did not)
- IMPL-LTTCE-XPT-00005 **covers** REQ-LTTCE-XPT-00006  (`written_pdf_result`: success needs a
  non-empty file, on every backend)
- IMPL-LTTCE-XPT-00005 **covers** ARCH-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00003 **covers** REQ-LTTCE-XPT-00012  (`ExportLaunch::page_margins` /
  `page_margins_mm_json` hands `platform::page_margins()` to the export window as
  `exportPageMarginsMm`, PDF only, via `build_window_with_file_ex`)
- IMPL-LTTCE-XPT-00003 **covers** ARCH-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00006 **covers** REQ-LTTCE-XPT-00012  (`print-style.ts` `resolvePageMargins` +
  `buildPrintStyleCss` make those margins the document's only `@page` margin — `App.css` declares
  none; Ctrl-P gets `PRINT_DEFAULT_MARGINS_MM` — so macOS, where WebKit writes the CSS margin back
  over `NSPrintInfo`'s, prints the same margins as the host API was given)
- IMPL-LTTCE-XPT-00006 **covers** ARCH-LTTCE-XPT-00003
- IMPL-LTTCE-XPT-00002 **covers** REQ-LTTCE-XPT-00012  (`App.tsx` passes `exportPageMarginsMm` to
  `applyPrintStyle` in the PDF launch branch)

---

## Test coverage of the anchors above

| Anchor                | Unit / automatic tests                                                        |
| :-------------------- | :---------------------------------------------------------------------------- |
| IMPL-LTTCE-XPT-00002  | `src/App.test.tsx` — *App — headless export launch* (23 cases, incl. the signal-ordering regression, the three REQ-LTTCE-XPT-00009 cases, the four REQ-LTTCE-XPT-00010 cases, three REQ-LTTCE-XPT-00012 cases — a PDF launch repeats Rust's margins in `@page`, a later `beforeprint` keeps them (the macOS regression), a malformed value prints with the 20 mm default — and one REQ-LTTCE-XPT-00013 case: an HTML launch hands back a whole document titled with the file name and carrying KaTeX's sheet — and two REQ-LTTCE-XPT-00014 cases: the exported article carries the preview root's class and theme, and the preview is serialised in the same turn it settled — the CI run 37351395621 regression) |
| IMPL-LTTCE-XPT-00008  | `src/lib/export-document.test.ts` (29 cases — 11 of them for REQ-LTTCE-XPT-00014, listed in `src/lib/export-document.trace-cov.md`; the REQ-LTTCE-XPT-00013 ones against the sheet and fonts this build bundles: the MathML-hiding and root-bar-clipping rules survive, one embedded woff2 per `@font-face` the shipped sheet declares and no relative font URL left; `fontDataUrlsByName` on both path separators; `inlineKatexFonts` on minified and quoted `src:` lists, the declaration boundary, a missing font throws; `escapeHtmlText`; `buildExportDocument` — doctype and charset, body unchanged, the one `<style>`, an escaped title) |
| IMPL-LTTCE-XPT-00003  | `src-tauri/src/export.rs` `mod tests` (31 cases, incl. the two `resolved_output_path` cases — a relative source such as `demo.md` gets an absolute output path, REQ-LTTCE-XPT-00005 — the three `remove_previous_output` cases — an earlier PDF is gone before the host prints, REQ-LTTCE-XPT-00006 — `is_expected_sender`, the two REQ-LTTCE-XPT-00008 budget cases, one of which guards the numbers against being tightened back to where a correct render fails, four REQ-LTTCE-XPT-00009 `settle_budget` / `ExportLaunch` cases, and two REQ-LTTCE-XPT-00012 `page_margins_mm_json` cases — PDF margins in millimetres, none for HTML); `platform/cli_args.rs` `mod tests` |
| IMPL-LTTCE-XPT-00004  | ITST-LTTCE-XPT-00010 — `src-tauri/examples/export_demo.rs` (`export-html`, `export-pdf (default paper)`, `export-pdf --paper a3`, `export-pdf --paper letter (relative path)`, `export-pdf --paper a5 (unknown)`, `missing-input`); not unit-testable, needs a real process exit (see ARCH-LTTCE-XPT-00001) |
| IMPL-LTTCE-XPT-00007  | `src-tauri/src/paper.rs` `mod tests` (12 cases — sizes in every unit against the standards, default, names, case, portrait; margins: 2 cm all round for a header/footer host, 1 / 1 / 1 cm and 2 cm left otherwise, and their log text); `platform/cli_args.rs` `mod tests` (12 paper / file-path cases — both spellings, position, default, unknown and missing values, first wins, near misses, a paper value never taken for a file) |
| IMPL-LTTCE-XPT-00005  | `platform/mod.rs` `mod tests` (`PdfDone`; `written_pdf_result`, 4 cases — success needs a non-empty file, a stale file never masks a failure); `platform/impls/linux.rs` `mod linux_print_tests` (4 cases — printer-name resolution incl. the localized and blank-override cases, REQ-LTTCE-XPT-00007; pure, no environment mutation; compiled and run on the Linux leg only); host backends: ITST-LTTCE-XPT-00010 per desktop platform |
| IMPL-LTTCE-XPT-00006  | `src/lib/print-style.test.ts` (30 cases, incl. 17 for REQ-LTTCE-XPT-00012 — `resolvePageMargins` accepts four finite non-negative sides and rejects nine malformed shapes; `@page` margin in CSS side order, the 20 mm default without margins, exactly one margin declaration either way; `PRINT_DEFAULT_MARGINS_MM` matches `paper.rs`; `App.css` declares no margin in any `@page` rule — the macOS regression guard) |

## Integration test

- ITST-LTTCE-XPT-00010 **covers** IMPL-LTTCE-XPT-00003, IMPL-LTTCE-XPT-00004, IMPL-LTTCE-XPT-00005,
  IMPL-LTTCE-XPT-00007, IMPL-LTTCE-XPT-00008
- ITST-LTTCE-XPT-00010 **covers** REQ-LTTCE-XPT-00013 end to end: `export-html` must start with
  `<!DOCTYPE html>`, carry KaTeX's MathML-hiding rule, embed at least one `data:font/woff2` font and
  contain no relative `url(fonts/` (`check_standalone`; 3 unit cases in `cargo test --example
  export_demo`, one of them the bare v0.3.32 fragment, which must fail). The KaTeX-markup check now
  looks for `class="katex"`, since the embedded sheet alone contains the bare word. What a browser
  *draws* is not asserted — no headless browser is run in CI.
- ITST-LTTCE-XPT-00010 **covers** REQ-LTTCE-XPT-00014 end to end: `export-html` must wrap the body in
  `<article class="markdown-body" data-theme="…">`, carry github-markdown-css and the code-token
  palette, contain highlighted `tok-keyword` tokens, and leave no `data-lattice-highlight-pending`
  block (`check_preview_look`; 3 unit cases, one of them the unwrapped, unstyled export of `463ad53`,
  which must fail).
- ITST-LTTCE-XPT-00010 **covers** REQ-LTTCE-XPT-00011 and REQ-LTTCE-XPT-00012 end to end: the default
  export must be A4 portrait, and `--paper a3` / `--paper letter` exports A3 / Letter portrait (read
  from the PDF's `/MediaBox`, within 1.5 pt; expected sizes from `paper.rs` itself); every one must
  have at least 2 pages (counted `/Type /Page` objects; a print clipped to one window-high page has the
  right size but one page), and `--paper a5` must exit `1` with no file. All three PDFs are published
  per platform (`published_name`: `demo-<platform>.pdf`, `.a3.pdf`, `.letter.pdf`). The page-size,
  page-count and naming rules have their own unit tests (`cargo test --example export_demo`, 10 of
  27 cases), including the 800 × 568 pt one-page macOS snapshot of v0.3.28 as a case that must fail.
  The **margins** of REQ-LTTCE-XPT-00012 are not in the bytes — a PDF records only where the host
  drew. So every exported PDF is rendered at one pixel per point (`pdf_ink_margins`, the pure-Rust
  `hayro` rasterizer, a dev-dependency only) and the ink's distance from each edge must match
  `lattice_lib::page_margins()` — the margins this build prints with — within 3 pt; on a page with
  the running header and footer, the top and bottom ink must be that header and footer, inside the
  margin (`check_margins`). The measured margins are printed beside every verdict. Unit tests (11 of
  the 27): the ink box, per-page and per-document folding, and the real hosts' measurements of CI run
  37221149163 — Linux and Windows pass, macOS's 2 cm and Linux v0.3.28's near-zero margins fail.
- ITST-LTTCE-XPT-00010 **covers** REQ-LTTCE-XPT-00010 end to end: the first export of a process, on
  every desktop leg, must finish without timer or idle scheduling in a hidden window. It found the
  defect (macos-intel, run 36311605228, 2026-09-27: `export-html` produced nothing in 90 s after a
  ~9 s pass the day before). One green run does not prove an intermittent fault gone; several do.
- ITST-LTTCE-XPT-00010 **covers** REQ-LTTCE-XPT-00009 end to end: `export-html` asserts exactly one
  `alt="Mermaid diagram"` `<img>` per ```` ```mermaid ```` fence of the staged `demo.md` (counted from
  the source, not a constant) and no leftover `.mermaid` container. It caught the partial export on
  the macos-intel leg (run 36260972990) — though with a wrong rule: it counted every
  `data:image/png` against a hard-coded 5, while demo.md has 4 diagrams *and* 2 embedded pictures, so
  it would have passed an export missing one diagram, and its "2" in that run meant at most 2
  diagrams, most likely 0. Fixed in cycle 1 of the review; the counting rule has its own unit tests
  (`cargo test --example export_demo`, 6 cases), run by `build-test.ps1` / `.sh` before the check.

`src-tauri/examples/export_demo.rs` — the headless round trip on `docs/demo/demo.md`: both formats
produce a correct file beside the input and exit `0`, an unreadable input exits `1` and writes
nothing. Run as step 1d of `build-test.ps1` / `build-test.sh` and on **every desktop leg** of the CI
matrix (see `docs/60-test-strategy.md`).

**Runtime verification status of IMPL-LTTCE-XPT-00005** — the host print backends are FFI callbacks
into WebView2 / WebKitGTK / WKWebView, so neither unit tests nor the E2E harness can reach them.
ITST-LTTCE-XPT-00010 reaches them by running the real binary:

- Windows — verified by hand, and now by ITST-LTTCE-XPT-00010 on the `windows-desktop` and
  `windows-arm-desktop` legs.
- Linux — the gtk/glib calls in the fix were checked against the crate APIs by two independent
  review models (`GtkSettingsExt`, `Settings::default() -> Option<Settings>`,
  `dgettext(Option<&str>, &str) -> GString`), but the file has still never been **compiled**: it is
  not built on Windows at all. Confidence, not proof.
- Linux — ITST-LTTCE-XPT-00010 executed it for the first time on 2026-09-26 and it FAILED, exactly as
  the paragraph above predicted: `WebKitGTK print failed: Printer not found`, because the settings
  named no printer and the runner has none. Fixed by REQ-LTTCE-XPT-00007 (file print backend + named
  printer). Still **unproven rather than verified**: the fix itself has not yet gone green on that leg,
  and it cannot be exercised on a Windows development machine at all, since `impls/linux.rs` is not
  compiled there.
- macOS — ITST-LTTCE-XPT-00010 did not reach the backend on 2026-09-26: it found no binary, because
  Tauri deletes `bundle/macos/*.app` once the DMG is written. The check now mounts the DMG and runs the
  `.app` inside it, so it tests what a user downloads; **unproven** until that leg goes green.

- 2026-09-27, page geometry (REQ-LTTCE-XPT-00011 / 00012) — **Windows** and **Linux** run by hand
  from fresh release builds: A4, A3 and Letter each at the exact size with 2 cm margins, `--paper a5`
  and a bare `--paper` exit `1` with no file. Linux ran in WSL (Ubuntu 24.04, WebKitGTK 2.52), so
  `impls/linux.rs` is now compiled, linted and executed locally, no longer confidence only. **macOS**
  — the new print operation was type-checked and linted from Windows (`cargo check`/`clippy --target
  aarch64-apple-darwin`, with a stand-in C compiler for one dependency's build script); it has
  **never run**: ITST-LTTCE-XPT-00010 on the macOS legs is its first execution.
- Android, iOS — the `Platform::print_to_pdf` default refusal applies; no device test exists.
