# Ollama UI

Ollama UI is a small, local web app for chatting with AI models running through Ollama. It opens in your browser and connects to the Ollama service on your computer. This project does not install or start Ollama for you.

## Requirements

- Windows
- [Ollama](https://ollama.com/download) installed
- [Node.js 20 or newer](https://nodejs.org/)

## First-time setup

1. Install Ollama, then open it once so its local service can start.
2. Open PowerShell and download a model. For example:

   ```powershell
   ollama pull llama3.2:1b
   ```

   You can choose another model from the [Ollama library](https://ollama.com/library).

3. Optionally, check that the model works in Ollama:

   ```powershell
   ollama run llama3.2:1b
   ```

   Type `/bye` to exit the model chat.

4. Install Node.js 20 or newer if it is not already installed.
5. In PowerShell, change to this project folder and start the UI:

   ```powershell
   .\ollama-ui.cmd
   ```

   It starts the local UI server and opens <http://127.0.0.1:3131> in your browser. The UI lists the models installed in Ollama.

Ollama usually starts its service automatically. If the UI reports that Ollama is offline, start Ollama or run `ollama serve` in a separate PowerShell window.

## Using the UI

- Select a model in the sidebar, type a message, then press **Enter** to send. **Shift+Enter** adds a new line.
- Press **Ctrl+B** or click the arrow at the top right to hide or reopen the sidebar.
- Enter `/list` to show installed models, `/run 1` to switch models, `/clear` to clear the conversation, or `/help` to see commands and shortcuts.
- Use **Settings** to edit the system prompt. The selected theme and prompt are saved in your browser.

## Launcher commands

Run these from PowerShell in the project folder:

```powershell
.\ollama-ui.cmd status
.\ollama-ui.cmd open
.\ollama-ui.cmd restart
.\ollama-ui.cmd stop
```

To use `ollama-ui` as a shortcut in PowerShell, install it once:

```powershell
pwsh -ExecutionPolicy Bypass -File .\install-shortcut.ps1
```

Open a new PowerShell window after installation.

## Troubleshooting

- **Ollama is offline:** Open Ollama or run `ollama serve` in another PowerShell window.
- **No models appear:** Download one with `ollama pull llama3.2:1b`.
- **Node.js is missing:** Install Node.js 20 or newer, then open a new PowerShell window.
- **Port 3131 is busy:** Set a different port before launching, for example `$env:OLLAMA_UI_PORT = '3333'`.
