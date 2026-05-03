// build.rs — embed the Windows manifest at link time (MSVC linker only).
// No extra crates, no mt.exe — link.exe (already used by cargo) handles it.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "windows" {
        let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        // Embed our manifest directly into the PE binary
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{dir}\\changelog-update.manifest");
        // Re-run this build script if the manifest file changes
        println!("cargo:rerun-if-changed=changelog-update.manifest");
    }
}
