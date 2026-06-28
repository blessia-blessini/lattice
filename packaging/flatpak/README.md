# Flatpak / Flathub packaging for Lattice

Starter kit for publishing Lattice on **Flathub** — the recommended "easy to
install + trustable" channel on Linux. No certificate or fee is required;
trust comes from Flathub's review and its GPG-signed repository.

Files here:

| File | Purpose |
|---|---|
| `com.lattice_md.Lattice.yml` | Flatpak build manifest (starting point — needs vendored sources) |
| `com.lattice_md.Lattice.desktop` | Desktop launcher entry |
| `com.lattice_md.Lattice.metainfo.xml` | AppStream metadata (required by Flathub) |

**App ID:** `com.lattice_md.Lattice`. The Tauri identifier
(`com.blessia-blessini.lattice-app`) can't be reused because Flatpak app IDs
forbid hyphens; we use your domain `lattice-md.com` with `-` → `_`.

## Why this isn't build-ready yet

Flathub builds run **offline**. Lattice's build pulls npm + cargo dependencies
from the network, so those must be vendored into generated source files first.
This is the one real chunk of work for Tauri-on-Flathub.

### 1. Vendor the Rust crates

```bash
# From a Flathub tools checkout (github.com/flatpak/flatpak-builder-tools):
python3 cargo/flatpak-cargo-generator.py \
  ../lattice/src-tauri/Cargo.lock -o cargo-sources.json
```

### 2. Vendor the npm packages

```bash
# Requires flatpak-node-generator (same flatpak-builder-tools repo):
flatpak-node-generator npm ../lattice/package-lock.json -o node-sources.json
```

Place `cargo-sources.json` and `node-sources.json` next to the manifest
(the manifest already references them).

### 3. Build & test locally

```bash
flatpak install flathub org.gnome.Platform//47 org.gnome.Sdk//47 \
  org.freedesktop.Sdk.Extension.rust-stable org.freedesktop.Sdk.Extension.node22
flatpak-builder --user --install --force-clean build-dir com.lattice_md.Lattice.yml
flatpak run com.lattice_md.Lattice
```

Validate metadata before submitting:

```bash
flatpak run org.freedesktop.appstream-glib validate com.lattice_md.Lattice.metainfo.xml
desktop-file-validate com.lattice_md.Lattice.desktop
```

## Submitting to Flathub

1. Fork `github.com/flathub/flathub`, create a branch `com.lattice_md.Lattice`.
2. Add the manifest + generated sources, open a PR against the `new-pr` branch.
3. A reviewer checks the manifest, permissions (`finish-args`), and metadata.
4. On merge, Flathub creates a dedicated repo and builds/publishes automatically.

## Items to confirm

- [ ] Current GNOME runtime version at submission (manifest pins `47`).
- [ ] Node SDK extension version vs. `engines.node` (`>=24`) — use `node24` when available.
- [ ] Whether runtime **network** access is needed (`finish-args`) — remove if not.
- [ ] Minimal file access: prefer the file-chooser **portal** over `--filesystem=home`.
- [ ] Real summary, feature bullets, screenshot URL, and release dates in the metainfo.
- [ ] Exact commit SHA for the `v0.3.5` tag in the manifest.

## Alternative / complementary Linux channels

- **GPG-signed `SHA256SUMS`** — already wired into CI (`buildAndTest.yml` step
  903.6, gated on `GPG_SIGNING_ENABLED`). Publish the public key on the site.
- **AppImage** — already built; can additionally be GPG-signed at build time.
- **Snap Store** — free, auto-signed by Canonical, good Ubuntu reach.
- **GitHub build attestation** — already produced; works on Linux artifacts too:
  `gh attestation verify lattice.AppImage --repo blessia-blessini/lattice`.
