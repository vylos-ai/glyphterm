// Live per-core CPU load from os.cpus() (works on Linux, macOS and Windows).
// Load is the share of non-idle time between two samples, per core.

import { cpus } from "node:os";

export const CPU_INTERVAL_MS = 250;
export const CPU_HISTORY = 120; // 30 seconds at 4 samples per second

function snapshot() {
  return cpus().map(({ times }) => {
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { idle: times.idle, total };
  });
}

/**
 * Keeps a rolling history of per-core load (0..1), oldest first.
 * `lastSampleAt` lets the renderer scroll smoothly between samples.
 */
export function createCpuSampler({ interval = CPU_INTERVAL_MS, history = CPU_HISTORY } = {}) {
  let previous = snapshot();
  const series = previous.map(() => []);
  const sampler = { series, interval, history, lastSampleAt: performance.now(), timer: null };

  sampler.sample = () => {
    const current = snapshot();
    current.forEach((core, i) => {
      const total = core.total - previous[i].total;
      const idle = core.idle - previous[i].idle;
      const load = total > 0 ? Math.min(1, Math.max(0, 1 - idle / total)) : 0;
      series[i].push(load);
      if (series[i].length > history) series[i].shift();
    });
    previous = current;
    sampler.lastSampleAt = performance.now();
  };

  sampler.start = () => {
    sampler.timer ??= setInterval(sampler.sample, interval);
    return sampler;
  };

  sampler.stop = () => {
    clearInterval(sampler.timer);
    sampler.timer = null;
  };

  /** Fraction of the way to the next sample (0..1), for smooth scrolling. */
  sampler.progress = () => Math.min(1, (performance.now() - sampler.lastSampleAt) / interval);

  sampler.average = () => {
    const latest = series.map((s) => s.at(-1) ?? 0);
    return latest.reduce((a, b) => a + b, 0) / Math.max(1, latest.length);
  };

  return sampler;
}
