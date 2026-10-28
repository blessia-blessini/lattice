# Trace Coverage — scripts/foss/ (foss.mjs and its modules)

Satellite file: records which implementation anchors cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-FOS-00004 **covers** REQ-LTTCE-FOS-00004  (`foss.mjs check`: `cargo-inventory.mjs` per target,
  `npm-inventory.mjs` production closure, `foss/extra-components.json`; `policy.mjs` + `spdx-expr.mjs`
  against `foss/policy.json`; clarifications tied to a sha256, exceptions with expiry; MPL Exhibit B scan)
- IMPL-LTTCE-FOS-00004 **covers** ARCH-LTTCE-FOS-00004
- IMPL-LTTCE-FOS-00002 **covers** REQ-LTTCE-FOS-00002  (`foss.mjs notices [--check]`:
  `licence-texts.mjs` selection + `notices-render.mjs`, opening with the "Licences by type" summary from
  the policy's `types` (copyleft types by `COPYLEFT_TYPES`); `foss.mjs sbom`: `cyclonedx.mjs`; on GitHub Actions
  `writeStepSummary` explains a failing `check` or a stale `notices --check`. `.github/workflows/foss-compliance.yml`
  runs gate, notices check, unit tests and audit on every pull request into dev, Dependabot's included, and
  on every push to dev, and is called by `buildAndTest.yml` with `sbom: true`, the only way that writes the SBOMs)
- IMPL-LTTCE-FOS-00002 **covers** ARCH-LTTCE-FOS-00002
- IMPL-LTTCE-FOS-00001 **covers** REQ-LTTCE-FOS-00001  (`assert-bundled.sh`, the STST of step 390)
- IMPL-LTTCE-FOS-00001 **covers** ARCH-LTTCE-FOS-00001
- IMPL-LTTCE-FOS-00005 **covers** REQ-LTTCE-FOS-00005  (`export-notices.mjs`: `loadEmbedded` of
  `foss/export-embedded.json`, `selectEmbedded` by installed directory, `renderExportNotices` →
  `src/lib/export-notices.generated.txt`, written and drift-checked by `foss.mjs notices [--check]`;
  `licenceBody` shared with `notices-render.mjs`. The export side is in `src/lib/export-document.trace-cov.md`)
- IMPL-LTTCE-FOS-00005 **covers** ARCH-LTTCE-FOS-00005
- IMPL-LTTCE-FOS-00006 **covers** REQ-LTTCE-FOS-00006  (`appimage.mjs`: `loadAppImageList` /
  `validateAppImageList` of `foss/appimage-packages.json`, `evaluateAppImageList` as `shared-library`,
  `renderAppImageSection` with the written offer, `inventoryAppImage` over every file of an unpacked AppImage:
  `classifyShippedFile` (`loadAppImageFiles` globs, `bundlerParts` of `foss/extra-components.json`),
  `checkRuntime` with `readRuntimeCommit`, `dpkgOwners` → `resolveOwners` / `parseDpkgSearch` (architecture) /
  `followFileLinks`, `referencedLicenceTexts`, `dpkgVersions` via `runDpkgTool`; `foss.mjs check` evaluates the
  list and the bundler parts, `notices` renders the section, `appimage` runs the build-machine check and writes
  the AppImage SBOM; `policy.mjs` `LINKAGE_SECTIONS`: `sharedLibrary` and `separateProgram` in `classifyLeaf` /
  `obligationNote`, version `*` for debian only; `cyclonedx.mjs` `pkg:deb` purls. `scripts/appimage-exclude.sh`
  keeps the TIFF loader and the typelibs out; `scripts/appimage-stage-licences.sh` stages the copyright files of
  the owners of the loader, GIO-module and schema folders, and `/usr/share/common-licenses`)
- IMPL-LTTCE-FOS-00006 **covers** ARCH-LTTCE-FOS-00006
- IMPL-LTTCE-FOS-00007 **covers** REQ-LTTCE-FOS-00007  (`audit.mjs`: `runNpmAudit` / `runCargoAudit` via
  `runJsonTool`, `parseNpmAudit` (copy versions from `package-lock.json`), `parseCargoAudit` (warnings as
  informational), `loadAdvisoryExceptions` / `validateAdvisoryExceptions` of `foss/advisory-exceptions.json`,
  `evaluateFindings` against the shipped inventory of `collect`, `renderAuditSummary`, `annotation`;
  `foss.mjs audit [--block]` → `commandAudit`; `.github/workflows/foss-compliance.yml` step 145 installs the
  pinned cargo-audit and passes `--block` on `v*` tags)
