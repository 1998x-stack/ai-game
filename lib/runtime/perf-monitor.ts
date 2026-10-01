// lib/runtime/perf-monitor.ts

export interface PerfMetrics {
  fps: { min: number; max: number; avg: number; stability: number };
  memory: { start: number; end: number; peak: number; leaked: boolean };
  frameTime: { min: number; max: number; avg: number; p99: number };
}

export function injectPerfMonitor(): string {
  return `(function(){
    window.__perfData = { frames: [], startTime: performance.now() };
    let lastFrame = performance.now();
    var origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function(cb) {
      return origRAF.call(window, function(ts) {
        window.__perfData.frames.push({ ts: ts, dt: ts - lastFrame });
        lastFrame = ts;
        cb(ts);
      });
    };
  })()`;
}

export async function extractPerfMetrics(page: any): Promise<PerfMetrics> {
  const data = await page.evaluate(() => (window as any).__perfData);

  if (!data?.frames?.length) {
    return {
      fps: { min:0,max:0,avg:0,stability:0 },
      memory: { start:0,end:0,peak:0,leaked:false },
      frameTime: { min:0,max:0,avg:0,p99:0 },
    };
  }

  const dts: number[] = data.frames
    .map((f: any) => f.dt)
    .filter((d: number) => d > 0 && d < 1000);

  if (dts.length === 0) {
    return {
      fps: { min:0,max:0,avg:0,stability:0 },
      memory: { start:0,end:0,peak:0,leaked:false },
      frameTime: { min:0,max:0,avg:0,p99:0 },
    };
  }

  const fpsValues = dts.map((dt: number) => 1000 / dt);
  const sorted = [...fpsValues].sort((a, b) => a - b);
  const sortedFrameTimes = [...dts].sort((a, b) => a - b);
  const avg = fpsValues.reduce((a: number, b: number) => a + b, 0) / fpsValues.length;

  return {
    fps: {
      min: Math.round(sorted[0]),
      max: Math.round(sorted[sorted.length - 1]),
      avg: Math.round(avg),
      stability: Math.round(100 - (sorted[Math.floor(sorted.length * 0.9)] - sorted[0]) / 60 * 100),
    },
    memory: { start: 0, end: 0, peak: 0, leaked: false },
    frameTime: {
      min: Math.round(Math.min(...dts)),
      max: Math.round(Math.max(...dts)),
      avg: Math.round(dts.reduce((a: number, b: number) => a + b, 0) / dts.length),
      p99: Math.round(sortedFrameTimes[Math.floor(sortedFrameTimes.length * 0.99)] || 0),
    },
  };
}
