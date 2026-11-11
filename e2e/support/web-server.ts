import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { FRONTEND } from './paths';
import { listenInRange } from './ports';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
  '.gz': 'application/gzip',
};

/** The Content-Security-Policy of the production Nginx, so a violation fails here as it would there. */
const CSP = /set \$glazelab_csp "([^"]+)"/.exec(readFileSync(join(FRONTEND, 'nginx.conf.template'), 'utf8'))?.[1];
if (!CSP) throw new Error('nginx.conf.template has no $glazelab_csp');

export interface WebServer {
  url: string;
  /** Appended to `sw.js`, so the browser finds a new service worker on its next update check. */
  setServiceWorkerSuffix(suffix: string): void;
  close(): Promise<void>;
}

/** Serves the built frontend like the production Nginx and proxies `/api` to the API. */
export async function startWebServer(options: {
  dist: string;
  apiUrl: string;
  /** Called with the path of every `/api` request that reaches this server (so a browser cache hit never calls it). */
  onApiRequest?: (path: string) => void;
  /** An `/api` request whose path this accepts is never answered (a dead connection that does not fail: a black hole, a captive portal). */
  stall?: (path: string) => boolean;
}): Promise<WebServer> {
  const root = resolve(options.dist) + sep;
  const api = new URL(options.apiUrl);
  let swSuffix = '';

  const proxy = (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const upstream = request(
      { host: api.hostname, port: api.port, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: api.host } },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.headersSent || outgoing.writeHead(502).end());
    incoming.pipe(upstream);
  };

  const serveFile = async (path: string, outgoing: ServerResponse) => {
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (!file.startsWith(root)) return void outgoing.writeHead(404).end();
    try {
      let body = await readFile(file);
      if (path === '/sw.js' && swSuffix) body = Buffer.concat([body, Buffer.from(`\n// ${swSuffix}\n`)]);
      outgoing.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
      });
      outgoing.end(body);
    } catch {
      // Like the production Nginx: an unknown extensionless path gets the app shell, a file-like one a 404.
      if (!extname(path) && !path.startsWith('/assets/')) return serveFile('/', outgoing);
      outgoing.writeHead(404).end();
    }
  };

  const server = createServer((incoming, outgoing) => {
    const path = new URL(incoming.url ?? '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      options.onApiRequest?.(path);
      if (!options.stall?.(path)) proxy(incoming, outgoing);
    } else void serveFile(path, outgoing);
  });
  const port = await listenInRange(server);
  return {
    url: `http://127.0.0.1:${port}`,
    setServiceWorkerSuffix: (suffix) => (swSuffix = suffix),
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
