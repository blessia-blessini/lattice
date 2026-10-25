### Impact

KaTeX can act as a read-side prototype pollution gadget in applications where `Object.prototype` has already been polluted, or where an attacker can influence the prototype of the renderer options object. (KaTeX does not enable said prototype pollution. This advisory applies when combining KaTeX with other vulnerable software that allows for prototype pollution.)

Affected versions may treat inherited properties from `Object.prototype` as renderer options, internal setting metadata, or namespace entries. In particular, an inherited `trust` value will be treated as though the application explicitly enabled trusted rendering, rather than using the documented default of `false`.

With attacker-controlled mathematical expressions, this can produce links capable of user-interaction cross-site scripting or load attacker-selected external resources. Exploitation requires the consuming application to insert KaTeX output into a web page without a separate sanitizer. (KaTeX does not execute scripts merely by rendering an expression.)

Other inherited settings can alter rendering behavior or resource limits. Inherited setting metadata can affect how defaults and supplied options are processed, while inherited namespace properties can be mistaken for defined macros or other internal values.

### Patches

Upgrade to KaTeX v0.18.2 to remove this vulnerability.

### Workarounds

- Address any prototype-pollution vulnerability in the application or its dependencies.
- `delete Object.prototype.trust`, `delete Object.prototype.default`, and `delete Object.prototype.processor` before calling KaTeX
- Do not allow untrusted input to control the renderer options object or its prototype.
- Sanitize KaTeX-generated HTML before inserting it into a document.

### Details

KaTeX previously used ordinary JavaScript property access in the following contexts:

- Renderer settings could be inherited from the prototype of the options object.
- Internal `default` and `processor` setting metadata could be inherited from `Object.prototype`.
- Namespace lookup could treat inherited properties as built-in definitions.
- Namespace group restoration could preserve an inherited property as though it had been an explicitly defined value.

The fix adds own-property checks to each of these paths. Inherited properties are no longer accepted as renderer settings, setting metadata, namespace definitions, or values to be restored after a group ends.

### For more information

If you have any questions or comments about this advisory:

- Open an issue or security advisory in the [KaTeX repository](https://github.com/KaTeX/KaTeX/)
- Email us at [katex-security@mit.edu](mailto:katex-security@mit.edu)
src/App.tsx:37:import rehypeKatex from 'rehype-katex';
src/App.tsx:38:import 'katex/dist/katex.min.css';
src/App.tsx:102:// IMPL-LTTCE-DVW-00005 — rehype-katex REPLACES the display-math host element
src/lib/export-document.ts:63:import katexCss from 'katex/dist/katex.min.css?raw';
src/lib/export-document.ts:71: * project-root path (`/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2`).
src/lib/export-document.ts:82:    '/node_modules/katex/dist/fonts/*.woff2',