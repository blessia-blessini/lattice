# Scrollbar Regression Check

Three items to verify after the ghost-scrollbar CSS fix.

---

## 1. Wide code block

Hover over the block below — scroll thumb should appear on hover, no gray bar when not hovered.

```rust
fn handle_run_event(&self, app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::Opened { urls } => {
            for url in &urls {
                if let Ok(path) = url.to_file_path() {
                    let path_str = path.to_string_lossy().to_string();
                    if let Err(e) = super::build_window_with_file(app, Some(path_str)) {
                        log::error!("android Opened file://: window creation failed: {}", e);
                    }
                } else if url.scheme() == "content" {
                    log::warn!("android Opened content:// URI — not yet implemented, needs ContentResolver: {}", url);
                }
            }
        }
        tauri::RunEvent::Ready => {
            if app.webview_windows().is_empty() {
                if let Err(e) = super::build_window_with_file(app, None) {
                    log::error!("android Ready: empty window creation failed: {}", e);
                }
            }
        }
        _ => {}
    }
}
```

**Expected:** no gray bar visible at rest. Hover → thin thumb appears. Scroll works.

---

## 2. Wide table

Narrow the window if needed so the table overflows.

| Platform | Runner | SDK setup | Build works | Unit tests in CI | Device tests | Free unsigned |
|----------|--------|-----------|-------------|-----------------|--------------|---------------|
| Android | `ubuntu-latest` | `android-actions/setup-android@v4` (JDK 17 required) | ✅ APK + AAB | ✅ host (Linux) | ❌ needs AVD emulator action | ✅ APK |
| iOS | `macos-latest` | Built-in Xcode (pre-installed on runner) | ❌ placeholder only — needs code signing cert | ✅ host (macOS) | ❌ needs simctl setup | ❌ simulator `.app` only |
| Windows | `windows-latest` | N/A — MSVC toolchain pre-installed | ✅ NSIS installer | ✅ | N/A | ✅ |
| macOS ARM | `macos-latest` | `rustup target add aarch64-apple-darwin` | ✅ DMG | ✅ | N/A | ✅ DMG (unsigned for dev) |
| Linux | `ubuntu-latest` | apt-get libwebkit2gtk, libgtk etc. | ✅ AppImage + deb | ✅ | N/A | ✅ |

**Expected:** no gray bar at rest. Hover → thumb. Horizontal scroll works on narrow window.

---

## 3. KaTeX display math

Inline math: $E = mc^2$ and $a^2 + b^2 = c^2$.

Display math (block):

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

A wide display equation:

$$
f(x) = \frac{1}{\sigma\sqrt{2\pi}} \exp\!\left(-\frac{(x-\mu)^2}{2\sigma^2}\right) \quad \text{where } \sigma > 0 \text{ and } \mu \in \mathbb{R}
$$


---

## Summary

| # | What to check | Pass condition |
|---|---------------|---------------|
| 1 | Code block with long lines | No gray bar at rest; thumb on hover; scrolls |
| 2 | Wide table | No gray bar at rest; thumb on hover; scrolls |
| 3 | KaTeX inline + display | Renders correctly, not clipped |
