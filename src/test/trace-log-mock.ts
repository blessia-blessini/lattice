// LEGAL NOTE:
// LATTICE (tm) - The Portable and standard Markdown Editor
// Copyright (C) 2026 Owner of blessini.com (a.k.a Blessia)
// See LICENCE file in GitHUB root folder of the repository.
// END OF NOTE

//******************************************************************************
// answerTraceLog
//******************************************************************************
/**
 * The answer of a mocked `invoke('trace_log', …)`: resolve, and nothing else.
 *
 * It must not log. `StaticRuntime.dev.ts` patches `console.*`, and its `log`
 * and `error`, so that every line calls `invoke('trace_log')`. A mock that
 * logs again — as the mocks did through `StaticRuntime.log` until 2026-11-13 —
 * recurses synchronously until the stack overflows (`sendTrace` swallows the
 * RangeError) and records every level in the mock's call list: about 22,700
 * calls after one render of the App instead of a handful. Every
 * `waitFor(() => expect(invoke).toHaveBeenCalledWith(…))` then compared them
 * all every 50 ms, which in a full parallel run under coverage blocked a test
 * worker for seconds and timed tests out.
 */
export const answerTraceLog = (): Promise<void> => Promise.resolve();
// answerTraceLog END **********************************************************
