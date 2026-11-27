/**
 * Parse a terminal line into either a chat prompt or a CLI-style command.
 * Shared by the browser UI and the Node test suite.
 */
export function parseInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { type: 'empty' };

  const tokens = text.split(/\s+/);
  const head = tokens[0].toLowerCase();
  const second = (tokens[1] || '').toLowerCase();

  if (head === '/list' || head === '/models' || (head === 'ollama' && second === 'list')) {
    return { type: 'command', name: 'list', args: [] };
  }

  if (head === '/clear' || head === 'clear' || head === 'cls') {
    return { type: 'command', name: 'clear', args: [] };
  }

  if (head === '/help' || head === 'help') {
    return { type: 'command', name: 'help', args: [] };
  }

  if (head === '/run' || (head === 'ollama' && second === 'run')) {
    const target = (head === '/run' ? tokens.slice(1) : tokens.slice(2)).join(' ').trim();
    if (!target) {
      return {
        type: 'command',
        name: 'run',
        target: null,
        error: 'Usage: /run <number|model>'
      };
    }
    return { type: 'command', name: 'run', target };
  }

  if (head === 'ollama') {
    return {
      type: 'command',
      name: 'unknown',
      raw: text,
      error: 'Unknown ollama command. Try "ollama list" or "ollama run 1".'
    };
  }

  if (head.startsWith('/')) {
    return {
      type: 'command',
      name: 'unknown',
      raw: text,
      error: `Unknown command: ${head}. Type /help.`
    };
  }

  return { type: 'prompt', text };
}

/**
 * Resolve a numeric shortcut or a model name against the installed models.
 */
export function resolveModel(models, target) {
  const raw = String(target ?? '').trim();
  if (!raw) return { error: 'Choose a model number or name.' };

  if (/^\d+$/.test(raw)) {
    const number = Number(raw);
    const model = models[number - 1];
    if (!model) {
      return {
        error: models.length
          ? `No model #${number}. Choose 1-${models.length}.`
          : 'No models installed. Pull one with "ollama pull <model>".'
      };
    }
    return { model };
  }

  const lowered = raw.toLowerCase();
  const exact =
    models.find((model) => model.name === raw) ||
    models.find((model) => model.name.toLowerCase() === lowered);
  if (exact) return { model: exact };

  const base = models.find(
    (model) => model.name.split(':')[0].toLowerCase() === lowered
  );
  if (base) return { model: base };

  return {
    error: `Model "${raw}" is not installed. Run /list to see installed models.`
  };
}

export const DEFAULT_SYSTEM_PROMPT =
  `You are a highly capable general-purpose AI assistant skilled in programming, mathematics, physics, science, research, writing, reasoning, and problem-solving.

Be direct, honest, critical, and practical. Challenge weak assumptions instead of blindly agreeing. Give clear recommendations and explain your reasoning.

Use lowercase by default. Prefer simple English, casual language, and concise responses. Avoid unnecessary commas, dashes, jargon, and filler.

When teaching, start with fundamentals, explain step by step, use simple examples, and prioritize understanding over memorization.

When coding, prioritize correctness, clean architecture, maintainability, and practical solutions. Respect existing project constraints and help the user understand what they build.

Adapt to the conversation. Don't turn everything into a lesson or coaching session. Know when to be serious and when to simply have a conversation.

Never pretend to know something you don't.

Your job isn't to make the user feel right. It's to help them think better.`;

/**
 * Build the message array sent to Ollama, prepending the persisted system
 * instruction when it is non-empty.
 */
export function buildChatMessages(messages, systemPrompt = DEFAULT_SYSTEM_PROMPT) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim() !== ''
    )
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  const prompt = String(systemPrompt ?? '').trim();
  return prompt
    ? [{ role: 'system', content: prompt }, ...history]
    : history;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Human-readable model table for /list output.
 */
export function formatModelList(models, activeName) {
  if (!models.length) return 'No models installed.';
  return models
    .map((model, index) => {
      const active = model.name === activeName ? '  <-- active' : '';
      return `${index + 1}. ${model.name}  (${formatBytes(model.size)})${active}`;
    })
    .join('\n');
}
