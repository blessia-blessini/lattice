// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// email: blessia AT blessini.com
//
// GNU AFFERO GENERAL PUBLIC LICENSE V3 NOTICE:
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

use std::env;
use std::fs;

//******************************************************************************
// main
//******************************************************************************
fn main() {
    // 0. Sabotage files
    println!("cargo:rustc-check-cfg=cfg(integration_test)");
    println!("cargo:rustc-check-cfg=cfg(e2e_test)");

    // 1. Determine Build Number: Check Env Var OR Panic
    // Use a macro to create a "constant" that concat! can accept
    #[rustfmt::skip]
    macro_rules! BLD_NO { () => { "LATTICEBUILD_NO" }; }
    #[rustfmt::skip]
    macro_rules! FT_WRN { () => { "\x1b[33m" }; }
    #[rustfmt::skip]
    macro_rules! END { () => { "\x1b[0m" }; }

    println!("cargo:rerun-if-env-changed={}", BLD_NO!());
    let build_number = env::var(BLD_NO!()).unwrap_or_else(|_| {
        // Only panic in release mode, otherwise default to DEV for IDE/Debug friendliness
        if env::var("PROFILE").map(|s| s == "release").unwrap_or(false) {
            #[rustfmt::skip]
            const ERR_MSG: &str =
                concat!(
                "********************************************************************************\n",
                "❌ ERROR: Environment variable '",  BLD_NO!(), "' is missing.\n\n",
                " The build cannot proceed without a build number.\n",
                "  👉 TO FIX THIS (on Windows PowerShell       ):\n",
                "      ", FT_WRN!(), "$env:",  BLD_NO!(), "=\"my_bld_no\"", END!(),"\n",
                "  👉 TO FIX THIS (on Linux/macOS Bash/Git Bash):\n",
                "      ", FT_WRN!(), "export ", BLD_NO!(),  "=my_bld_no", END!(),"\n",
                " THEN run your command again.\n",
                "********************************************************************************\n"
            );
            panic!("{}", ERR_MSG);
        } else {
            println!("cargo:warning={} not set. Defaulting to '0.0.0-DEV' for debug.", BLD_NO!());
            "0.0.0-DEV".to_string()
        }
    });

    // 2. Write to OUT_DIR/build_number.txt
    let out_dir = env::var("OUT_DIR").unwrap();
    let dest_path = std::path::Path::new(&out_dir).join("build_number.txt");
    println!("cargo:rerun-if-changed={}", dest_path.display()); // Explicitly track the output file as requested
    if let Err(e) = fs::write(&dest_path, &build_number) {
        println!("cargo:warning=Failed to write build number to file: {}", e);
    }

    // 3. Copy platform-specific implementation to OUT_DIR/platform_impl.rs.
    //
    // This is the ONLY place in the repository that knows which OS maps to
    // which implementation file.  Source files carry zero #[cfg(target_os)]
    // attributes; the compiler only ever sees the one file copied here.
    //
    // To add a new platform:
    //   1. Create src/platform/impls/<os>.rs
    //   2. Add a match arm below.
    //   3. No other file needs to change.
    {
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
        let impls_dir = std::path::Path::new(&manifest_dir)
            .join("src")
            .join("platform")
            .join("impls");

        let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        let impl_src = match target_os.as_str() {
            "macos"   => impls_dir.join("macos.rs"),
            "windows" => impls_dir.join("windows.rs"),
            "linux"   => impls_dir.join("linux.rs"),
            "android" => impls_dir.join("android.rs"),
            "ios"     => impls_dir.join("ios.rs"),
            other => panic!(
                "Unsupported target OS '{}' — add src/platform/impls/{}.rs and \
                 a match arm in build.rs step 3.",
                other, other
            ),
        };

        // Re-run whenever any impl file changes.
        println!("cargo:rerun-if-changed={}", impls_dir.display());

        let impl_dest = std::path::Path::new(&out_dir).join("platform_impl.rs");
        fs::copy(&impl_src, &impl_dest).unwrap_or_else(|e| {
            panic!(
                "build.rs: failed to copy {} to {}: {}",
                impl_src.display(),
                impl_dest.display(),
                e
            );
        });
    }

    // 4. Copy platform-specific test file to OUT_DIR/platform_tests.rs.
    //
    // Same selection logic as step 3.  test/file_open_tests.rs includes this
    // file via include!() so platform-specific test code carries zero
    // #[cfg(target_os)] attributes — the compiler only ever sees the one file
    // copied here.
    //
    // To add tests for a new platform:
    //   1. Create tests/platform/<os>.rs
    //   2. Add a match arm below.
    //   3. No other file needs to change.
    {
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
        let tests_platform_dir = std::path::Path::new(&manifest_dir)
            .join("tests")
            .join("platform");

        let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        let tests_src = match target_os.as_str() {
            "macos"   => tests_platform_dir.join("test-macos.rs"),
            "windows" => tests_platform_dir.join("test-windows.rs"),
            "linux"   => tests_platform_dir.join("test-linux.rs"),
            "android" => tests_platform_dir.join("test-android.rs"),
            "ios"     => tests_platform_dir.join("test-ios.rs"),
            other => panic!(
                "Unsupported target OS '{}' — add tests/platform/{}.rs and \
                 a match arm in build.rs step 4.",
                other, other
            ),
        };

        println!("cargo:rerun-if-changed={}", tests_platform_dir.display());

        let tests_dest = std::path::Path::new(&out_dir).join("platform_tests.rs");
        fs::copy(&tests_src, &tests_dest).unwrap_or_else(|e| {
            panic!(
                "build.rs: failed to copy {} to {}: {}",
                tests_src.display(),
                tests_dest.display(),
                e
            );
        });
    }

    // 5. Emit cargo instructions
    println!("cargo:rustc-env=BUILD_NUMBER={}", build_number); // check time of showing

    // Hack: Write directly to console to bypass Cargo's output capturing
    // This allows the user to see the build version without "warning:" prefix and without -vv
    let console_device = if cfg!(windows) { "CON" } else { "/dev/tty" };

    if let Ok(mut file) = fs::OpenOptions::new().write(true).open(console_device) {
        use std::io::Write;
        writeln!(file).ok();
        writeln!(file, "  *******************************************").ok();
        writeln!(file, "    ******** buildNO: {}  ********", build_number).ok();
        writeln!(file, "  *******************************************").ok();
        //writeln!(file, "").ok();
    }

    // Embed the Common Controls v6 activation manifest into integration-test
    // binaries on Windows.  Without it, tauri::test::MockRuntime crashes with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) because TaskDialogIndirect in
    // comctl32.dll v6 is only available once an activation context is in place.
    // tauri-build does this for the app binary; we replicate it for the test
    // binaries produced from tests/ (proper [[test]] Cargo targets) via
    // cargo:rustc-link-arg-tests — stable since Cargo 1.64, and scoped to
    // test targets only so the app binary is not affected.
    //
    // Note: cargo:rustc-link-arg-tests does NOT apply to inline #[cfg(test)]
    // modules inside [lib] — only to explicit tests/ integration-test targets.
    // That is why the true MockRuntime wiring tests live in tests/wiring.rs.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
        let test_manifest = std::path::Path::new(&manifest_dir).join("test.manifest");
        println!("cargo:rerun-if-changed=test.manifest");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", test_manifest.display());
    }

    // E2E builds: activate E2E hooks and remove devUrl from the embedded config.
    //
    // Triggered by: cargo build --bin lattice --features e2e_test
    // No env var required from the caller.
    //
    // Two things happen here:
    // 1. cargo:rustc-cfg=e2e_test — makes #[cfg(e2e_test)] / is_e2e_tst_build() true
    //    in library code without needing --cfg e2e_test in RUSTFLAGS.
    // 2. TAURI_CONFIG patch — tauri_build's official JSON Merge Patch (RFC 7396)
    //    applied on top of tauri.conf.json before the config is embedded into the
    //    binary.  null removes devUrl so the runtime loads dist/ assets, not localhost.
    //    tauri_build already emits cargo:rerun-if-env-changed=TAURI_CONFIG internally.
    //
    // CARGO_FEATURE_E2E_TEST is set by Cargo when --features e2e_test is passed.
    if env::var("CARGO_FEATURE_E2E_TEST").is_ok() {
        println!("cargo:rustc-cfg=e2e_test");
        // SAFETY: build.rs is always single-threaded; no concurrent env access.
        #[allow(unused_unsafe)]
        unsafe { env::set_var("TAURI_CONFIG", r#"{"build":{"devUrl":null}}"#); }
        println!("cargo:warning=E2E feature active: cfg(e2e_test) set, \
                  devUrl removed from embedded Tauri config.");
    }

    tauri_build::build()
}
// main END ********************************************************************
