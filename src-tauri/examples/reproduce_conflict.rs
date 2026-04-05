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

//**************************************************************
// reproduce_conflict
//**************************************************************
use std::env;
use std::fs;
use std::io;
use std::process::Command;
//use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

/// Name of the test file to be created in the current directory
const TEST_FILENAME: &str = "conflict_test.md";

fn main() {
    println!("**************************************************************");
    println!("* Conflict Reproduction Tool                                 *");
    println!("**************************************************************");

    // 1. Setup paths
    let current_dir = env::current_dir().expect("Failed to get current directory");
    let file_path = current_dir.join(TEST_FILENAME);

    // We modify this to use npm run tauri dev
    // This assumes the user has npm in their PATH (and is on Windows per instructions)

    println!("[INFO] Target File: {}", file_path.display());
    println!("[INFO] Lattice App will be launched via 'npm run tauri dev'");

    // 2. Create initial file
    println!("[INFO] Created/Reset {}", file_path.display());
    fs::write(&file_path, "# Conflict Test File\n\nInitial content.")
        .expect("Failed to create test file");

    // NOTE FOR MOBILE:
    // This script ('reproduce_conflict.rs') is a DESKTOP HOST launcher.
    // It runs on Windows/Linux/macOS CI servers.
    //
    // TO RUN ON MOBILE:
    // 1. Build the APK using `RUSTFLAGS="--cfg integration_test" npm run tauri android build`.
    // 2. Use a separate script (e.g. bash + adb) to:
    //    - Install APK.
    //    - Launch Activity.
    //    - Monitor `adb logcat` for "TEST RESULT: SUCCESS".

    // 4. Launch Main Application
    println!("[INFO] Launching Lattice via npm...");

    #[cfg(target_os = "windows")]
    const NPM: &str = "npm.cmd";
    #[cfg(not(target_os = "windows"))]
    const NPM: &str = "npm";

    // Check OS to decide calling convention
    let (prog, args) = (
        NPM,
        // We pass the configuration via RUSTFLAGS.
        // This is robust against wrapper/npm argument parsing issues.
        vec!["run", "tauri", "dev", "--", file_path.to_str().unwrap()],
    );

    let mut _app_child = Command::new(prog)
        .args(&args)
        .env("RUSTFLAGS", "--cfg integration_test") // COMPILE-TIME ACTIVATION
        .spawn()
        .expect("Failed to launch npm run tauri dev");

    // 5. Wait for success marker or timeout (AUTOMATED)
    println!("\n[ACTION] Waiting up to 60s for automated test success (Feature Flag Mode)...");

    let success_path = current_dir.join("conflict_success.txt");
    let success_path_alt = current_dir.join("src-tauri").join("conflict_success.txt");
    let start_time = std::time::Instant::now();
    let timeout = Duration::from_secs(300); // Allow 5 mins for full rebuild
    let mut success = false;
    let mut found_path = std::path::PathBuf::new();

    while start_time.elapsed() < timeout {
        if success_path.exists() {
            found_path = success_path.clone();
            success = true;
        } else if success_path_alt.exists() {
            found_path = success_path_alt.clone();
            success = true;
        }

        if success {
            println!(
                "\n[SUCCESS] 'conflict_success.txt' detected at {}",
                found_path.display()
            );
            let content = fs::read_to_string(&found_path).unwrap_or_default();
            println!("[SUCCESS] Content: {}", content);
            // Delete file using correct path
            let _ = fs::remove_file(&found_path);
            break;
        }
        thread::sleep(Duration::from_secs(1));

        // Optional: print progress
        use std::io::Write;
        print!(".");
        io::stdout().flush().unwrap();
    }

    if start_time.elapsed() >= timeout {
        println!("\n[TEST RESULT] FAILED (Timeout)");
        std::process::exit(1);
    }

    // 6. Cleanup
    println!("[INFO] Killing App Process...");

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(&["/F", "/T", "/PID", &_app_child.id().to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = _app_child.kill();
        // Unix might need pkill -P if we want to kill children,
        // but typically SIGTERM propagates or we rely on the shell.
        // For now simple kill is standard, user is on Windows.
    }

    if success {
        println!("\n[TEST RESULT] PASSED");
        std::process::exit(0);
    } else {
        println!("\n[TEST RESULT] FAILED (Timeout)");
        std::process::exit(1);
    }
}

// modify_file END *********************************************
