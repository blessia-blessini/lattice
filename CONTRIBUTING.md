# Contributing to Lattice

Thank you for your interest in Lattice. Contributions are welcome — bug reports, ideas, fixes,
documentation and translations.

## Before you start

**Open an issue first** and describe what you want to change and why. This avoids work on something
that conflicts with plans already under way. Small fixes such as typos can go straight to a pull
request.

## Licence agreement

Lattice is offered under the AGPL-3.0-or-later and, alternatively, under a commercial licence (see
[README.md § LICENSING](README.md#licensing)). To keep offering both, every contribution needs the
[Lattice Individual Contributor Licence Agreement (CLA)](CLA.md). In short: **you keep the copyright
in your contribution** and grant the maintainer a licence to distribute it under both licences; in
return, every version of Lattice that contains it stays available under an open-source licence.

**To agree**, post this sentence as a comment on your first pull request:

> I have read the Lattice CLA, version 1.0, and I agree to it for this and all my future
> contributions to Lattice.

A pull request is merged only once its author has agreed. If you contribute as part of your job,
make sure your employer allows it, or ask at `blessia AT blessini.com` about a corporate agreement.
Automated dependency updates (Dependabot) do not need the agreement.

## Making a change

1. Fork the repository and create a branch from `dev`.
2. Set up the environment and build as described in [README.md](README.md) (`scripts/setup_env`,
   `scripts/build-dev`).
3. Write tests together with the code they cover. Behaviour changes need automated tests; a list of
   manual steps is not enough.
4. Run the full suite before opening the pull request:
   `./scripts/build-test.sh` (macOS / Linux) or `.\scripts\build-test.ps1` (Windows).
5. Follow the style of the code around your change. Rust must pass Clippy without warnings (part of
   the suite); TypeScript must pass `npx tsc --noEmit`.
6. Do not add new dependencies without discussing them in the issue first.

## Commit messages

Use a short imperative title with a type prefix, then a short body:

```
FIX: Keep the cursor position when the file reloads

- what changed and why
- how it was tested
```

Types in use: `FEAT`, `FIX`, `DOCS`, `TEST`, `REFACTOR`, `CHORE`, `SEC`. The title is copied into
`CHANGELOG.md` automatically.

## Third-party code

If your contribution adds or copies code written by someone else, name its source, licence and
copyright notice in the pull request. New dependencies must pass the licence check
(`npm run foss:check`), and `THIRD-PARTY-NOTICES.md` must be regenerated with `npm run foss:notices`.
