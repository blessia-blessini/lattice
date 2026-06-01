# Changelog

All notable changes to Lattice are documented here.
Edit the section for your next version **before** pushing the release tag like vX.Y.Z.
---



## v0.2.39
### Changes
  <!-- INSERT BULLETS UNDER THIS LINE -->
- Copy app logo to release folder
- Update platform icons in CI workflow
- Route release-site updates to alpha or main Route release-site updates to alpha or main
- Bump lattice version to 0.2.39
- Set Mermaid securityLevel to strict
- Hard-coded Mermaid default theme,which an be overwritten inside the code
- Add Mermaid theme blocks to architecture docs
- open v0.2.39 changelog entries; finalized v0.2.38

---

## v0.2.38
### Changes

 - enhance scroll-sync on UI:
   - Add scroll-sync pause mechanism and docs
   - Prevent macOS elastic bounce from affecting scroll
 - improved release table (add platform column for user's clarity)
 - Update PRIVACY.md with release attestation

---
- merge wip: enhance scroll-sync on UI, release table improved
- Skip E2E conflict repro and extend timeout
- Add platform column and derive platform labels
- Capture Rust test results for GitHub Actions
- Add tests for scroll-sync fixes triggered by macOS platform
- Bump version to 0.2.38 across the repo
- Run cargo llvm-cov clean in src-tauri
- Add scroll-sync pause mechanism and docs
- Prevent macOS elastic bounce from affecting scroll
- Update PRIVACY.md with release attestation
- Finalize ChangeLog for v0.2.37 and opening v0.2.38 placeholder


---


## v0.2.37
### Changes
  
 - Bump to 0.2.37 and add platform implementations and tests
   "platform" is: Windows, macOS, Linux, iOS and Android
 - Add Privacy statement
 - file registration on macOS and Linux improvemen
 - made visible file path use `~` on Posix and `%USERPROFILE$` on Eindows  
 - bug fixes

---
  
- squash in the prep v0.2.37 branch
- Add privacy statement for Lattice
- show ~/home directory in caption
- Short Path visibility
- Update build-test.ps1
- Refactor file test helpers into shared module
- Refactor platform-specific tests into separate files
- Hide horizontal scrollbars in preview pane + test sample doc
- Hide horizontal scrollbars in preview pane
- Add file opening tests and fix mimeType config
- Add MIME types to Markdown file association
- Refactor CLI desktop to use shared per-path opener
- Update dependencies in Cargo.lock
- Add Info.plist for macOS file associations
- Update project dependencies
- macOS build split into ARM64 and x64, file assicition at install time
- Fix upload paths syntax in workflowgit Enable macOS DMG packaging
- Swap DMG upload paths in workflow
- Refactor macOS release packaging
- Add desktop window cascade positioning and tests
- Clean Rust coverage data before running tests
- Chore: Update project dependencies
- Clean up build scripts and source code
- Bump version to 0.2.37
- Refactor platform CLI handling to shared helpers
- Refactor platform selection to build.rs
- Refactor platform integration modules
- Implement platform-specific file association to fix open on macOS
- Update CHANGELOG for v0.2.37

---

## v0.2.36
### Changes
  
- fix: Privacy (external images are now not fetched by default)
- fix: commandline file(s) were not open
- Dependencies update (cargo and npm update)
- Documentaion improved
- Attestation 

---
- merged remote 0.2.36 | Block external image fetches by default
- fix: prevent double-initialization in React StrictMode and update build scripts to support argument forwarding
- chore: remove obsolete test samples and add gitignore for the test samples directory
- refactor: update build scripts to use fork pool for coverage testing and enforce explicit exit codes on failure
- fix: propagate frontend test failures in build scripts and replace JSDOM storage mocks to support Node.js 25+
- Block external image fetches by default
- Rename docs/README.md to docs/00-Docs-ReadMe.md
- Improve README documentation
- Refactor and expand project documentation
- dependencies: npm and cargo update
- Update CHANGELOG for v0.2.35 release
- Bump tauri dependencies to v2.11.2
- Fix: Add blank line before Test-Conflict source
- Fix: Ensure popd is called correctly
- WorkAround: E2E Conflict Reproducer test
- Add irrelevant file to .gitignore
- Fix E2E conflict reproducer script
- Add conflict reproduction test documentation
- Refactor build scripts and setup environment
- Bump version to 0.2.35
- docs: update architecture documentation and vault settings configuration file
- Re-enabled Android test execution
- Update attest-build-provenance to v4
- Add build provenance attestation
- Fix: Remove trailing newline from notes header
- Finalized v0.2.33, prep v.0.2.35

---
## v0.2.35
### Changes
- Improved documentation of tests
- Tauri dependencies updated
- Robustness of Collision-Detection tests
- Fix: Remove trailing newline from notes header

---
## v0.2.33
### Changes
- Bump dependencies to latest versions (back- and front- end)
- Fix broken links and release notes formatting
- Fix build workflow DOCS artifact link on the only build 
  that builds it automatically (the linux-desktop build)
- Fix AntivirusOnUrl workflow dispatch URL

---
## v0.2.32
### Changes
- npm update and cargo update
- Add read permissions for AntivirusOnUrl workflow
- Update GitHub token in build workflow
- WIP: Initial Trigger antivirus scan for download links
- WIP: Add AntivirusOnUrl workflow to GitHub Actions
- Fix: Release script fixed

---
## v0.2.31
### Changes
- Add comprehensive testing strategy document
- Increased auto test quality and coverage
- Refactor file state tests with helpers
- Refactor tests into separate/dedicated modules
- Fix: Add tests for file state, table formatting, and TOC

---
## v0.2.30
### Changes
- Bump **tauri** from 2.11.0 to 2.11.1 in /src-tauri in the cargo group across 1 directory
- feat: Add highlight mark setting and operation for ==highlighted test==
- Add tests for file state and settings module
- Fixed warnings in the unittest run
- Fixed vulnerability GHSA-w5hq-g745-h8pq
- Add App coverage tests

---
## v0.2.29
### Changes
  - Add App coverage tests
  - Updated ChangeLog; Bump version to 0.2.29
---
## v0.2.28
### Changes
  - Add Dignose trace to Fix awk command for CHANGELOG extraction
  - Refactor CHANGELOG extraction to use sparse-checkout
---
## v0.2.27
### Changes
  - Add frontend/backend coverage link to workflow
---
## v0.2.26
### Changes
  - Test Release
---
## v0.2.25
### Changes
  - Add backend code coverage reporting and publishing
  - resolved CI Build warnings for OLD node engine
  - updated npm dependencies
  - corrected typos in error messages 
---
## v0.2.24
### Changes
  - Refactor changelog update to use Rust binary
  - Update post-commit
---
## v0.2.23
### Changes
  - updated with clear links on release site
  
---
## v0.2.22
### Changes
  - Made tests run faster by avoiding repetative runs
  - Published changes Release `index.md`
  - Various Minor Fixes
---
## v0.2.21
### Changed
  - The zoom-in/out with mouse `CTRL + Mouse-Scroll` (macOS: `⌘ + Mouse-Scroll`) works now.
  - Update dependencies and version numbers, thus fixed #15
  - Automated Changelog and Release Notes
### Fixed
  - Issue #15:[Revisit Dependabot Alert #16: glib VariantStrIter unsoundness (May 2026)](https://github.com/blessia-blessini/lattice/issues/15)
---
## v0.2.20
---
## vSEED
---
<!-- older versions below -->


## vCurrent
### Changed  <!-- Automatically added comment messages comments -->

- v0.2.31
- Remove unnecessary header from release notes
- Remove outdated action plan from docs
- Add vault settings file tests
- Add comprehensive testing strategy document
- Increased auto test quality and coverage
- Update test_fs_helpers to use icacls on Windows
- Refactor file state tests with helpers
- Refactor tests into separate/dedicated modules
- Fix: Add tests for file state, table formatting, and TOC
- Bump version to 0.2.31
- Bump dependencies in /src-tauri
- ammended Changelog
- v0.2.30
- Refactor CHANGELOG extraction to use sparse-checkout
- Bump version to 0.2.28
- feat: Improve release notes generation
- Add Dignose trace to Fix awk command for CHANGELOG extraction
- Fix CHANGELOG for version to v0.2.27
- Add frontend/backend coverage link to workflow
- Add debugging logs for coverage directory
- Fix: Mock mermaid.render with diagramType
- Add backend code coverage reporting and publishing
- Update dependencies, fix CI bld warning and message fix typos.
- Fix: Update catch logic
- Adjust waiting logic in env setup
- Refactor changelog update logic
- docs: update v0.2.24 changelog and correct typo in v0.2.23 entry
- Refactor changelog update to use Rust binary
- Update post-commit
- Update changelog for v0.2.22
- Bump version to 0.2.22
- Add release notes to index.md
- Tests are executed ONLY with coverage.
- Fix typo in build scripts
- Refactor changelog parsing and test execution
- Bump version to 0.2.21
- Move changelog update to post-commit hook Refactor changelog update to post-commit hook
