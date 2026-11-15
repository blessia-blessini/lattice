# Trace Coverage — release-mentions.mjs

Satellite file: records which constraints `release-mentions.mjs` covers.
Format: `IMPL` **covers** `CSTR-ID`

---

- `quoteMentions` **covers** CSTR-LTTCE-BLD-00002  (every bare `@name` outside inline code and fenced
  blocks put in backticks; e-mail addresses, URL paths and code left alone; idempotent) — UTST:
  `scripts/release/release-mentions.test.mjs` (5 cases)
- Wiring: step 900.5 of `.github/workflows/buildAndTest.yml` runs it on `release-notes.md`, from which the
  GitHub Release (904) and the release-site page (905) are made; 900.5a checks out `scripts/release`.
  Not covered by an automated test: the workflow step itself (it runs only on a release tag); its
  command was run locally on the v0.3.52 changelog section.
