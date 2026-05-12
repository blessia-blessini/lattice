# Changelog

All notable changes to Lattice are documented here.
Edit the section for your next version **before** pushing the release tag like vX.Y.Z.
---


---
## v0.2.32
### Changes
  <!-- INSERT BULLETS UNDER THIS LINE -->
- Bump version to 0.2.32
- npm update and cargo update
- Add read permissions for AntivirusOnUrl workflow
- Update GitHub token in build workflow
- Update GH_TOKEN in buildAndTest workflow
- Trigger antivirus scan for download links
- Add AntivirusOnUrl workflow to GitHub Actions
- Fix: Release script fixed
- CHANGELOG.md merged
- Update CHANGELOG for v0.2.31 prep for x.32

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
