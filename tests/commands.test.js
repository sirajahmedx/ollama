import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInput,
  resolveModel,
  formatModelList,
  buildChatMessages,
  DEFAULT_SYSTEM_PROMPT
} from '../public/commands.js';

test('plain text is treated as a prompt', () => {
  assert.deepEqual(parseInput('explain recursion'), {
    type: 'prompt',
    text: 'explain recursion'
  });
});

test('/list is a list command', () => {
  assert.deepEqual(parseInput('/list'), { type: 'command', name: 'list', args: [] });
});

test('ollama list is a list command', () => {
  assert.deepEqual(parseInput('ollama list'), { type: 'command', name: 'list', args: [] });
});

test('/run 2 selects model number 2', () => {
  assert.deepEqual(parseInput('/run 2'), {
    type: 'command',
    name: 'run',
    target: '2'
  });
});

test('ollama run 2 selects model number 2', () => {
  assert.deepEqual(parseInput('ollama run 2'), {
    type: 'command',
    name: 'run',
    target: '2'
  });
});

test('ollama run supports a full model name', () => {
  assert.deepEqual(parseInput('ollama run qwen2.5:0.5b'), {
    type: 'command',
    name: 'run',
    target: 'qwen2.5:0.5b'
  });
});

test('/run without a target returns a usage error', () => {
  assert.deepEqual(parseInput('/run'), {
    type: 'command',
    name: 'run',
    target: null,
    error: 'Usage: /run <number|model>'
  });
});

test('/clear clears the terminal', () => {
  assert.deepEqual(parseInput('/clear'), { type: 'command', name: 'clear', args: [] });
});

test('/help is a help command', () => {
  assert.deepEqual(parseInput('/help'), { type: 'command', name: 'help', args: [] });
});

test('unknown slash commands are reported', () => {
  const result = parseInput('/banana');
  assert.equal(result.type, 'command');
  assert.equal(result.name, 'unknown');
  assert.match(result.error, /Unknown command/);
});

test('numeric model target resolves to the numbered model', () => {
  const models = [{ name: 'llama3.2:1b' }, { name: 'qwen2.5:0.5b' }];
  assert.deepEqual(resolveModel(models, '2'), { model: models[1] });
});

test('out-of-range model number returns an error', () => {
  const models = [{ name: 'llama3.2:1b' }];
  const result = resolveModel(models, '9');
  assert.match(result.error, /No model #9/);
});

test('model name resolves exactly, case-insensitively, or by base name', () => {
  const models = [{ name: 'llama3.2:1b' }, { name: 'qwen2.5:0.5b' }];
  assert.deepEqual(resolveModel(models, 'LLAMA3.2:1B'), { model: models[0] });
  assert.deepEqual(resolveModel(models, 'qwen2.5'), { model: models[1] });
});

test('unknown model name returns an error', () => {
  const result = resolveModel([{ name: 'llama3.2:1b' }], 'mistral');
  assert.match(result.error, /not installed/);
});

test('DEFAULT_SYSTEM_PROMPT is the general-purpose assistant instruction', () => {
  assert.match(DEFAULT_SYSTEM_PROMPT, /highly capable general-purpose AI assistant/i);
  assert.match(DEFAULT_SYSTEM_PROMPT, /Be direct, honest, critical, and practical/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /Use lowercase by default/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /help them think better/);
});

test('buildChatMessages prepends the system prompt without mutating history', () => {
  const messages = [{ role: 'user', content: 'Explain SHM' }];
  const result = buildChatMessages(messages, 'Tutor mode');

  assert.deepEqual(result, [
    { role: 'system', content: 'Tutor mode' },
    { role: 'user', content: 'Explain SHM' }
  ]);
  assert.deepEqual(messages, [{ role: 'user', content: 'Explain SHM' }]);
});

test('buildChatMessages uses the default tutor prompt when none is provided', () => {
  const result = buildChatMessages([{ role: 'user', content: 'hi' }]);

  assert.equal(result[0].role, 'system');
  assert.equal(result[0].content, DEFAULT_SYSTEM_PROMPT);
  assert.equal(result[1].content, 'hi');
});

test('buildChatMessages omits a blank prompt and filters invalid history entries', () => {
  const result = buildChatMessages(
    [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'not part of chat history' },
      { role: 'assistant', content: '   ' },
      null,
      { role: 'assistant', content: 'hello' }
    ],
    '   '
  );

  assert.deepEqual(result, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' }
  ]);
});

test('formatModelList numbers models and marks the active one', () => {
  const models = [
    { name: 'llama3.2:1b', size: 1321098329 },
    { name: 'qwen2.5:0.5b', size: 397821319 }
  ];
  const lines = formatModelList(models, 'llama3.2:1b');
  assert.match(lines, /^1\. llama3\.2:1b/m);
  assert.match(lines, /^2\. qwen2\.5:0\.5b/m);
  assert.match(lines, /active/);
  assert.match(lines, /1\.2 GB/);
});
