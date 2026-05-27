import { chromium, Browser, Page } from 'playwright';

interface PooledBrowser {
  browser: Browser;
  pages: Map<string, Page>;
  createdAt: number;
  lastUsedAt: number;
  activePages: number;
}

class BrowserPool {
  private pool: PooledBrowser[] = [];
  private maxInstances: number;
  private idleTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: { maxInstances?: number; idleTimeoutMs?: number } = {}) {
    this.maxInstances = config.maxInstances || 3;
    this.idleTimeoutMs = config.idleTimeoutMs || 300_000;
    this.timer = setInterval(() => this.evictIdle(), 60_000);
  }

  async acquire(): Promise<{ browser: Browser; page: Page; id: string }> {
    // Reuse idle instance
    const idle = this.pool.find(p => p.activePages < 5);
    if (idle) {
      const page = await idle.browser.newPage();
      idle.pages.set(String(Date.now()), page);
      idle.activePages++;
      idle.lastUsedAt = Date.now();
      return { browser: idle.browser, page, id: String(idle.createdAt) };
    }

    // Create new if under limit
    if (this.pool.length < this.maxInstances) {
      const browser = await chromium.launch({ headless: true });
      const entry: PooledBrowser = { browser, pages: new Map(), createdAt: Date.now(), lastUsedAt: Date.now(), activePages: 0 };
      this.pool.push(entry);
      const page = await browser.newPage();
      entry.pages.set(String(entry.createdAt), page);
      entry.activePages = 1;
      return { browser, page, id: String(entry.createdAt) };
    }

    // Evict oldest and reuse
    const oldest = this.pool.sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    for (const [, p] of oldest.pages) await p.close().catch(() => {});
    oldest.pages.clear();
    const page = await oldest.browser.newPage();
    oldest.pages.set(String(Date.now()), page);
    oldest.activePages = 1;
    oldest.lastUsedAt = Date.now();
    return { browser: oldest.browser, page, id: String(oldest.createdAt) };
  }

  release(browserId: string): void {
    const entry = this.pool.find(p => String(p.createdAt) === browserId);
    if (entry) {
      entry.activePages = Math.max(0, entry.activePages - 1);
      entry.lastUsedAt = Date.now();
    }
  }

  private evictIdle(): void {
    const now = Date.now();
    this.pool = this.pool.filter(entry => {
      if ((now - entry.lastUsedAt) > this.idleTimeoutMs && entry.activePages === 0) {
        entry.browser.close().catch(() => {});
        return false;
      }
      return true;
    });
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.pool.map(e => e.browser.close().catch(() => {})));
    this.pool = [];
  }
}

// Process-level singleton + HMR safe
let globalPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!globalPool) {
    globalPool = new BrowserPool({ maxInstances: 3, idleTimeoutMs: 300_000 });
  }
  return globalPool;
}

/** For testing: reset the singleton so each test starts fresh */
export function resetBrowserPool(): void {
  globalPool?.shutdown();
  globalPool = null;
}

// HMR safety
if (typeof module !== 'undefined' && (module as any).hot) {
  (module as any).hot.dispose(() => {
    globalPool?.shutdown();
    globalPool = null;
  });
}
