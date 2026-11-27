# Ollama UI

Ollama UI is a small local web app for chatting with AI models running through Ollama. It runs in your browser and connects to the Ollama service on your computer.

## Set up and run

1. Install Ollama for Windows from [ollama.com/download](https://ollama.com/download).
2. Install [Node.js 20 or newer](https://nodejs.org/) if it is not already installed.
3. Open PowerShell and download a model:

   ```powershell
   ollama pull llama3.2:1b
   ```

4. (Optional) Try the model in Ollama:

   ```powershell
   ollama run llama3.2:1b
   ```

   Type `/bye` to exit the chat.

5. In PowerShell, go to this project folder and start the UI:

   ```powershell
   .\ollama-ui.cmd
   ```

   The app opens at <http://127.0.0.1:3131>. Ollama must be running; if it is offline, run `ollama serve` in another PowerShell window.

## Use

- Choose a model from the sidebar and type a message.
- Press **Ctrl+B** or click the arrow at the top right to show or hide the sidebar.
- Use `/list`, `/run 1`, `/clear`, or `/help` in the message field.
- Run `.\ollama-ui.cmd stop` to stop the UI.

## Tests

Run `npm test` from the project folder.