- IMPL-LTTCE-FOS-00007 **covers** ARCH-LTTCE-FOS-00007
- IMPL-LTTCE-FOS-00008 **covers** REQ-LTTCE-FOS-00008  (`notice-additions.mjs`: `loadAdditions` /
  `validateAdditions` of `foss/notice-additions.json`, `attachAdditions` (component by ecosystem:name@version,
  SHA-1 per file, `classifyLeaf` per added licence, a text or excerpt per licence), `decodeText` (Windows-1252
  table), `quoteRanges` (gap-limited merging) / `quoteLines`, `readInside` (real path inside the package);
  `foss.mjs` `collect` attaches and checks the export topics, `check` fails on problems and warns on unused
  additions (job summary, annotation), fails on them with `--block` (step 140 on `v*` tags), `notices` refuses on
  problems; `notices-render.mjs` `renderAddition` / `additionsIntro`
  and the added licences in the type summary; `export-notices.mjs` `topics` in `loadEmbedded`,
  `selectEmbedded`, `renderExportNotices`; `foss/licenses/OFL-1.1.txt` and the AOM patent licence text)
- IMPL-LTTCE-FOS-00008 **covers** ARCH-LTTCE-FOS-00008

## Tests

- UTST `spdx-expr.test.mjs` — precedence, parentheses, flattening, legacy `/`, lower-case operators,
  `WITH`, 8 malformed expressions; OR/AND evaluation and the tie-break.
- UTST `policy.test.mjs` — policy validation, the real `foss/policy.json` loads and denies third-party
  GPL/AGPL, exceptions (`WITH`), allowed/obligation/denied/missing/unparsable licences, review → exception →
  expiry, shipped-text preference, clarification evidence matching / changed / missing / other version,
  unused policy entries.
- UTST `inventory.test.mjs` — linked vs build-time (proc-macro, build-dependency), dev-dependencies and the
  app excluded, `--no-deps` metadata rejected; npm nested-before-hoisted resolution, production closure only
  (dev and an unrelated nested copy excluded, peers followed, optional peers not required), missing package,
  lockfile v1 rejected, legacy licence shapes, manifest enrichment.
- UTST `licence-texts.test.mjs` — every SPDX standard text recognised; the MIT "(including the next
  paragraph)" variant is MIT, not MIT-0 (an earlier rule misread bytemuck); combined files; copyright
  extraction skips placeholders, "(c)" list items and lower-case prose, and keeps "(c)2024 X" without a space; text selection (own file, standard,
  template, reworded variant, single-licence file preferred); Exhibit B found in source but not in the MPL
  text itself.
- ITST `foss.test.mjs` — the CLI over a synthetic repository in a temp dir with an injected `cargo
  metadata`: gate passes; a GPL crate fails (negative test); notices written, then missing / stale / CRLF
  checkout detected correctly; one SBOM per target; with `GITHUB_STEP_SUMMARY` set, stale notices write the
  regenerate commands and a failed gate lists its components, a passing run writes nothing, and nothing is
  written outside Actions. Every test starts with `GITHUB_STEP_SUMMARY` cleared, so the fixtures' failing
  gate and stale notices never reach the real summary of the CI job they run in (step 144). Plus renderer determinism and de-duplication, and CycloneDX purls and serial number.
- UTST `policy.test.mjs` / `foss.test.mjs` — an admitted licence without a type fails validation; the type
  lookup; the type summary orders copyleft first, counts linked components, names copyleft components,
  marks unknown licences "unclassified".
