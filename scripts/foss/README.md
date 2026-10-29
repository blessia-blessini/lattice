# FOSS compliance tooling — what it does, in plain words

Lattice is built from several hundred open-source packages written by other people (Rust crates
and npm packages). Their licences let us ship them, on conditions. The scripts in this folder
check those conditions automatically, so nobody has to remember them.

They answer four questions:

1. **May we use this licence?** Every package Lattice ships must have a licence that fits *both*
   of Lattice's own licences (the AGPL and the commercial one). → the **licence check**
2. **Do we give credit?** Most licences ask that every copy of Lattice carries the package's
   copyright line and licence text. Those live in `THIRD-PARTY-NOTICES.md`, generated from the
   lock files. → the **notices check** (is the generated file still current?)
3. **Does a package we ship have a known security hole?** → the **vulnerability audit**
4. **Do the installers really contain the notices?** → checked on the finished installers

The rules themselves (which licences are allowed, accepted exceptions) are data, not code. They
live in the folder `foss/` at the repository root; this folder holds only the code that applies
them.


## The commands

Run them from the repository root.

| Command | What it does |
| :--- | :--- |
| `npm run foss:check` | Licence check. Fails if a shipped package has no licence, a forbidden one, or one the policy does not know yet. |
| `npm run foss:notices` | **Writes** `THIRD-PARTY-NOTICES.md` (and the short notices that go into exported HTML files). Run it after every dependency change and commit the result. |
| `node scripts/foss/foss.mjs notices --check` | Only *compares*: fails if the committed notices no longer match the lock files. |
| `npm run foss:audit` | Vulnerability audit. Only reports, never fails. Needs the network and the `cargo-audit` program. |

They need the sources of all packages on disk first: `npm ci --ignore-scripts` and
`cargo fetch --locked --manifest-path src-tauri/Cargo.toml`.


## When does it run, and what does a failure stop?

| Where | Licence check + notices check | Vulnerability audit |
| :--- | :--- | :--- |
| On your machine, full `build-test` | runs; a failure fails the build-test | does not run |
| Pull request into `dev` | runs; a failure turns the check red | reports only |
| Push to `dev` | runs **right after** the push; a failure turns the commit's check red. It cannot undo the push — fix it in the next commit | reports only |
| A build (manual, `*build*` branch) | runs | reports only |
| A release (`v*` tag) | runs; a failure **stops the release** | **stops the release** if a shipped package has a known vulnerability (unless excepted, see below) |

**Releases and the deep scan.** Only a tag of exactly the form `vX.Y.Z` publishes. A tag with a suffix
(`v0.3.52-rc1`) is a dress rehearsal: it builds and checks everything a release does, and publishes
nothing. On both, the build first runs the deep scan of all package sources (Legattice) and **stops while
any finding is undecided** — low, medium or high:

1. The run's summary lists the open topics; the scan's results artifact holds a draft for each.
2. Decide them in the Legattice ledger (`products/lattice/ledger/`), commit and push there.
3. On the stopped run here: **Re-run failed jobs**. The scan reads your decisions and the build goes on.

The installers of a release or candidate always carry the notices made from that scan, never the
committed ones. After a release whose notices differ from the committed ones, the build opens a pull
request into `dev` ("Bring the notices released in vX.Y.Z back to dev") with the files as released —
merge it, nothing else to do.

"Reports only" means: you see the findings in the job summary and as yellow warnings, but the
check stays green.

On GitHub all of this is the job **FOSS Compliance** (`.github/workflows/foss-compliance.yml`).


## Reading the job summary on GitHub

A run's summary page shows, in this order:

- **Licence gate failed** — only if the licence check failed: which package, which licence.
- **Third-party notices are out of date** — only if the notices check failed, with the exact
  commands that fix it.
- **Vitest Test Report** — the tests of *these scripts* (see below). They say whether the tool
  itself works, not whether Lattice's packages are fine.
