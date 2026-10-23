import { chromium, type Browser, type Page } from 'playwright';
import crypto from 'crypto';
import { CONFIG } from '@/lib/config';

interface PooledBrowser {
  browser: Browser;
  pages: Map<string, Page>;
  createdAt: number;
  lastUsedAt: number;
  activePages: number;
}
type Acquired = { browser: Browser; page: Page; id: string };
interface Waiter {
  resolve: (value: Acquired) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserPool {
  private pool: PooledBrowser[] = [];
  private leases = new Map<string, { entry: PooledBrowser; page: Page }>();
  private waiters: Waiter[] = [];
  private launching = 0;
  private draining = false;
  private closed = false;
  private readonly maxInstances: number;
  private readonly maxPagesPerInstance: number;
  private readonly idleTimeoutMs: number;
  private readonly acquireTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null;

  constructor(config: {
    maxInstances?: number;
    idleTimeoutMs?: number;
    maxPagesPerInstance?: number;
    acquireTimeoutMs?: number;
  } = {}) {
    this.maxInstances = Math.max(1, config.maxInstances ?? CONFIG.gameRuntime.browserPool.maxInstances);
    this.maxPagesPerInstance = Math.max(1, config.maxPagesPerInstance ?? CONFIG.gameRuntime.browserPool.maxPagesPerInstance);
    this.idleTimeoutMs = config.idleTimeoutMs ?? CONFIG.gameRuntime.browserPool.idleTimeoutMs;
    this.acquireTimeoutMs = config.acquireTimeoutMs ?? CONFIG.agent.toolTimeoutMs;
    this.timer = setInterval(() => this.evictIdle(), CONFIG.gameRuntime.browserPool.cleanupIntervalMs);
    this.timer.unref?.();
  }

  async acquire(): Promise<Acquired> {
    if (this.closed) throw new Error('Browser pool is shut down');
    const available = await this.tryAcquire();
    if (available) {
      // Another caller may have queued while this browser was launching.
      if (this.waiters.length > 0) void this.drainWaiters();
      return available;
    }
    if (this.closed) throw new Error('Browser pool is shut down');
    return new Promise<Acquired>((resolve, reject) => {
      const waiter = { resolve, reject, timer: undefined as unknown as ReturnType<typeof setTimeout> };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error('Timed out waiting for an available browser page'));
      }, this.acquireTimeoutMs);
      waiter.timer.unref?.();
      this.waiters.push(waiter);
      void this.drainWaiters();
    });
  }

  private async tryAcquire(): Promise<Acquired | null> {
    if (this.closed) return null;
    let entry = this.pool.find((item) => item.activePages < this.maxPagesPerInstance);
    if (!entry) {
      // Reserve the browser slot before the asynchronous launch to prevent
      // concurrent callers from exceeding maxInstances.
      if (this.pool.length + this.launching >= this.maxInstances) return null;
      this.launching++;
      try {
        const browser = await chromium.launch({ headless: true });
        if (this.closed) {
          await browser.close().catch(() => {});
          throw new Error('Browser pool is shut down');
        }
        entry = {
          browser, pages: new Map(), createdAt: Date.now(),
          lastUsedAt: Date.now(), activePages: 0,
        };
        this.pool.push(entry);
      } finally {
        this.launching--;
      }
    }

    // Reserve the page slot before newPage() yields: two concurrent callers
    // must not both claim the last slot in one browser.
    entry.activePages++;
    try {
      const page = await entry.browser.newPage();
      if (this.closed) {
        await page.close().catch(() => {});
        throw new Error('Browser pool is shut down');
      }
      const id = crypto.randomUUID();
      entry.pages.set(id, page);
      entry.lastUsedAt = Date.now();
      this.leases.set(id, { entry, page });
      return { browser: entry.browser, page, id };
    } catch (error) {
      entry.activePages--;
      throw error;
    }
  }

  release(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.leases.delete(id);
    lease.entry.pages.delete(id);
    lease.entry.activePages--;
    lease.entry.lastUsedAt = Date.now();
    void lease.page.close().catch(() => {});
    void this.drainWaiters();
  }

  private async drainWaiters(): Promise<void> {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      while (this.waiters.length && !this.closed) {
        let available: Acquired | null;
        try {
          available = await this.tryAcquire();
        } catch (error) {
          const waiter = this.waiters.shift();
          if (waiter) {
            clearTimeout(waiter.timer);
            waiter.reject(error instanceof Error ? error : new Error(String(error)));
          }
          continue;
        }
        if (!available) break;
        const waiter = this.waiters.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(available);
        } else {
          this.release(available.id);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private evictIdle(): void {
    const now = Date.now();
    const stale = this.pool.filter(
      (entry) => entry.activePages === 0 && now - entry.lastUsedAt > this.idleTimeoutMs,
    );
    this.pool = this.pool.filter((entry) => !stale.includes(entry));
    for (const entry of stale) void entry.browser.close().catch(() => {});
    void this.drainWaiters();
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Browser pool is shut down'));
    }
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