- UTST `export-notices.test.mjs` (REQ-LTTCE-FOS-00005) — `export-embedded.json` validation (5 malformed
  shapes); matching by installed directory picks the hoisted copy over a nested one of another version; a
  listed package that is not shipped fails; rendered text names material, licence, copyright and source,
  prints a shared licence text once, falls back to the standard text without the template copyright line,
  points at the exported-documents permission, refuses `*/` and `</style`, normalises CRLF, names a
  component once under a text it uses twice. The cross-check parser (`packagesCopiedBy`): asset imports in
  both quote styles and template literals — any Vite query, every `new URL()` target, and package files
  with a non-code extension even without a query (`.woff2`, `.css`, `.json`) — in static `from`,
  side-effect `import '…'`, `import()` and `new URL()`, scoped packages, `/node_modules/` globs; Lattice's
  own files, bare packages and code files inside packages ignored. On the real tree:
  `foss/export-embedded.json` equals the packages the parser finds in `export-document.ts`.
- ITST `foss.test.mjs` (REQ-LTTCE-FOS-00005) — `notices` writes the export notices beside
  THIRD-PARTY-NOTICES.md with only the embedded package; `--check` reports the stale export file alone;
  an embedded package that is not shipped fails the run.
- UTST `policy.test.mjs` (REQ-LTTCE-FOS-00006) — `sharedLibrary`: the LGPL passes with its obligation for a
  shared library and stays *review* for cargo / npm / build-time components; a whole `WITH` leaf is admitted
  for a shared library only; plain GPL stays denied; types by base id; version `*` for debian only. On the
  real policy: none of the LGPL family or MPL-1.1 passes for a crate or npm package.
- UTST/ITST `appimage.test.mjs` (REQ-LTTCE-FOS-00006) — list validation (7 malformed shapes, duplicates,
  platform default); the real list fits the policy and omits the TIFF path; notices section (written offer,
  rows, platforms); `parseDpkgSearch` (every path, architecture filter); `resolveOwners` credits the real file's
  owner over the -dev symlink's, finds usr/lib files by name in library directories only and other files at
  their exact path;
  `followFileLinks` (POSIX only: chains, directory links untouched, dangling); `inventoryAppImage` on a
  synthetic unpacked AppImage: pass with warning, platform-only warning, unreviewed package (the libjbig
  case), changed copyright file, wrong platform, denied licence, unowned file, owner without copyright folder
  (the typelib case), common-licenses text referenced but not carried, carried package unknown to dpkg-query,
  another runtime commit, the owner lookup asked for the AppImage's architecture, unknown target;
  `listShippedFiles`; `classifyShippedFile` (all five kinds); `globToRegExp` and `validateAppImageFiles`; the real
  globs take Lattice's files and the build's caches but leave typelibs, schemas, WebKit helpers to packages;
  `bundlerParts` (one runtime commit, malformed entries, the real file); `readRuntimeCommit` on a synthetic
  ELF64 (commit inside the runtime found, a decoy in the squashfs ignored, non-ELF refused); `checkRuntime`
  (short and full hash, another commit, none, absent bundler part);
  `referencedLicenceTexts` (sentence-ending dot, duplicates, none); `runDpkgTool` (stdout kept on exit 1, thrown on
  a missing tool or another status); the notices section keeps placeholders in code spans; the real list names the
  module-only packages; `commandAppImage` writes the SBOM with `pkg:deb` purls, warns about an absent bundler
  part, exits 1 on problems and on another runtime commit.
- UTST `policy.test.mjs` (REQ-LTTCE-FOS-00006) — `separateProgram`: its licences pass with its own note for a
  separate program only, each linkage keeps to its own section, the section is validated; on the real policy
  libfuse (LGPL-2.1-only) passes as a separate program and not as a crate.
- STST CI step 391 on both Linux legs: `foss.mjs appimage --appimage` on the AppImage just built, with the
  runner's dpkg — also the end-to-end check of steps 340 (no TIFF loader, no typelib) and 341 (staged files);
  step 392 uploads its SBOM, 901.8 / 903.1 publish it.
- ITST on the real tree: CI job `foss-compliance` (and the full local `build-test`) runs `check` and
  `notices --check` over all 8 targets — in every build, and on every pull request into dev.
- STST `assert-bundled.sh`, CI step 390 — locally verified only for MSIX (an old package fails, a package
  with the files passes next to a decoy LICENSE, no package fails); NSIS, deb, AppImage and dmg run on CI.
