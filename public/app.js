import {
  parseInput,
  resolveModel,
  formatModelList,
  formatBytes,
  buildChatMessages,
  DEFAULT_SYSTEM_PROMPT
} from './commands.js';
import { createMathExtensions, MATH_DELIMITERS } from './math-markdown.js';

const MODEL_STORAGE_KEY = 'ollama-terminal.active-model';
const HISTORY_STORAGE_KEY = 'ollama-terminal.history';
const THEME_STORAGE_KEY = 'ollama-terminal.theme';
const SYSTEM_PROMPT_STORAGE_KEY = 'ollama-terminal.system-prompt';
const SIDEBAR_STORAGE_KEY = 'ollama-terminal.sidebar';
const HISTORY_LIMIT = 60;

const HELP_MARKDOWN = `### Commands

| Command | Action |
| --- | --- |
| \`/list\` or \`ollama list\` | Show installed models with their shortcut numbers |
| \`/run 2\` or \`ollama run 2\` | Switch to model #2 |
| \`/run llama3.2:1b\` | Switch by model name |
| \`/clear\` | Clear the terminal and conversation context |
| \`/help\` | Show this help |

### Interface

| Control | Action |
| --- | --- |
| Theme button (top right) | Toggle light / dark theme (saved locally) |
| Sidebar button (‹ / ›) | Show or hide the model sidebar (saved locally) |
| Settings button (⚙) | Edit the persistent system prompt (tutor mode) |
| Copy button on code blocks | Copy the raw snippet to the clipboard |

### Keyboard shortcuts

- **Enter** — send message
- **Shift + Enter** — insert a new line
- **Alt + 1–9** — instantly switch model
- **Ctrl + B** — show or hide the model sidebar
- **Ctrl + L** or **Ctrl + K** — clear the terminal
- **Esc** — stop the current generation
- **↑ / ↓** — browse prompt history

### Notes

- Responses stream from Ollama and render as GitHub-flavored Markdown.
- Code blocks are syntax-highlighted; hover a block and click **copy**.
- Chat context stays in this tab until you run \`/clear\`.
- Ollama must already be running at \`127.0.0.1:11434\`.`;

const state = {
  models: [],
  activeModel: null,
  messages: [],
  generating: false,
  controller: null,
  generationId: 0,
  abortMode: 'user',
  history: loadHistory(),
  historyIndex: -1,
  historyDraft: '',
  connection: 'connecting',
  version: null,
  theme: 'dark',
  systemPrompt: DEFAULT_SYSTEM_PROMPT
};

const els = {
  connStatus: document.getElementById('connStatus'),
  connText: document.getElementById('connText'),
  modelList: document.getElementById('modelList'),
  modelCount: document.getElementById('modelCount'),
  messages: document.getElementById('messages'),
  terminal: document.getElementById('terminal'),
  welcome: document.getElementById('welcome'),
  welcomeModels: document.getElementById('welcomeModels'),
  composer: document.getElementById('composer'),
  prompt: document.getElementById('prompt'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
  refreshModels: document.getElementById('refreshModels'),
  helpBtn: document.getElementById('helpBtn'),
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  themeLabel: document.getElementById('themeLabel'),
  settingsBtn: document.getElementById('settingsBtn'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarToggleIcon: document.getElementById('sidebarToggleIcon'),
  workspace: document.getElementById('workspace'),
  settingsDialog: document.getElementById('settingsDialog'),
  systemPrompt: document.getElementById('systemPrompt'),
  systemPromptStatus: document.getElementById('systemPromptStatus'),
  resetSystemPrompt: document.getElementById('resetSystemPrompt'),
  applySystemPrompt: document.getElementById('applySystemPrompt'),
  closeSettings: document.getElementById('closeSettings'),
  activeModelLabel: document.getElementById('activeModelLabel'),
  statusInfo: document.getElementById('statusInfo')
};

const ICONS = {
  user: '❯',
  assistant: '●',
  system: '◇',
  error: '✗'
};

/* ── boot ───────────────────────────────────────────── */

(function boot() {
  if (window.marked) {
    try {
      window.marked.use({
        extensions: createMathExtensions(escapeHtml)
      });
    } catch (error) {
      /* fall back to the default parser */
    }
    window.marked.setOptions({ gfm: true, breaks: true });
  }
  if (window.hljs) {
    window.hljs.configure({ ignoreUnescapedHTML: true });
  }

  state.theme = loadTheme();
  applyTheme(state.theme, { persist: false });
  setSidebarOpen(localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'closed', { persist: false });
  state.systemPrompt = loadSystemPrompt();
  setSystemPrompt(state.systemPrompt, { persist: false });

  bindEvents();
  updateSendState();
  resizePrompt();
  refreshAll();

  setInterval(() => {
    if (!document.hidden) pollHealth();
  }, 25000);
})();

async function refreshAll() {
  setConnection('connecting');
  const [health, models] = await Promise.all([fetchHealth(), fetchModels()]);

  if (health.online) {
    setConnection('online', health.version);
  } else if (models.ok) {
    setConnection('online');
  } else {
    setConnection('offline');
  }

  if (models.ok) {
    applyModels(models.models);
  } else {
    renderModelError(models.error);
    els.welcomeModels.textContent = 'ollama not reachable — run "ollama serve"';
    els.welcomeModels.className = 'danger';
    setStatus('ollama offline');
  }
  updateSendState();
  updateWelcome();
  els.prompt.focus();
}

async function pollHealth() {
  const health = await fetchHealth();
  if (health.online) {
    const recovered = state.connection !== 'online';
    setConnection('online', health.version);
    if (recovered) {
      const models = await fetchModels();
      if (models.ok) applyModels(models.models);
    }
  } else {
    setConnection('offline');
  }
}

/* ── API ────────────────────────────────────────────── */

async function fetchHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    return data.ollama || { online: false, version: null, error: 'Invalid health response' };
  } catch (error) {
    return { online: false, version: null, error: error.message };
  }
}

