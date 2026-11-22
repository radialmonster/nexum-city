import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

let clientDir: string;
beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), 'nexum-client-'));
  mkdirSync(join(clientDir, 'assets'));
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>kit</title>');
  writeFileSync(join(clientDir, 'assets', 'app.js'), 'console.log(1)');
});

describe('server app', () => {
  it('reports health', async () => {
    let t = 1_000;
    const app = createApp({ version: '1.2.3', now: () => t });
    t = 6_500;
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '1.2.3', uptimeS: 5 });
  });

  it('serves index.html for client routes', async () => {
    const app = createApp({ version: 'x', clientDir });
    for (const path of ['/', '/kit', '/some/deep/route']) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<title>kit</title>');
    }
  });

  it('serves static files and 404s missing ones', async () => {
    const app = createApp({ version: 'x', clientDir });
    const ok = await app.request('/assets/app.js');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('javascript');
    expect(ok.headers.get('cache-control')).toContain('immutable');
    expect((await app.request('/assets/missing.js')).status).toBe(404);
    expect((await app.request('/%2e%2e/%2e%2e/secret.txt')).status).toBe(404);
  });

  it('404s unknown api routes instead of falling back to the client', async () => {
    const app = createApp({ version: 'x', clientDir });
    for (const path of ['/api/nope', '/api']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });

  it('logs one JSON-serialisable record per request', async () => {
    const lines: string[] = [];
    const app = createApp({
      version: 'x',
      log: (e) => lines.push(JSON.stringify(e)),
    });
    await app.request('/api/health');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      method: 'GET',
      path: '/api/health',
      status: 200,
    });
  });
});

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({ port: 8080, dataDir: './data', clientDir: undefined });
  });
  it('reads and coerces env', () => {
    expect(loadConfig({ PORT: '9000', DATA_DIR: '/d' })).toMatchObject({
      port: 9000,
      dataDir: '/d',
    });
  });
  it('rejects a bad port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
  });
});
