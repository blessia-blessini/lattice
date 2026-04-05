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

    // 3. Emit cargo instructions
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

    tauri_build::build()
}
// main END ********************************************************************