async function fetchModels() {
  try {
    const response = await fetch('/api/models', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: data.error || `HTTP ${response.status}` };
    }
    return { ok: true, models: data.models || [] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function reloadModels() {
  els.refreshModels.disabled = true;
  els.modelList.innerHTML = '<div class="model-loading">scanning manifests…</div>';
  const result = await fetchModels();
  els.refreshModels.disabled = false;
  if (result.ok) {
    setConnection('online');
    applyModels(result.models);
  } else {
    setConnection('offline');
    renderModelError(result.error);
  }
  updateSendState();
}

/* ── models ─────────────────────────────────────────── */

function applyModels(models) {
  state.models = models;
  const stored = localStorage.getItem(MODEL_STORAGE_KEY);
  const storedMatch = models.find((model) => model.name === stored);
  if (!storedMatch) {
    state.activeModel = models[0]?.name || null;
  } else {
    state.activeModel = storedMatch.name;
  }
  if (state.activeModel) {
    localStorage.setItem(MODEL_STORAGE_KEY, state.activeModel);
  }
  renderModels();
  updateActiveModelLabel();
  updateSendState();
  setStatus(
    models.length
      ? `ready · ${models.length} model${models.length === 1 ? '' : 's'}`
      : 'no models installed'
  );
  updateWelcome();
}

function renderModels() {
  els.modelList.replaceChildren();

  if (!state.models.length) {
    const empty = document.createElement('div');
    empty.className = 'model-empty';
    empty.innerHTML = '<strong>no models found</strong><br>Pull one with <code>ollama pull llama3.2:1b</code>.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'rescan models';
    retry.addEventListener('click', reloadModels);
    empty.appendChild(retry);
    els.modelList.appendChild(empty);
    els.modelCount.textContent = '0 installed';
    return;
  }

  for (const [index, model] of state.models.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'model-item' + (model.name === state.activeModel ? ' active' : '');
    button.title = `Alt+${index + 1}`;
    button.setAttribute('aria-pressed', String(model.name === state.activeModel));

    const number = document.createElement('span');
    number.className = 'model-number';
    number.textContent = String(index + 1);

    const body = document.createElement('span');
    body.className = 'model-body';

    const name = document.createElement('span');
    name.className = 'model-name';
    name.textContent = model.name;

    const meta = document.createElement('span');
    meta.className = 'model-meta';
    meta.textContent = [formatBytes(model.size), model.parameterSize, model.quantization]
      .filter(Boolean)
      .join(' · ');

    body.append(name, meta);
    button.append(number, body);
    button.addEventListener('click', () => {
      selectModel(model.name, { announce: true });
    });
    els.modelList.appendChild(button);
  }

  els.modelCount.textContent = `${state.models.length} installed`;
}

function renderModelError(message) {
  els.modelList.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'model-empty';
  empty.innerHTML = '<strong>ollama offline</strong><br>';
  const detail = document.createElement('span');
  detail.textContent = message || 'Cannot reach 127.0.0.1:11434.';
  empty.appendChild(detail);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'retry connection';
  retry.addEventListener('click', refreshAll);
  empty.appendChild(retry);
  els.modelList.appendChild(empty);
  els.modelCount.textContent = 'offline';
  updateSendState();
}

function selectModel(name, { announce = false } = {}) {
  const model = state.models.find((item) => item.name === name);
  if (!model) {
    appendError(`Model "${name}" is not installed. Run /list to see installed models.`);
    return;
  }

  if (state.generating) {
    stopGeneration({ silent: true });
  }

  const changed = state.activeModel !== model.name;
  state.activeModel = model.name;
  localStorage.setItem(MODEL_STORAGE_KEY, model.name);
  renderModels();
  updateActiveModelLabel();
  updateWelcome();
  setStatus('ready');

  if (announce) {
    const number = state.models.indexOf(model) + 1;
    appendSystemText(
      'model',
      changed
        ? `active model → #${number} ${model.name}\n${formatBytes(model.size)} · ${model.family || 'local'} · ${model.parameterSize || ''}`
        : `already using #${number} ${model.name}`
    );
  }
  updateSendState();
}

function updateActiveModelLabel() {
  els.activeModelLabel.textContent = state.activeModel || 'no model';
  els.activeModelLabel.title = state.activeModel || 'No active model';
}

function updateWelcome() {
  if (!state.models.length) {
    els.welcomeModels.textContent = 'waiting for local models…';
    els.welcomeModels.className = 'muted';
    return;
  }
  const active = state.activeModel || 'none';
  els.welcomeModels.textContent =
    `${state.models.length} local model${state.models.length === 1 ? '' : 's'} online · ${active} active`;
  els.welcomeModels.className = 'accent';
}

/* ── connection / status ────────────────────────────── */

function setConnection(status, version = null) {
  state.connection = status;
  state.version = version;
  els.connStatus.classList.remove('online', 'offline', 'connecting');
  els.connStatus.classList.add(status);
  if (status === 'online') {
    els.connText.textContent = 'online';
    els.connStatus.title = version ? `Ollama v${version}` : 'Ollama online';
  } else if (status === 'offline') {
    els.connText.textContent = 'offline';
    els.connStatus.title = 'Cannot reach Ollama at 127.0.0.1:11434';
  } else {
    els.connText.textContent = 'connecting';
    els.connStatus.title = 'Checking Ollama…';
  }
}

function setStatus(text) {
  els.statusInfo.textContent = text;
}

/* ── input / keyboard ───────────────────────────────── */

function bindEvents() {
  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCurrentInput();
  });

  els.prompt.addEventListener('input', () => {
    resizePrompt();
    state.historyIndex = -1;
  });

  els.prompt.addEventListener('keydown', onPromptKeydown);
  document.addEventListener('keydown', onGlobalKeydown);
  els.stopBtn.addEventListener('click', () => stopGeneration());
  els.refreshModels.addEventListener('click', reloadModels);
  els.sidebarToggle.addEventListener('click', () => {
    setSidebarOpen(els.sidebarToggle.getAttribute('aria-expanded') !== 'true');
  });
  els.themeToggle.addEventListener('click', () => {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
  });
  els.settingsBtn.addEventListener('click', openSettings);
  els.closeSettings.addEventListener('click', () => els.settingsDialog.close());
  els.applySystemPrompt.addEventListener('click', () => els.settingsDialog.close());
  els.resetSystemPrompt.addEventListener('click', () => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  });
  els.systemPrompt.addEventListener('input', () => {
    setSystemPrompt(els.systemPrompt.value);
  });
  els.settingsDialog.addEventListener('click', (event) => {
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
  els.helpBtn.addEventListener('click', () => {
    appendSystemText('help', HELP_MARKDOWN, { markdown: true });
    els.prompt.focus();
  });

  els.messages.addEventListener('click', async (event) => {
    const button = event.target.closest('.copy-code');
    if (!button) return;
    const code = button.closest('pre')?.querySelector('code');
    if (!code) return;
    try {
      await copyText(code.textContent || '');
      button.textContent = 'Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('copied');
      }, 1400);
    } catch {
      button.textContent = 'Failed';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1400);
    }
  });
}

