# Trace Coverage — rehype-safe-html

| Requirement              | Test file                          | Test description                                    |
| :----------------------- | :--------------------------------- | :-------------------------------------------------- |
| REQ-LTTCE-LNT-0000D (whitelist renders) | rehype-safe-html.test.ts | `<sup>` open+close → sup element |
| REQ-LTTCE-LNT-0000D (whitelist renders) | rehype-safe-html.test.ts | `<sub>` → sub element |
| REQ-LTTCE-LNT-0000D (whitelist renders) | rehype-safe-html.test.ts | `<kbd>` → kbd element |
| REQ-LTTCE-LNT-0000D (whitelist renders) | rehype-safe-html.test.ts | `<br>`, `<br/>`, `<br />` → br element |
| REQ-LTTCE-LNT-0000D (non-whitelisted)  | rehype-safe-html.test.ts | `<div>`, `<span>` left as raw |
| REQ-LTTCE-LNT-0000D (unmatched open)   | rehype-safe-html.test.ts | `<sup>` with no close left as raw |
| REQ-LTTCE-LNT-0000D (nested)           | rehype-safe-html.test.ts | `<kbd><sup>…</sup></kbd>` nested |
| REQ-LTTCE-LNT-0000D (multiple)         | rehype-safe-html.test.ts | Multiple independent tags in one paragraph |
