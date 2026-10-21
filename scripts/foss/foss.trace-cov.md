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
  the policy's `types`; `foss.mjs sbom`: `cyclonedx.mjs`)
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
  `renderAppImageSection` with the written offer, `inventoryAppImage` over an unpacked AppImage with
  `dpkgOwners` → `resolveOwners` / `followFileLinks` and `dpkgVersions`; `foss.mjs check` evaluates the list,
  `notices` renders the section, `appimage` runs the build-machine check and writes the AppImage SBOM;
  `policy.mjs` `sharedLibrary` scope in `classifyLeaf` / `obligationNote`, version `*` for debian only;
  `cyclonedx.mjs` `pkg:deb` purls. `scripts/appimage-exclude-loaders.sh` keeps the TIFF loader out;
  `scripts/appimage-stage-licences.sh` stages the module owners' copyright files and
  `/usr/share/common-licenses` for the AppImage, checked by `referencedLicenceTexts` in the gate)
- IMPL-LTTCE-FOS-00006 **covers** ARCH-LTTCE-FOS-00006

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
  extraction skips placeholders, "(c)" list items and lower-case prose; text selection (own file, standard,
  template, reworded variant, single-licence file preferred); Exhibit B found in source but not in the MPL
  text itself.
- ITST `foss.test.mjs` — the CLI over a synthetic repository in a temp dir with an injected `cargo
  metadata`: gate passes; a GPL crate fails (negative test); notices written, then missing / stale / CRLF
  checkout detected correctly; one SBOM per target. Plus renderer determinism and de-duplication, and
  CycloneDX purls and serial number.
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
  rows, platforms); `parseDpkgSearch`; `resolveOwners` credits the real file's owner over the -dev symlink's;
  `followFileLinks` (POSIX only: chains, directory links untouched, dangling); `inventoryAppImage` on a
  synthetic unpacked AppImage: pass with warning, platform-only warning, unreviewed package (the libjbig
  case), changed copyright file, wrong platform, denied licence, unowned library, owner without copyright
  folder, common-licenses text referenced but not carried, carried package unknown to dpkg-query, unknown target;
  `referencedLicenceTexts` (sentence-ending dot, duplicates, none); `runDpkgTool` (stdout kept on exit 1, thrown on
  a missing tool or another status); the notices section keeps placeholders in code spans; the real list names the
  module-only packages; `commandAppImage` writes the SBOM with `pkg:deb` purls and exits 1 on problems.
- STST CI step 391 on both Linux legs: `foss.mjs appimage` on the AppImage just built, with the runner's dpkg;
  step 392 uploads its SBOM, 901.8 / 903.1 publish it.
- ITST on the real tree: CI job `foss-compliance` (and the full local `build-test`) runs `check` and
  `notices --check` over all 8 targets.
- STST `assert-bundled.sh`, CI step 390 — locally verified only for MSIX (an old package fails, a package
  with the files passes next to a decoy LICENSE, no package fails); NSIS, deb, AppImage and dmg run on CI.