function onPromptKeydown(event) {
  if (event.isComposing) return;

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitCurrentInput();
    return;
  }

  if (event.key === 'ArrowUp' && !event.altKey && !event.shiftKey) {
    if (state.history.length === 0) return;
    if (els.prompt.selectionStart === 0 && els.prompt.selectionEnd === 0) {
      event.preventDefault();
      navigateHistory(-1);
    }
    return;
  }

  if (event.key === 'ArrowDown' && !event.altKey && !event.shiftKey) {
    if (state.historyIndex === -1) return;
    if (
      els.prompt.selectionStart === els.prompt.value.length &&
      els.prompt.selectionEnd === els.prompt.value.length
    ) {
      event.preventDefault();
      navigateHistory(1);
    }
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    insertAtCursor('  ');
  }
}

function onGlobalKeydown(event) {
  if (event.altKey && /^[1-9]$/.test(event.key)) {
    const model = state.models[Number(event.key) - 1];
    if (model) {
      event.preventDefault();
      selectModel(model.name, { announce: true });
    }
    return;
  }

  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'b') {
    event.preventDefault();
    setSidebarOpen(els.sidebarToggle.getAttribute('aria-expanded') !== 'true');
    return;
  }

  if ((event.ctrlKey || event.metaKey) && (key === 'k' || key === 'l')) {
    event.preventDefault();
    clearTerminal();
    return;
  }

  if (event.key === 'Escape' && state.generating) {
    event.preventDefault();
    stopGeneration();
  }
}

