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

/**
 * Replaces the home-directory prefix of a file path with a short token:
 *   - Windows : %USERPROFILE%   (case-insensitive, handles both \ and /)
 *   - All other OSes : ~
 *
 * @param path     The full file path to shorten (or null/empty → returned as-is).
 * @param homeDir  The home directory returned by Tauri's homeDir().
 * @returns        The display-friendly path string.
 */
export function shortenHomePath(path: string, homeDir: string): string {
  if (!path || !homeDir) return path;

  // Windows detection: drive letter followed by colon (e.g. "C:")
  const isWindows = homeDir.length >= 2 && homeDir[1] === ":";

  if (isWindows) {
    // Strip any trailing slashes or backslashes from the home dir
    let home = homeDir;
    while (home.length > 0 && (home[home.length - 1] === "/" || home[home.length - 1] === "\\")) {
      home = home.slice(0, -1);
    }

    // Normalize separators to backslash and lowercase for comparison
    // (Tauri on Windows can return either / or \; path may also be mixed)
    const normHome = home.replaceAll("/", "\\").toLowerCase();
    const normPath = path.replaceAll("/", "\\").toLowerCase();

    if (normPath === normHome || normPath.startsWith(normHome + "\\")) {
      return "%USERPROFILE%" + path.slice(home.length);
    }
  } else {
    // Strip trailing slashes from the home dir
    let home = homeDir;
    while (home.length > 0 && home[home.length - 1] === "/") {
      home = home.slice(0, -1);
    }

    if (path === home || path.startsWith(home + "/")) {
      return "~" + path.slice(home.length);
    }
  }

  return path;
}