- UTST `audit.test.mjs` (REQ-LTTCE-FOS-00007) — npm report: one finding per installed copy and advisory with
  the lockfile version, a dependency-only entry skipped, an advisory without GHSA url, an advisory naming
  another package ignored, error report and unknown formats refused; cargo report: vulnerabilities, unsound and
  yanked (no advisory) as informational, clean report, unknown formats, a warnings entry that is not a list
  skipped; `runJsonTool` keeps a report printed with exit 1, names the error line of stderr (else its last line)
  when the tool cannot run, refuses non-JSON; exceptions file (the real one loads, GHSA / RUSTSEC / CVE ids, 7
  malformed entries, an npm exception only by GHSA id); `evaluateFindings`: shipped → blocking, development and
  informational never, exception by id or alias until its expiry day, an expired one blocks, ecosystem and
  package must match, an exception for a development package is unused, a copy without version counts as
  shipped; summary only says "release blocked" with `--block`, lists tools not audited and unused exceptions,
  escapes cells and keeps every row and list item on one line; annotation escaping. The four review-cycle-1
  tests (F1, F2, F3, F5) were run against the unfixed module and failed there.
- ITST `foss.test.mjs` (REQ-LTTCE-FOS-00007) — `commandAudit` over the synthetic repository with injected
  reports: report-only exits 0 with warnings, annotations (only on Actions) and the job summary; `--block`
  exits 1 on a vulnerable shipped component (negative test), 0 with valid exceptions and 1 again after their
  expiry, 2 when an audit could not run (0 without `--block`); unused exceptions warned; a malformed
  exceptions file refused; `parseArgs` for `audit` / `--block`.
- ITST on the real tree: CI step 145 runs `foss.mjs audit` over the real lock files and advisory databases on
  every pull request into dev and in every build; on a `v*` tag with `--block` it is the release gate (STST of
  REQ-LTTCE-FOS-00007). Locally verified 2026-10-25 with cargo-audit 0.22.2: 0 blocking, 2 development
  (vitest), 6 informational.
- UTST `notice-additions.test.mjs` (REQ-LTTCE-FOS-00008) — file validation (23 malformed shapes: format,
  list, topic id, duplicate, package, licences, files, a path leaving the package, an absolute path, `./a`,
  `a/./b`, `x/..`, `C:foo`, `C:/x`, backslash, UNC, `a//b`, trailing slash, no SHA-1, inverted range, line 0,
  copyrights; dots inside names accepted); `readInside` reads inside, refuses a folder and a link out (when
  the OS allows creating one); the review-cycle-1 regressions — gap-limited merging, a partly quoted file
  names only its unquoted range, an excerpt's licence ids and users listed once, a licence counted once per
  component, a backtick in a path escaped (all failed against 70156cf); `decodeText` UTF-8, binary, Windows-1252 quotes and dashes; `quoteLines`
  normalised, past the end, too many lines, too long a line, blank only; `quoteRanges` merges or keeps apart;
  `attachAdditions` quotes a matching file, fails on a changed or missing file, a denied added licence, a
  licence with neither text nor excerpt (a font), warns on a version not shipped, gives every entry [];
  `renderAddition` lines, `additionsIntro`, added licences in the type summary.
- UTST `export-notices.test.mjs` (REQ-LTTCE-FOS-00008) — `topics` read and refused when not topic ids;
  `selectEmbedded` picks the named additions and fails for a topic the package has none for;
  `renderExportNotices` prints the added licence, its copyright lines and its standard text.
- ITST `foss.test.mjs` (REQ-LTTCE-FOS-00008) — over the synthetic repository: an addition whose file matches
  passes `check`, and `notices` names the scan, the decision, the copyright line and quotes the line; the same
  file changed fails `check` and `notices` (negative test); an addition for another version warns (console, job
  summary, `::warning`) and passes, and fails with `--block`; an export topic without an addition fails `check`
  with exit 1 and `notices --check` with 1, not a crash.
- ITST on the real tree: `foss/notice-additions.json` from Legattice run 40730716667 (Lattice v0.3.50, 28
  additions for 20 packages) passes `check` on v0.3.51 and is rendered by `notices`; `notices --check` in CI
  keeps the committed files in step with it.
