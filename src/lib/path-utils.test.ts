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

import { describe, it, expect } from "vitest";
import { shortenHomePath } from "./path-utils";

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
describe("shortenHomePath – Windows", () => {
  const home = "C:\\Users\\bober";

  it("replaces prefix with %USERPROFILE%", () => {
    expect(shortenHomePath("C:\\Users\\bober\\Documents\\file.md", home))
      .toBe("%USERPROFILE%\\Documents\\file.md");
  });

  it("is case-insensitive on drive letter and Users", () => {
    expect(shortenHomePath("c:\\users\\bober\\notes.md", home))
      .toBe("%USERPROFILE%\\notes.md");
  });

  it("handles forward-slash paths (Tauri sometimes returns these on Windows)", () => {
    expect(shortenHomePath("C:/Users/bober/Documents/file.md", home))
      .toBe("%USERPROFILE%/Documents/file.md");
  });

  it("handles homeDir with trailing backslash", () => {
    expect(shortenHomePath("C:\\Users\\bober\\file.md", "C:\\Users\\bober\\"))
      .toBe("%USERPROFILE%\\file.md");
  });

  it("returns path unchanged when outside home", () => {
    expect(shortenHomePath("D:\\Projects\\file.md", home))
      .toBe("D:\\Projects\\file.md");
  });

  it("returns path unchanged when only a prefix match but no separator follows", () => {
    // 'C:\Users\bobernard' should NOT match home 'C:\Users\bober'
    expect(shortenHomePath("C:\\Users\\bobernard\\file.md", home))
      .toBe("C:\\Users\\bobernard\\file.md");
  });

  it("handles path equal to homeDir exactly", () => {
    expect(shortenHomePath("C:\\Users\\bober", home))
      .toBe("%USERPROFILE%");
  });
});

// ---------------------------------------------------------------------------
// macOS / Linux
// ---------------------------------------------------------------------------
describe("shortenHomePath – Unix", () => {
  const macHome  = "/Users/bober";
  const linuxHome = "/home/bober";

  it("replaces macOS home prefix with ~", () => {
    expect(shortenHomePath("/Users/bober/Documents/file.md", macHome))
      .toBe("~/Documents/file.md");
  });

  it("replaces Linux home prefix with ~", () => {
    expect(shortenHomePath("/home/bober/notes.md", linuxHome))
      .toBe("~/notes.md");
  });

  it("handles homeDir with trailing slash", () => {
    expect(shortenHomePath("/Users/bober/file.md", "/Users/bober/"))
      .toBe("~/file.md");
  });

  it("returns path unchanged when outside home", () => {
    expect(shortenHomePath("/etc/hosts", macHome))
      .toBe("/etc/hosts");
  });

  it("does not match partial usernames", () => {
    // '/Users/bobernard' must NOT match homeDir '/Users/bober'
    expect(shortenHomePath("/Users/bobernard/file.md", macHome))
      .toBe("/Users/bobernard/file.md");
  });

  it("handles path equal to homeDir exactly", () => {
    expect(shortenHomePath("/Users/bober", macHome))
      .toBe("~");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("shortenHomePath – edge cases", () => {
  it("returns empty string unchanged", () => {
    expect(shortenHomePath("", "/Users/bober")).toBe("");
  });

  it("returns path unchanged when homeDir is empty", () => {
    expect(shortenHomePath("/Users/bober/file.md", "")).toBe("/Users/bober/file.md");
  });
});
