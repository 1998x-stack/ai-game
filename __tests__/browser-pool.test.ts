import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const launch = vi.hoisted(() => vi.fn());
vi.mock('playwright', () => ({ chromium: { launch } }));
import { BrowserPool } from '@/lib/runtime/browser-pool';

const pools: BrowserPool[] = [];
beforeEach(() => {
  launch.mockReset();
  launch.mockImplementation(async () => ({
    newPage: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
    close: vi.fn(async () => undefined),
  }));
});
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

describe('browser pool capacity and cancellation', () => {
  it('does not launch more instances under concurrent allocation', async () => {
    const pool = new BrowserPool({ maxInstances: 1, maxPagesPerInstance: 1 });
    pools.push(pool);
    const first = await pool.acquire();
    const second = pool.acquire();
    expect(launch).toHaveBeenCalledTimes(1);
    pool.release(first.id);
    const acquired = await second;
    expect(launch).toHaveBeenCalledTimes(1);
    pool.release(acquired.id);
  });

  it('reserves page slots across concurrent newPage calls', async () => {
    const pool = new BrowserPool({ maxInstances: 1, maxPagesPerInstance: 2 });
    pools.push(pool);
    const [one, two] = await Promise.all([pool.acquire(), pool.acquire()]);
    expect(one.id).not.toBe(two.id);
    expect(launch).toHaveBeenCalledTimes(1);
    pool.release(one.id);
    pool.release(two.id);
  });

  it('rejects outstanding waiters when shutting down', async () => {
    const pool = new BrowserPool({ maxInstances: 1, maxPagesPerInstance: 1 });
    pools.push(pool);
    await pool.acquire();
    const waiting = pool.acquire();
    await pool.shutdown();
    await expect(waiting).rejects.toThrow('shut down');
  });
});