- **Vulnerability audit** — always, as a table. Status:
  - `blocking` — a package we ship has a known vulnerability. Blocks a release.
  - `excepted` — the same, but someone recorded why it is acceptable, until a date.
  - `development` — only in development tools (tests, build helpers that never ship). Never blocks.
  - `informational` — a warning that is not a vulnerability (a package no longer maintained, a
    withdrawn version). Never blocks.

If the first two headings are absent, the licence and notices checks passed.


## The tests of these scripts — and the made-up packages

Every `*.test.mjs` file here tests the *tool*, using a small **made-up repository** created in a
temporary folder: a crate called `democrate`, an npm package called `leftpad`, and so on. Some
tests give `democrate` a forbidden licence on purpose, to prove the licence check really fails.

So if you ever see `democrate` or `leftpad` in a report, it is test data leaking out — not a real
problem with Lattice's packages. (That once happened: the tests wrote into GitHub's real job
summary. `foss.test.mjs` now clears that for every test.)

The checks on Lattice's *real* packages are separate steps of the same job (140, 141, 145). They
read the real lock files and are not affected by anything the tests do.


## What to do when…

**…the notices are out of date.** Someone changed a dependency (often Dependabot). Run, on that
branch:

```sh
npm ci --ignore-scripts
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
npm run foss:notices
```

and commit `THIRD-PARTY-NOTICES.md` and `src/lib/export-notices.generated.txt` together with the
lock file change.

**…the licence check fails.** Look at the package and its licence. Then either drop the package,
or record the outcome in `foss/policy.json`: a *clarification* (the package's metadata is wrong;
name the file that proves the real licence) or an *exception* (with a reason and an expiry date).
A forbidden licence (GPL, AGPL from a third party) cannot be excepted.

**…a release is blocked by the vulnerability audit.** Update the package to a fixed version if
there is one. If Lattice is not affected (for example the vulnerable function is never used), add
an entry to `foss/advisory-exceptions.json`: the package, the advisory id (an npm package needs its
`GHSA-…` id), *why* it is acceptable, and an expiry date. After that date the release blocks again,
so somebody has to look at it once more.

**…an "unused exception" warning appears.** The package was fixed or removed; delete the entry.

**…an "unused notice addition" warning appears.** A package was updated, so the decision about what
is inside its old version no longer applies, and its notices are missing until it is renewed. A release
(`v*` tag) fails on it. Run the Legattice scan on this tree, decide what it
reopens, and copy its `topics/notice-additions.json` (results artifact) over
`foss/notice-additions.json`; then `npm run foss:notices` and commit both.

**…"differs from the file the decision was made on".** The installed file is not the one the
decision was made about. Do not edit the SHA-1 by hand: run the Legattice scan again and copy its
`notice-additions.json`.


## Where things are

| Path | What |
| :--- | :--- |
| `foss/policy.json` | Which licences are allowed, denied, or need review; clarifications and exceptions |
| `foss/advisory-exceptions.json` | Accepted vulnerability advisories, each with a reason and an expiry date |
| `foss/extra-components.json` | Shipped parts no lock file lists (e.g. the Rust standard library) |
| `foss/appimage-packages.json` | The reviewed Ubuntu libraries inside the Linux AppImage |
| `foss/export-embedded.json` | Which packages an HTML export copies into the user's file |
| `foss/notice-additions.json` | Licences found *inside* packages by the Legattice scan and decided in its ledger; generated there, copied here (see below) |
| `foss/licenses/` | The standard licence texts |
| `scripts/foss/foss.mjs` | The command line; every check starts here |
| `scripts/foss/*.mjs` | The parts: reading the lock files, the licence rules, the notices, the audit, the AppImage check |
| `scripts/foss/assert-bundled.sh` | Unpacks each finished installer and checks the notices are inside |
| `scripts/foss/foss.trace-cov.md` | Which requirement each part covers, and which test proves it |

The full design — why it works this way and what was considered instead — is in
`docs/30-architecture.md`, section *Feature: Third-Party Licence Compliance*. The binding
requirements are REQ-LTTCE-FOS-00001 to 00007 in `docs/10-System-Requirements.md`.

These scripts use only what Node itself provides — no npm packages of their own — because a tool
that checks the dependencies should not add any.
