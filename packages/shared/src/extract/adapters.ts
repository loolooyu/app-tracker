import type { Platform } from '../constants.js';
import { cleanContainer } from './clean.js';
import { domToText } from './text.js';

/**
 * Support levels, stated honestly:
 * - verified: checked against a real page in a real browser (date recorded in docs/PLATFORM_SUPPORT.md)
 * - fixture: selectors exercised only against synthetic fixtures modeled on public markup
 * - generic: no platform-specific selectors; generic extraction plus review
 * - manual: expect to paste or select the text
 */
export type SupportLevel = 'verified' | 'fixture' | 'generic' | 'manual';

export interface AdapterResult {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  jobId?: string | null;
  container?: Element | null;
}

export interface PlatformAdapter {
  id: string;
  platform: Platform;
  label: string;
  supportLevel: SupportLevel;
  /** Present once the job content has rendered (client-rendered boards). Capture waits for it, bounded. */
  readySelector?: string;
  /** Returns null when none of the adapter's selectors matched. */
  extract(doc: Document): AdapterResult | null;
}

function first(doc: ParentNode, selectors: string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = doc.querySelector(sel);
      if (el && (el.textContent ?? '').trim()) return el;
    } catch {
      // unsupported selector
    }
  }
  return null;
}

function textOf(el: Element | null): string | null {
  if (!el) return null;
  const t = domToText(cleanContainer(el)).replace(/\s+/g, ' ').trim();
  return t || null;
}

const greenhouse: PlatformAdapter = {
  id: 'greenhouse',
  platform: 'greenhouse',
  label: 'Greenhouse job board',
  supportLevel: 'verified',
  readySelector: '.job__description, #content',
  extract(doc) {
    const container = first(doc, ['.job__description', '#content .job-post-content', '#content', '[class*="job-post" i]']);
    if (!container) return null;
    const title = textOf(first(doc, ['.job__title h1', 'h1.app-title', '.app-title', 'h1.section-header', 'h1']));
    let company = textOf(first(doc, ['.company-name', '.job__title .company', '[class*="company-name" i]']));
    if (company) company = company.replace(/^at\s+/i, '').trim();
    const location = textOf(first(doc, ['.job__location', '.location', '[class*="location" i]']));
    return { title, company, location, container };
  },
};

const workday: PlatformAdapter = {
  id: 'workday',
  platform: 'workday',
  label: 'Workday careers site',
  supportLevel: 'verified',
  readySelector: '[data-automation-id="jobPostingDescription"]',
  extract(doc) {
    const container = first(doc, ['[data-automation-id="jobPostingDescription"]']);
    if (!container) return null;
    const title = textOf(first(doc, ['[data-automation-id="jobPostingHeader"]', 'h2[data-automation-id]', 'h1']));
    const locEl = first(doc, ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]']);
    const location = textOf(locEl)?.replace(/^locations?\s*/i, '') ?? null;
    const reqEl = first(doc, ['[data-automation-id="requisitionId"] dd', '[data-automation-id="requisitionId"]']);
    const jobId = textOf(reqEl)?.replace(/^job requisition id\s*/i, '') ?? null;
    return { title, location, jobId, container };
  },
};

const linkedin: PlatformAdapter = {
  id: 'linkedin',
  platform: 'linkedin',
  label: 'LinkedIn job view',
  supportLevel: 'fixture',
  readySelector: '.jobs-description__content, #job-details, .show-more-less-html__markup, .description__text',
  extract(doc) {
    const container = first(doc, [
      '.jobs-description__content',
      '.jobs-description-content__text',
      '#job-details',
      '.show-more-less-html__markup',
      '.description__text',
    ]);
    if (!container) return null;
    const title = textOf(
      first(doc, [
        '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title',
        '.top-card-layout__title',
        '.topcard__title',
      ]),
    );
    const company = textOf(
      first(doc, [
        '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name',
        '.topcard__org-name-link',
        '.top-card-layout__second-subline a',
      ]),
    );
    const location = textOf(
      first(doc, [
        '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
        '.jobs-unified-top-card__bullet',
        '.topcard__flavor--bullet',
      ]),
    );
    return { title, company, location, container };
  },
};

/** Platforms with no tested selectors: generic extraction is used, with review. */
const genericOnly = (platform: Platform, label: string): PlatformAdapter => ({
  id: platform,
  platform,
  label,
  supportLevel: 'generic',
  extract: () => null,
});

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  greenhouse,
  workday,
  linkedin,
  handshake: genericOnly('handshake', 'Handshake'),
  // NUworks' authenticated markup is unknown to us; never fabricate selectors for it.
  nuworks: genericOnly('nuworks', 'NUworks'),
  company: genericOnly('company', 'Company career site'),
  other: genericOnly('other', 'Other site'),
};

export const SUPPORT_LEVEL_LABELS: Record<SupportLevel, string> = {
  verified: 'Verified on a real page',
  fixture: 'Fixture-tested selectors (not verified live)',
  generic: 'Generic extraction — review carefully',
  manual: 'Manual paste',
};