function submitCurrentInput() {
  const raw = els.prompt.value.trim();
  if (!raw || state.generating) return;
  els.prompt.value = '';
  resizePrompt();
  handleInput(raw);
  els.prompt.focus();
}

function handleInput(raw) {
  const parsed = parseInput(raw);
  if (parsed.type === 'empty') return;
  rememberPrompt(raw);

  if (parsed.type === 'prompt') {
    appendUserMessage(parsed.text);
    sendPrompt(parsed.text);
    return;
  }

  if (parsed.name === 'clear') {
    clearTerminal();
    return;
  }

  appendUserMessage(raw, { command: true });

  if (parsed.name === 'list') {
    if (!state.models.length) {
      appendError('No models available. Start Ollama and run /list again.');
      return;
    }
    const activeNumber = state.models.findIndex((m) => m.name === state.activeModel) + 1;
    appendSystemText(
      'models',
      `${formatModelList(state.models, state.activeModel)}\n\n` +
        `${state.models.length} installed · active #${activeNumber}\n` +
        'Alt+1–9 switch · /run <n> activate'
    );
    return;
  }

  if (parsed.name === 'run') {
    if (parsed.error) {
      appendError(parsed.error);
      return;
    }
    if (!state.models.length) {
      appendError('No models available. Start Ollama and run /list again.');
      return;
    }
    const resolved = resolveModel(state.models, parsed.target);
    if (resolved.error) {
      appendError(resolved.error);
      return;
    }
    const number = state.models.indexOf(resolved.model) + 1;
    selectModel(resolved.model.name, { announce: false });
    appendSystemText('model', `active model → #${number} ${resolved.model.name}\nready for input`);
    return;
  }

  if (parsed.name === 'help') {
    appendSystemText('help', HELP_MARKDOWN, { markdown: true });
    return;
  }

  appendError(parsed.error || 'Unknown command. Type /help.');
}

function navigateHistory(direction) {
  if (state.historyIndex === -1) {
    state.historyDraft = els.prompt.value;
    state.historyIndex = state.history.length;
  }
  const next = Math.max(0, Math.min(state.history.length, state.historyIndex + direction));
  if (next === state.history.length) {
    state.historyIndex = -1;
    els.prompt.value = state.historyDraft;
  } else {
    state.historyIndex = next;
    els.prompt.value = state.history[next];
  }
  resizePrompt();
  requestAnimationFrame(() => {
    els.prompt.selectionStart = els.prompt.selectionEnd = els.prompt.value.length;
  });
}

