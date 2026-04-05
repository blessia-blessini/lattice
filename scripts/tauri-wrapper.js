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
////////////////////////////////////////////////////////////////////////////////

/// Tauri Wrapper Script (tauri-wrapper.js)
/// 
/// This script performs pre-checks and setups before invoking the Tauri CLI.
/// It ensures environment initialization and generates build numbers.
/// Finally, it spawns the Tauri CLI with the appropriate arguments.
///
/// DESIGN CHOICE (WHY THIS COMPLEXITY!? and WHY is this script needed!?)
/// We generate a build number and inject it via environment variables (LATTICEBUILD_NO)
/// because Tauri does not natively support advanced dynamic versioning via CLI args.
///
/// This script is designed to be run via npm scripts (e.g., "npm run tauri build")
/// and acts as a transparent wrapper around the standard Tauri options.


import { execSync, spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import process from 'process';

const FMT_WARN = "\x1b[33m%s\x1b[0m";
const FMT_ERROR = "\x1b[33m%s\x1b[0m";

/**
 * Synchronizes the version from package.json to tauri.conf.json, making
 * package.json the single source of truth.
 */
function syncVersion() {
    try {
        console.log("  [INFO] Synchronizing versions from package.json to tauri.conf.json...");
        const packageJsonPath = path.resolve(process.cwd(), 'package.json');
        const tauriConfPath = path.resolve(process.cwd(), 'src-tauri/tauri.conf.json');

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));

        const sourceVersion = packageJson.version;

        if (tauriConf.version !== sourceVersion) {
            console.log(`  [SYNC] Version mismatch detected. Updating tauri.conf.json: ${tauriConf.version} -> ${sourceVersion}`);
            tauriConf.version = sourceVersion;
            fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
        } else {
            console.log("  [SYNC] Versions are already in sync.");
        }
    } catch (e) {
        console.error(FMT_ERROR, "  ###########################################################");
        console.error(FMT_ERROR, "  #  FATAL: Version synchronization failed               #");
        console.error(FMT_ERROR, "  ###########################################################");
        console.error(FMT_ERROR, `  Error: ${e.message}`);
        process.exit(1);
    }
}

// Main script execution starts here
console.log("  [INFO] Running Tauri Wrapper ...");

// 1. Synchronize versions
syncVersion();


// 2. SAFETY GUARD: Ensure this is run via npm
// This prevents accidental manual execution and reinforces that this is a build tool,
// not a runtime script for the application.
if (!process.env.npm_execpath) {
    console.error("\n");
    console.error(FMT_ERROR, "  ###########################################################");
    console.error(FMT_ERROR, "  #  FATAL: Incorrect Execution Context                     #");
    console.error(FMT_ERROR, "  ###########################################################");
    console.error("  Error: This script is a build tool and must be run via `npm run tauri`.");
    console.error("  It cannot be run directly or by the application itself.");
    console.error("\n");
    process.exit(1);
}

const envInitFile = path.resolve(process.cwd(), '_env-not-yet-initialized.md');
console.log(`  [INFO] Checking if environment init scripts are run by checking if ${envInitFile} exists ...`);

if (fs.existsSync(envInitFile)) {
    console.error(FMT_WARN, "  #################################################################");
    console.error(FMT_WARN, "  #  Environment Not Initialized                                  #");
    console.error(FMT_WARN, '  #  Found: ' + envInitFile);
    console.error(FMT_WARN, "  #  Please initialize the environment before building.           #");
    console.error(FMT_WARN, "  #  Run: scripts/setup_env.ps1 (Windows) or scripts/setup_env.sh #");
    console.error(FMT_WARN, "  #  The setup script will remove the marker file on success.     #");
    console.error(FMT_WARN, "  #################################################################");
    console.error(FMT_WARN, `  Details regarding marker file: ${envInitFile}`);
    console.error(FMT_WARN, "  If you intend to initialize the environment manually yourself, ");
    console.error(FMT_WARN, "    please delete the file after reading it.");
    console.error(FMT_WARN, "  Note: Deleting the marker file is not automatically ");
    console.error(FMT_WARN, "        reflected in the repository by design (even after \`git commit\` etc.)");
    process.exit(2);
}

// Run Tauri CLI with the arguments passed to this script
// Get arguments passed to this script (e.g. "build", "dev")
const args = process.argv.slice(2);

// Generate Build Number (only for dev or build)
let verNo = "0.0.0";
if (args.includes('dev') || args.includes('build')) {
    if (process.env.LATTICEBUILD_NO) {
        console.log("  [INFO] Using LATTICEBUILD_NO from environment: " + process.env.LATTICEBUILD_NO);
        verNo = process.env.LATTICEBUILD_NO;
    } else {
        console.log("  [INFO] Calculating build number");
        const buildGenPath = os.platform() === 'win32' ? '.\\buildno-gen.exe' : './buildno-gen';
        try {
            verNo = execSync(buildGenPath).toString().trim();
        } catch (e) {
            console.error(FMT_ERROR, "  ###########################################################");
            console.error(FMT_ERROR, "  #  FATAL: Build number generator failed                  #");
            console.error(FMT_ERROR, "  ###########################################################");
            console.error(FMT_ERROR, `  Executable: ${buildGenPath}`);
            console.error(FMT_ERROR, "  Suggestion: Ensure the setup_env script has completed successfully and that the generator is present and executable.");
            console.error(FMT_ERROR, `  Error: ${e.message.split('\n')[0]}`);
            process.exit(1);
        }
    }
    console.log("  *********************************************");
    console.log(`  [INFO] Setting LATTICEBUILD_NO=${verNo}`);
    console.log("  *********************************************");
}

// args are now defined above

// Spawn 'tauri' command
const tauriCmd = os.platform() === 'win32' ? 'tauri.cmd' : 'tauri';

// We must find where 'tauri' executable is. usually in node_modules/.bin
// Using 'npx tauri' or just 'tauri' if it's in path from npm script context?
// WHEN run via `npm run tauri`, the node_modules/.bin is in PATH.
// SO simple spawn should work (testing and CI proves it does).

const commandString = [tauriCmd, ...args].join(' ');

const child = spawn(commandString, {
    stdio: 'inherit',
    env: { ...process.env, LATTICEBUILD_NO: verNo },
    shell: true
});

child.on('close', (code) => {
    process.exit(code);
});
