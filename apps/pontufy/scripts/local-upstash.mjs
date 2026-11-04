// Stub mínimo do Upstash REST para rodar a suíte localmente sem Upstash.
// Não é um Redis: responde o suficiente para rate limit e lockout liberarem.
// Uso: node tests/helpers/fake-upstash.mjs [porta]
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8079);

/** Estado mínimo: contadores (INCR) e chaves simples. */
const counters = new Map();
const values = new Map();

function handle(command) {
  const [rawName, ...args] = command;
  const name = String(rawName).toUpperCase();

  switch (name) {
    // Rate limit por zset: liberar sempre.
    case 'ZCARD':
      return 0;
    case 'ZADD':
      return 1;
    case 'ZREMRANGEBYSCORE':
      return 0;
    case 'ZRANGE':
    case 'ZRANGEBYSCORE':
      return [];
    case 'EXPIRE':
    case 'PEXPIRE':
      return 1;
    case 'GET':
      return values.get(args[0]) ?? null;
    case 'SET':
      values.set(args[0], args[1]);
      return 'OK';
    case 'DEL':
      values.delete(args[0]);
      counters.delete(args[0]);
      return 1;
    case 'INCR': {
      const next = (counters.get(args[0]) ?? 0) + 1;
      counters.set(args[0], next);
      return next;
    }
    case 'DECR': {
      const next = (counters.get(args[0]) ?? 0) - 1;
      counters.set(args[0], next);
      return next;
    }
    case 'TTL':
      return 60;
    case 'SCAN':
      return [0, []];
    case 'KEYS':
      return [];
    case 'PUBLISH':
      return 0;
    case 'PING':
      return 'PONG';
    default:
      return null;
  }
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');

    // GET /get/:key (API REST do Upstash)
    if (req.method === 'GET' && req.url?.startsWith('/get/')) {
      const key = decodeURIComponent(req.url.slice(5));
      res.end(JSON.stringify({ result: values.get(key) ?? null }));
      return;
    }

    try {
      const parsed = body ? JSON.parse(body) : [];
      // Pipeline: array de comandos
      if (req.url?.includes('/pipeline') || (Array.isArray(parsed) && Array.isArray(parsed[0]))) {
        res.end(JSON.stringify((parsed ?? []).map((cmd) => ({ result: handle(cmd) }))));
        return;
      }
      res.end(JSON.stringify({ result: handle(parsed) }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fake-upstash ouvindo em http://127.0.0.1:${port}`);
});
