/**
 * Content script, injected only when the user invokes Appfolio on a tab (activeTab).
 * Runs in Chrome's isolated world: page scripts can't see or call it.
 *
 * It waits briefly for dynamic content to settle, reads the loaded DOM and the user's
 * current selection, and returns a plain-data extraction. It never clicks anything,
 * never reads form field values, cookies or storage, and makes no network requests.
 */
import { detectPlatform } from '@appfolio/shared/url';
import { ADAPTERS, extractJob, type ExtractedJob } from '@appfolio/shared/extract';

interface CaptureOptions {
  nuworksHosts: string[];
  maxWaitMs?: number;
}

/** Resolve when the DOM has been quiet for `quietMs`, or after `maxMs` at most. */
function waitForQuiet(quietMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const hardStop = setTimeout(done, maxMs);
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    function done() {
      obs.disconnect();
      clearTimeout(timer);
      clearTimeout(hardStop);
      resolve();
    }
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });
}

/** Resolve when `selector` matches an element with text, or after `maxMs`. */
function waitForSelector(selector: string, maxMs: number): Promise<void> {
  const present = () => {
    const el = document.querySelector(selector);
    return !!el && (el.textContent ?? '').trim().length > 0;
  };
  if (present()) return Promise.resolve();
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (present()) done();
    });
    const stop = setTimeout(done, maxMs);
    function done() {
      obs.disconnect();
      clearTimeout(stop);
      resolve();
    }
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function capture(opts: CaptureOptions): Promise<ExtractedJob> {
  if (document.readyState === 'loading') {
    await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
  }
  const maxWait = opts.maxWaitMs ?? 4000;
  const started = Date.now();
  // Client-rendered boards (e.g. Workday) fill in the job after load: wait for it, bounded.
  const ready = ADAPTERS[detectPlatform(location.href, { nuworksHosts: opts.nuworksHosts })].readySelector;
  if (ready) await waitForSelector(ready, maxWait);
  await waitForQuiet(400, Math.max(500, maxWait - (Date.now() - started)));
  const selection = window.getSelection()?.toString() ?? '';
  return extractJob(document, { url: location.href, nuworksHosts: opts.nuworksHosts, selectionText: selection });
}

(globalThis as unknown as { __appfolioCapture: typeof capture }).__appfolioCapture = capture;