function insertAtCursor(text) {
  const start = els.prompt.selectionStart;
  const end = els.prompt.selectionEnd;
  els.prompt.value =
    els.prompt.value.slice(0, start) + text + els.prompt.value.slice(end);
  els.prompt.selectionStart = els.prompt.selectionEnd = start + text.length;
  resizePrompt();
}

function resizePrompt() {
  els.prompt.style.height = 'auto';
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 180)}px`;
}

/* ── sending / streaming ────────────────────────────── */

async function sendPrompt(text) {
  if (!state.activeModel) {
    appendError('No active model. Pick one from the sidebar or run /list.');
    return;
  }

  const myId = ++state.generationId;
  state.generating = true;
  state.abortMode = 'user';
  updateSendState();
  els.stopBtn.classList.remove('hidden');
  setStatus(`streaming · ${state.activeModel}`);

  state.messages.push({ role: 'user', content: text });
  const entry = appendAssistantMessage();
  const controller = new AbortController();
  state.controller = controller;

  let full = '';
  let finalData = null;
  let pendingRender = null;

  const scheduleRender = () => {
    if (pendingRender) return;
    pendingRender = setTimeout(() => {
      pendingRender = null;
      if (state.generationId !== myId) return;
      setAssistantContent(entry, full, { streaming: true });
      maybeScroll();
    }, 55);
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: state.activeModel,
        messages: buildChatMessages(state.messages, state.systemPrompt)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const detail = data.detail ? `\n${data.detail}` : '';
      throw new Error(`${data.error || `Server returned HTTP ${response.status}`}${detail}`);
    }

    await readNDJSON(response, (chunk) => {
      if (chunk.error) throw new Error(chunk.error);
      const piece = chunk.message?.content ?? chunk.response ?? '';
      if (piece) {
        full += piece;
        scheduleRender();
      }
      if (chunk.done) finalData = chunk;
    });

    if (pendingRender) {
      clearTimeout(pendingRender);
      pendingRender = null;
    }
    if (state.generationId !== myId) return;

    if (!full.trim()) {
      entry.article.remove();
      state.messages.pop();
      appendError('The model returned an empty response.');
      setStatus('empty response');
      return;
    }

    entry.thinking.classList.add('hidden');
    setAssistantContent(entry, full, { streaming: false });
    state.messages.push({ role: 'assistant', content: full });
    updateTokenStats(entry, finalData);
    setStatus(describeStats(finalData));
    maybeScroll(true);
  } catch (error) {
    if (pendingRender) {
      clearTimeout(pendingRender);
      pendingRender = null;
    }
    if (state.generationId !== myId) return;

    const aborted =
      error.name === 'AbortError' ||
      error.message === 'The user aborted a request.' ||
      state.abortMode !== 'user';

    if (aborted) {
      entry.thinking.classList.add('hidden');
      if (full.trim()) {
        setAssistantContent(entry, full, { streaming: false });
        state.messages.push({ role: 'assistant', content: full });
      } else {
        entry.article.remove();
        state.messages.pop();
      }
      if (state.abortMode !== 'silent') {
        appendSystemText('stopped', 'generation stopped — partial output kept above');
      }
      setStatus('stopped');
    } else {
      entry.article.remove();
      state.messages.pop();
      appendError(error.message || 'Request failed.');
      if (/cannot reach ollama/i.test(error.message)) {
        setConnection('offline');
      }
      setStatus('request failed');
    }
  } finally {
    if (state.generationId === myId) {
      state.generating = false;
      state.controller = null;
      els.stopBtn.classList.add('hidden');
      updateSendState();
      els.prompt.focus();
    }
  }
}

async function readNDJSON(response, onChunk) {
  if (!response.body) throw new Error('Streaming is not supported by this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onChunk(JSON.parse(line));
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) onChunk(JSON.parse(tail));
}

function stopGeneration({ silent = false } = {}) {
  if (!state.generating) return;
  state.abortMode = silent ? 'silent' : 'user';
  state.controller?.abort();
}

function updateSendState() {
  els.sendBtn.disabled = state.generating || !state.activeModel || state.models.length === 0;
}

function updateTokenStats(entry, data) {
  if (!entry.tokensEl || !data) return;
  const count = data.eval_count ?? 0;
  const seconds = (data.eval_duration ?? 0) / 1e9;
  if (!count) return;
  const rate = seconds > 0 ? (count / seconds).toFixed(1) : null;
  entry.tokensEl.textContent = rate
    ? `${count} tok · ${rate} tok/s`
    : `${count} tok`;
}

function describeStats(data) {
  if (!data) return 'ready';
  const count = data.eval_count ?? 0;
  const seconds = (data.eval_duration ?? 0) / 1e9;
  if (!count) return 'ready';
  const rate = seconds > 0 ? (count / seconds).toFixed(1) : null;
  return rate ? `done · ${rate} tok/s` : `done · ${count} tokens`;
}

/* ── terminal rendering ─────────────────────────────── */

function hideWelcome() {
  els.welcome.classList.add('hidden');
}

function showWelcome() {
  els.welcome.classList.remove('hidden');
}

function createMessageShell(role, title) {
  hideWelcome();
  const stick = shouldStickToBottom();

  const article = document.createElement('article');
  article.className = `msg msg-${role}`;

  const icon = document.createElement('div');
  icon.className = 'msg-icon';
  icon.textContent = ICONS[role] || '·';
  icon.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'msg-body';

  const head = document.createElement('div');
  head.className = 'msg-head';

  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = title;

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = new Date().toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const tokens = document.createElement('span');
  tokens.className = 'msg-tokens';

  head.append(who, time, tokens);
  body.append(head);
  article.append(icon, body);
  els.messages.appendChild(article);
  if (stick) scrollToBottom();

  return { article, body, head, tokensEl: tokens };
}

function appendUserMessage(text, { command = false } = {}) {
  const { body } = createMessageShell('user', command ? 'cmd' : 'you');
  const content = document.createElement('div');
  content.className = 'msg-content';
  content.textContent = text;
  body.appendChild(content);
  maybeScroll();
}

function appendAssistantMessage() {
  const { article, body, tokensEl } = createMessageShell('assistant', 'assistant');

  const thinking = document.createElement('div');
  thinking.className = 'thinking';
  thinking.innerHTML =
    '<span class="thinking-dots"><span></span><span></span><span></span></span>' +
    '<span class="thinking-label">running local inference…</span>';

  const content = document.createElement('div');
  content.className = 'msg-content';

  body.append(thinking, content);
  maybeScroll();

  return { article, body, thinking, content, tokensEl };
}

function appendSystemText(title, text, { markdown = false } = {}) {
  const { body } = createMessageShell('system', title);
  if (markdown) {
    const content = document.createElement('div');
    content.className = 'msg-content';
    setRenderedMarkdown(content, text, { highlight: true });
    body.appendChild(content);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'command-block';
    pre.textContent = text;
    body.appendChild(pre);
  }
  maybeScroll();
}

function appendError(text) {
  const { body } = createMessageShell('error', 'error');
  const content = document.createElement('div');
  content.className = 'error-text';
  content.textContent = text;
  body.appendChild(content);
  maybeScroll();
}

function setAssistantContent(entry, text, { streaming }) {
  entry.thinking.classList.add('hidden');
  setRenderedMarkdown(entry.content, text, { highlight: !streaming });
  if (streaming) {
    const cursor = document.createElement('span');
    cursor.className = 'stream-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    entry.content.appendChild(cursor);
  }
}

function setRenderedMarkdown(container, markdown, { highlight = false } = {}) {
  const source = String(markdown ?? '');
  let html = '';
  if (window.marked) {
    html = window.marked.parse(source, { async: false });
  } else {
    html = `<p>${escapeHtml(source)}</p>`;
  }
  const clean = window.DOMPurify
    ? window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
    : html;
  container.innerHTML = clean;

  for (const link of container.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  renderMath(container);

  if (highlight) {
    for (const code of container.querySelectorAll('pre code')) {
      try {
        window.hljs?.highlightElement(code);
      } catch {
        /* leave it as plain code */
      }
      const pre = code.closest('pre');
      if (pre && !pre.querySelector('.copy-code')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-code';
        button.textContent = 'Copy';
        button.setAttribute('aria-label', 'Copy code to clipboard');
        pre.appendChild(button);
      }
    }
  } else {
    // Keep a copy button available as soon as a fenced block is complete.
    for (const code of container.querySelectorAll('pre code')) {
      const pre = code.closest('pre');
      if (pre && !pre.querySelector('.copy-code')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-code';
        button.textContent = 'Copy';
        button.setAttribute('aria-label', 'Copy code to clipboard');
        pre.appendChild(button);
      }
    }
  }
}

/* ── theme / settings / math helpers ────────────────── */

function loadTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme, { persist = true } = {}) {
  const next = theme === 'light' ? 'light' : 'dark';
  state.theme = next;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  updateThemeButton();
}

function updateThemeButton() {
  const isLight = state.theme === 'light';
  if (els.themeIcon) els.themeIcon.textContent = isLight ? '🌙' : '☀️';
  if (els.themeLabel) els.themeLabel.textContent = isLight ? 'Dark' : 'Light';
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme';
  if (els.themeToggle) {
    els.themeToggle.title = label;
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.setAttribute('aria-pressed', String(isLight));
  }
}

function setSidebarOpen(isOpen, { persist = true } = {}) {
  els.workspace.classList.toggle('sidebar-collapsed', !isOpen);
  const label = isOpen ? 'Hide sidebar' : 'Show sidebar';
  els.sidebarToggle.title = label;
  els.sidebarToggle.setAttribute('aria-label', label);
  els.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
  els.sidebarToggleIcon.textContent = isOpen ? '‹' : '›';
  if (persist) {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, isOpen ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
  }
}

function loadSystemPrompt() {
  try {
    const stored = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
    return stored === null ? DEFAULT_SYSTEM_PROMPT : stored;
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

function setSystemPrompt(value, { persist = true } = {}) {
  state.systemPrompt = String(value ?? '');
  if (els.systemPrompt) els.systemPrompt.value = state.systemPrompt;
  if (persist) {
    try {
      localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, state.systemPrompt);
    } catch {
      /* ignore */
    }
  }
  updateSystemPromptStatus();
}

function updateSystemPromptStatus() {
  if (!els.systemPromptStatus) return;
  const custom = state.systemPrompt.trim() !== '' &&
    state.systemPrompt.trim() !== DEFAULT_SYSTEM_PROMPT.trim();
  els.systemPromptStatus.textContent = custom
    ? 'Custom tutor instruction · saved locally'
    : 'Default tutor instruction · saved locally';
}

function openSettings() {
  setSystemPrompt(state.systemPrompt, { persist: false });
  if (typeof els.settingsDialog?.showModal === 'function') {
    els.settingsDialog.showModal();
  } else if (els.settingsDialog) {
    els.settingsDialog.setAttribute('open', '');
  }
  els.systemPrompt?.focus();
}

function renderMath(container) {
  if (!container || !window.renderMathInElement) return;
  try {
    window.renderMathInElement(container, {
      delimiters: MATH_DELIMITERS,
      throwOnError: false,
      strict: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
    });
  } catch (error) {
    /* leave the raw TeX in place */
  }
}

/* ── clear / history / helpers ──────────────────────── */

function clearTerminal() {
  if (state.generating) {
    state.generationId += 1;
    state.abortMode = 'silent';
    state.controller?.abort();
    state.controller = null;
    state.generating = false;
    els.stopBtn.classList.add('hidden');
    updateSendState();
  }
  state.messages = [];
  state.history = [];
  state.historyIndex = -1;
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  els.messages.replaceChildren();
  showWelcome();
  updateWelcome();
  setStatus('terminal cleared');
  els.prompt.value = '';
  resizePrompt();
  els.prompt.focus();
}

function rememberPrompt(raw) {
  if (!raw) return;
  if (state.history[state.history.length - 1] !== raw) {
    state.history.push(raw);
    if (state.history.length > HISTORY_LIMIT) {
      state.history = state.history.slice(-HISTORY_LIMIT);
    }
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history));
  }
  state.historyIndex = -1;
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((line) => typeof line === 'string') : [];
  } catch {
    return [];
  }
}

function shouldStickToBottom() {
  return (
    els.terminal.scrollHeight - els.terminal.scrollTop - els.terminal.clientHeight < 90
  );
}

function maybeScroll(force = false) {
  if (force || shouldStickToBottom()) scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.terminal.scrollTop = els.terminal.scrollHeight;
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
