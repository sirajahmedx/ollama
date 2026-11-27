import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server.js';

async function withServer(options, fn) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('GET /api/models returns installed models with numeric shortcuts', async () => {
  const fakeFetch = async (url) => {
    assert.equal(url, 'http://ollama.test/api/tags');
    return jsonResponse({
      models: [
        {
          name: 'llama3.2:1b',
          size: 1321098329,
          modified_at: '2026-01-01T00:00:00Z',
          details: { family: 'llama', parameter_size: '1.2B', quantization_level: 'Q4_K_M' }
        },
        {
          name: 'qwen2.5:0.5b',
          size: 397821319,
          modified_at: '2026-01-02T00:00:00Z',
          details: { family: 'qwen2', parameter_size: '0.5B', quantization_level: 'Q4_K_M' }
        }
      ]
    });
  };

  await withServer({ fetchImpl: fakeFetch, ollamaUrl: 'http://ollama.test' }, async (base) => {
    const response = await fetch(`${base}/api/models`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.models.length, 2);
    assert.deepEqual(body.models[0], {
      number: 1,
      name: 'llama3.2:1b',
      size: 1321098329,
      modifiedAt: '2026-01-01T00:00:00Z',
      family: 'llama',
      parameterSize: '1.2B',
      quantization: 'Q4_K_M'
    });
    assert.equal(body.models[1].number, 2);
  });
});

test('GET /api/models returns a clear 502 when Ollama is unreachable', async () => {
  const fakeFetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  await withServer({ fetchImpl: fakeFetch, ollamaUrl: 'http://ollama.test' }, async (base) => {
    const response = await fetch(`${base}/api/models`);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /Cannot reach Ollama/);
    assert.match(body.detail, /ECONNREFUSED/);
  });
});

test('GET /api/health reports Ollama online status without failing', async () => {
  const fakeFetch = async () => jsonResponse({ version: '0.11.3' });

  await withServer({ fetchImpl: fakeFetch, ollamaUrl: 'http://ollama.test' }, async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.ollama.online, true);
    assert.equal(body.ollama.version, '0.11.3');
  });
});

test('GET /api/health reports offline Ollama with HTTP 200', async () => {
  const fakeFetch = async () => {
    throw new Error('offline');
  };

  await withServer({ fetchImpl: fakeFetch, ollamaUrl: 'http://ollama.test' }, async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.ollama.online, false);
    assert.match(body.ollama.error, /offline/);
  });
});

test('POST /api/chat proxies messages and streams NDJSON', async () => {
  let received;
  const fakeFetch = async (url, options) => {
    received = { url, body: JSON.parse(options.body) };
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"Hello"},"done":false}\n'));
        controller.enqueue(encoder.encode('{"message":{"content":" world"},"done":true}\n'));
        controller.close();
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' }
    });
  };

  await withServer({ fetchImpl: fakeFetch, ollamaUrl: 'http://ollama.test' }, async (base) => {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',
        messages: [{ role: 'user', content: 'hi' }]
      })
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const text = await response.text();
    assert.match(text, /"content":"Hello"/);
    assert.match(text, /"content":" world"/);
    assert.deepEqual(received, {
      url: 'http://ollama.test/api/chat',
      body: {
        model: 'llama3.2:1b',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true
      }
    });
  });
});

test('POST /api/chat rejects missing model or messages', async () => {
  await withServer({ fetchImpl: async () => jsonResponse({}), ollamaUrl: 'http://ollama.test' }, async (base) => {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /model/);
  });
});

test('static file server serves files from the public directory only', async () => {
  const publicDir = await mkdtemp(join(tmpdir(), 'ollama-ui-'));
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>test</title>');

  await withServer({ fetchImpl: async () => jsonResponse({}), publicDir }, async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>test<\/title>/);
  });
});
