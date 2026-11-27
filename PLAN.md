# Ollama Terminal UI — Build Plan

## Root causes in V1
- No local server; `file://` fetch to Ollama is brittle/CORS-prone.
- Responses were not rendered as Markdown.
- Invalid CSS (`//` comment inside a `<style>` block).
- Global number-key handler stole digits while typing.
- No CLI commands, no launch shortcut, no streaming, no dark terminal UI.

## Tasks
- [x] 1. Command parser + model resolver
- [x] 2. Zero-dependency Node server with Ollama proxy
- [x] 3. Vendor Markdown/highlighting/sanitizer assets locally
- [x] 4. Terminal-style dark UI with streaming Markdown responses
- [x] 5. In-app commands: `/list`, `/run N`, `/clear`, `/help`
- [x] 6. Keyboard shortcuts: Enter, Shift+Enter, Ctrl+K/L, Alt+1..9, Esc
- [x] 7. Launch shortcut `ollama-ui` + `ollama-ui.cmd` + installer
- [x] 8. Real Ollama/browser verification
