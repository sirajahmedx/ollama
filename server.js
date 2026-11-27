import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_PORT = Number(process.env.OLLAMA_UI_PORT) || 3131;
const DEFAULT_HOST = process.env.OLLAMA_UI_HOST || '127.0.0.1';
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_PUBLIC_DIR = join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function readJson(req, limitBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function timeSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

function mapModel(model, index) {
  return {
    number: index + 1,
    name: model.name,
    size: model.size ?? 0,
    modifiedAt: model.modified_at ?? null,
    family: model.details?.family ?? null,
    parameterSize: model.details?.parameter_size ?? null,
    quantization: model.details?.quantization_level ?? null
  };
}

export function createAppServer({
  fetchImpl = globalThis.fetch,
  publicDir = DEFAULT_PUBLIC_DIR,
  ollamaUrl = DEFAULT_OLLAMA_URL,
  timeoutMs = 5000
} = {}) {
  const resolvedPublicDir = resolve(publicDir);

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        const health = {
          ok: true,
          server: { online: true },
          ollama: { online: false, version: null, error: null }
        };
        try {
          const response = await fetchImpl(`${ollamaUrl}/api/version`, {
            signal: timeSignal(2500)
          });
          if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
          const data = await response.json();
          health.ollama.online = true;
          health.ollama.version = data.version ?? null;
        } catch (error) {
          health.ollama.error = error.message;
        }
        sendJson(res, 200, health);
        return;
      }

      if (pathname === '/api/models' && req.method === 'GET') {
        try {
          const response = await fetchImpl(`${ollamaUrl}/api/tags`, {
            signal: timeSignal(timeoutMs)
          });
          if (!response.ok) {
            throw new Error(`Ollama returned HTTP ${response.status}`);
          }
          const data = await response.json();
          const models = Array.isArray(data.models)
            ? data.models.map(mapModel)
            : [];
          sendJson(res, 200, { models });
        } catch (error) {
          sendJson(res, 502, {
            error: `Cannot reach Ollama at ${ollamaUrl}. Is "ollama serve" running?`,
            detail: error.message
          });
        }
        return;
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await readJson(req);
        const model = typeof body.model === 'string' ? body.model.trim() : '';
        const messages = Array.isArray(body.messages) ? body.messages : [];

        if (!model || messages.length === 0) {
          sendJson(res, 400, {
            error: 'A model and at least one message are required.'
          });
          return;
        }

        let upstream;
        try {
          upstream = await fetchImpl(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: true }),
            signal: timeSignal(10 * 60 * 1000)
          });
        } catch (error) {
          sendJson(res, 502, {
            error: `Cannot reach Ollama at ${ollamaUrl}.`,
            detail: error.message
          });
          return;
        }

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => '');
          sendJson(res, 502, {
            error: `Ollama chat request failed with HTTP ${upstream.status}.`,
            detail
          });
          return;
        }

        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
          'x-content-type-options': 'nosniff'
        });

        const reader = upstream.body.getReader();
        res.on('close', () => {
          if (!res.writableEnded) {
            reader.cancel().catch(() => {});
          }
        });

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(Buffer.from(value))) {
              await new Promise((resolveDrain) => res.once('drain', resolveDrain));
            }
          }
          res.end();
        } catch (error) {
          if (!res.writableEnded) {
            res.end();
          }
        }
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Unknown API route.' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed.' });
        return;
      }

      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = resolve(resolvedPublicDir, relative);
      if (
        filePath !== resolvedPublicDir &&
        !filePath.startsWith(resolvedPublicDir + sep)
      ) {
        sendJson(res, 403, { error: 'Forbidden.' });
        return;
      }

      let content;
      try {
        content = await readFile(filePath);
      } catch {
        // Single-page app fallback for non-file routes.
        content = await readFile(join(resolvedPublicDir, 'index.html'));
        res.writeHead(200, {
          'content-type': MIME_TYPES['.html'],
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff'
        });
        res.end(req.method === 'HEAD' ? undefined : content);
        return;
      }

      res.writeHead(200, {
        'content-type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'content-length': content.length,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error.statusCode || 500, {
          error: error.statusCode ? error.message : 'Internal server error.',
          detail: error.message
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

export async function startServer({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  ...options
} = {}) {
  const server = createAppServer(options);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    port: actualPort,
    host,
    url: `http://${host}:${actualPort}`
  };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startServer()
    .then(({ url }) => {
      console.log(`Ollama Terminal UI running at ${url}`);
      console.log('Press Ctrl+C to stop the server.');
    })
    .catch((error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${DEFAULT_PORT} is already in use.`);
      } else {
        console.error('Failed to start Ollama Terminal UI:', error.message);
      }
      process.exit(1);
    });
}
