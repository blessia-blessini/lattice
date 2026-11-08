# Trace Coverage — scripts/apt/ (APT repository on the release site)

Satellite file: records which implementation anchors cover which requirements and architecture sections.
Format: `IMPL-ID` **covers** `REQ-ID` / `ARCH-ID`

---

- IMPL-LTTCE-APT-00001 **covers** REQ-LTTCE-APT-00001  (`apt-repo.sh`: pool, `Packages` per architecture,
  signed `Release` / `InRelease`, the `lattice-md-keyring` package versioned by the newest signature of its
  keys, signing by both keys during a replacement, built in a hidden folder inside the target and moved in only
  when verified; `install-with-apt.md`, put on the release
  page by `buildAndTest.yml` step 905; `src-tauri/tauri.conf.json` `bundle.linux.deb.provides`
  `lattice-md`; `buildAndTest.yml` step 903.7, gated on `GPG_SIGNING_ENABLED`)
- IMPL-LTTCE-APT-00001 **covers** ARCH-LTTCE-APT-00001
- STST of REQ-LTTCE-APT-00001: `apt-repo-test.sh`, run by `buildAndTest.yml` step 393 on both Linux legs —
  real `apt-get update` accepts the index; `lattice` and `lattice-md-keyring` download with matching
  hashes; `lattice-md` is provided by `lattice`; the keyring package is byte-identical when rebuilt; a
  tampered index (by its signature) and a tampered package are refused; a failed signing leaves the repository
  unchanged; signing with a passphrase works; a renewed key and a replaced key raise the version, a client with
  only the old key accepts the replacement, and a changed package without a higher version is refused.
- Not covered by an automatic test: the published repository at `https://lattice-md.app/apt` with the real
  key — first checked on the first stable release after `GPG_SIGNING_ENABLED` is set.
