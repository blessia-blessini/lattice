// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

//******************************************************************************
// setClipboard
//******************************************************************************
/**
 * Give jsdom's `navigator` an Async Clipboard API (`clip`), or take it away
 * (`undefined`). Only the `clipboard` property is replaced: stubbing the whole
 * `navigator` would also take away `userAgent` and friends, which React and
 * Testing Library read.
 */
export function setClipboard(clip: { writeText: (text: string) => Promise<void> } | undefined): void {
    Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true, writable: true });
}
// setClipboard END ************************************************************
