import { chromium, Browser, Page } from 'playwright';
import crypto from 'crypto';
import { CONFIG } from '@/lib/config';

interface PooledBrowser {
  browser: Browser;
  pages: Map<string, Page>;
  createdAt: number;
  lastUsedAt: number;
  activePages: number;
}

interface Lease {
  entry: PooledBrowser;
  page: Page;
}

class BrowserPool {
  private pool: PooledBrowser[] = [];
  private leases = new Map<string, Lease>();
  private waiters: Array<(value: { browser: Browser; page: Page; id: string }) => void> = [];
  private maxInstances: number;
  private maxPagesPerInstance: number;
  private idleTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: { maxInstances?: number; idleTimeoutMs?: number; maxPagesPerInstance?: number } = {}) {
    this.maxInstances = config.maxInstances ?? CONFIG.gameRuntime.browserPool.maxInstances;
    this.maxPagesPerInstance = config.maxPagesPerInstance ?? CONFIG.gameRuntime.browserPool.maxPagesPerInstance;
    this.idleTimeoutMs = config.idleTimeoutMs ?? CONFIG.gameRuntime.browserPool.idleTimeoutMs;
    this.timer = setInterval(() => this.evictIdle(), CONFIG.gameRuntime.browserPool.cleanupIntervalMs);
  }

  async acquire(): Promise<{ browser: Browser; page: Page; id: string }> {
    const available = await this.tryAcquire();
    if (available) return available;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async tryAcquire(): Promise<{ browser: Browser; page: Page; id: string } | null> {
    let entry = this.pool.find((candidate) => candidate.activePages < this.maxPagesPerInstance);
    if (!entry) {
      if (this.pool.length >= this.maxInstances) return null;
      const browser = await chromium.launch({ headless: true });
      entry = { browser, pages: new Map(), createdAt: Date.now(), lastUsedAt: Date.now(), activePages: 0 };
      this.pool.push(entry);
    }
    const id = `${entry.createdAt}-${crypto.randomUUID()}`;
    const page = await entry.browser.newPage();
    entry.pages.set(id, page);
    entry.activePages++;
    entry.lastUsedAt = Date.now();
    this.leases.set(id, { entry, page });
    return { browser: entry.browser, page, id };
  }

  release(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.leases.delete(id);
    lease.entry.pages.delete(id);
    lease.entry.activePages = Math.max(0, lease.entry.activePages - 1);
    lease.entry.lastUsedAt = Date.now();
    void lease.page.close().catch(() => {});
    void this.drainWaiters();
  }

  private async drainWaiters(): Promise<void> {
    while (this.waiters.length > 0) {
      const available = await this.tryAcquire();
      if (!available) return;
      this.waiters.shift()!(available);
    }
  }

  private evictIdle(): void {
    const now = Date.now();
    const idle = this.pool.filter((entry) => entry.activePages === 0 && now - entry.lastUsedAt > this.idleTimeoutMs);
    for (const entry of idle) {
      void entry.browser.close().catch(() => {});
      this.pool = this.pool.filter((candidate) => candidate !== entry);
    }
    void this.drainWaiters();
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.waiters.splice(0).forEach(() => {});
    await Promise.all(this.pool.map((entry) => entry.browser.close().catch(() => {})));
    this.pool = [];
    this.leases.clear();
  }
}

let globalPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!globalPool) globalPool = new BrowserPool();
  return globalPool;
}

export function resetBrowserPool(): void {
  void globalPool?.shutdown();
  globalPool = null;
}
