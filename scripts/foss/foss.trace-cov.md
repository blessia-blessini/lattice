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
  both quote styles and template literals, any Vite query, static `from`, `import()`, `new URL()`, scoped
  packages, `/node_modules/` globs; Lattice's own files and plain code imports ignored. On the real tree:
  `foss/export-embedded.json` equals the packages the parser finds in `export-document.ts`.
- ITST `foss.test.mjs` (REQ-LTTCE-FOS-00005) — `notices` writes the export notices beside
  THIRD-PARTY-NOTICES.md with only the embedded package; `--check` reports the stale export file alone;
  an embedded package that is not shipped fails the run.
- ITST on the real tree: CI job `foss-compliance` (and the full local `build-test`) runs `check` and
  `notices --check` over all 8 targets.
- STST `assert-bundled.sh`, CI step 390 — locally verified only for MSIX (an old package fails, a package
  with the files passes next to a decoy LICENSE, no package fails); NSIS, deb, AppImage and dmg run on CI.
