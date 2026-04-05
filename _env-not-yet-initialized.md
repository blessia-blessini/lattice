# Purpose of this file

**This file is present when you first clone the repository.
Normally, it should be deleted after the first run, build, or development session.
However, it will re-appear if you re-clone (or pull) the repository.
This is why it is `.gitignore(d)`
(Git for this very repo is configured to ignore this file's changes).**

## What does it mean?

If this file is present, the development environment is not initialized.
Successful initialization and build scripts should delete this file.

## What to do?

Check the `scripts` folder and run the appropriate scripts to initialize the development environment.

> ⚠️ SCRIPTS ARE DESIGNED TO WORK FROM PROJECT FOLDER ROOT (NOT after you `cd` into a subfolder).

   For this project:
   - on Windows,
     - ⚠️ ONLY AFTER YOU UNDERSTOOD THE SCRIPT(s) AND RISK,
       - execute in PowerShell: `.\scripts\setup_env.ps1`.
   - on Linux/macOS/POSIX,
     - ⚠️ ONLY AFTER YOU UNDERSTOOD THE SCRIPT(s) AND RISK,
       - execute in shell: `.\scripts\setup_env.sh`.

## SECURITY NOTE

THE SCRIPTS ARE EASY TO UNDERSTAND, SHORT AND SIMPLE. 
THEREFORE, WE RECOMMEND THAT YOU LOOK INTO THEM BEFORE YOU RUN THEM.

At the time of release: the scripts are checked to be not harmful.

**YOU ARE RUNNING SCRIPS ON YOUR OWN RISK**: DO NOT EXECUTE SCRIPTS THAT ARE **__NOT YOURS OR THAT YOU HAVE NOT REVIEWED
AND UNDERSTOOD__**.

---
