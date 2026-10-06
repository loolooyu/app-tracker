import { JD_LIMITS, type CaptureMethod, type Platform } from '../constants.js';
import { detectPlatform, jobIdFromUrl } from '../url.js';
import { ADAPTERS, type SupportLevel } from './adapters.js';
import { chooseJobContainer } from './generic.js';
import { parseJobPostings, type JobPostingData } from './jsonld.js';
import { detectSections } from './sections.js';
import { cleanContainer } from './clean.js';
import { domToText, normalizePlainText } from './text.js';

export { domToText, normalizePlainText } from './text.js';
export { ADAPTERS, SUPPORT_LEVEL_LABELS, type SupportLevel, type PlatformAdapter } from './adapters.js';
export { detectSections } from './sections.js';
export { parseJobPostings } from './jsonld.js';
export { chooseJobContainer } from './generic.js';

export interface ExtractOptions {
  url: string;
  nuworksHosts?: string[];
  /** Text the user had selected when invoking capture, if any. */
  selectionText?: string | null;
}

export interface ExtractAlternative {
  method: CaptureMethod;
  label: string;
  text: string;
  /** For one of several JobPosting candidates: its own metadata, applied together with the text. */
  meta?: { title: string | null; company: string | null; location: string | null; jobId: string | null };
}

export interface ExtractedJob {
  url: string;
  platform: Platform;
  adapter: { id: string; label: string; supportLevel: SupportLevel; matched: boolean };
  company: string | null;
  title: string | null;
  location: string | null;
  jobId: string | null;
  employmentType: string | null;
  pageTitle: string | null;
  text: string;
  method: CaptureMethod;
  warnings: string[];
  /** Other extraction results the reviewer can switch to (structured data, generic, selection). */
  alternatives: ExtractAlternative[];
  /** When several JobPosting entries exist, their titles so the user can choose. */
  postings: Array<{ title: string | null; company: string | null; location: string | null }>;
}

function htmlFragmentToText(doc: Document, html: string): string {
  const inert = doc.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  let text = domToText(inert.body);
  // Some sites entity-encode the HTML inside JSON-LD; decode one more level if so.
  if (/<\s*(p|li|ul|br|div|h\d|strong)\b/i.test(text)) {
    inert.body.innerHTML = text;
    text = domToText(inert.body);
  }
  return normalizePlainText(text);
}

function meta(doc: Document, name: string): string | null {
  const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
  const v = el?.getAttribute('content')?.trim();
  return v || null;
}

function headingTitle(doc: Document): string | null {
  const h1 = doc.querySelector('h1');
  // Some boards wrap the visible title in aria-hidden (with a screen-reader twin elsewhere);
  // fall back to the raw text rather than losing the title.
  const t = h1 ? (domToText(cleanContainer(h1)) || (h1.textContent ?? '')).replace(/\s+/g, ' ').trim() : '';
  return t && t.length <= 200 ? t : null;
}

/** "Software Engineer Co-op at Acme | Careers" → { title, company } best effort. */
function splitDocumentTitle(title: string | null): { title: string | null; company: string | null } {
  if (!title) return { title: null, company: null };
  const cleaned = title.replace(/\s*[|–—-]\s*(careers?|jobs?|job board|linkedin|handshake|workday)\s*$/i, '').trim();
  const at = /^(.+?)\s+at\s+(.+?)(\s*[|–—-].*)?$/i.exec(cleaned);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  // "Title | Company" (common on job boards). Only "|" is used: dashes appear inside titles.
  const parts = cleaned.split(/\s+\|\s+/);
  if (parts.length === 2 && parts[0] && parts[1]) return { title: parts[0].trim(), company: parts[1].trim() };
  return { title: cleaned || null, company: null };
}

function hasLoadingIndicators(doc: Document, text: string): boolean {
  if (/^(loading|please wait)\b/i.test(text.trim())) return true;
  try {
    if (doc.querySelector('[aria-busy="true"]')) return true;
    const spinners = doc.querySelectorAll('[class*="skeleton" i], [class*="spinner" i], [class*="loading" i], [role="progressbar"]');
    return spinners.length > 0 && text.length < JD_LIMITS.shortChars * 2;
  } catch {
    return false;
  }
}

function hasCollapsedContent(container: Element | null, doc: Document): boolean {
  // Look a few levels up: "See more" controls usually sit just outside the text container.
  let scope: ParentNode = doc;
  if (container) {
    let up: Element = container;
    for (let i = 0; i < 3 && up.parentElement && up.parentElement !== doc.body; i++) up = up.parentElement;
    scope = up;
  }
  for (const el of Array.from(scope.querySelectorAll('button, a, [role="button"]')).slice(0, 300)) {
    const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.trim();
    if (/^(…|\.\.\.)?\s*(see|show|read|view) (more|full|the full|all)\b/i.test(label)) {
      if (el.getAttribute('aria-expanded') === 'true') continue;
      return true;
    }
  }
  return false;
}

export interface WarningContext {
  method: CaptureMethod;
  loading?: boolean;
  collapsed?: boolean;
  multiplePostings?: number;
  adapterFallback?: string | null;
}

/** Heuristic review warnings. They inform; they never block a legitimate short posting. */
export function computeCaptureWarnings(text: string, ctx: WarningContext): string[] {
  const w: string[] = [];
  const len = text.trim().length;
  if (len === 0) {
    w.push('No job description text was captured. Select the description on the page and recapture, or paste it.');
    if (ctx.loading) w.push('The page may still have been loading. If the text looks incomplete, wait and recapture.');
    return w;
  }
  if (len < JD_LIMITS.shortChars) {
    w.push(`Only ${len} characters were captured. If the posting is longer, expand it on the page and recapture, or paste the full text.`);
  }
  if (len > JD_LIMITS.maxChars) {
    w.push(`The text is ${len.toLocaleString()} characters, above the ${JD_LIMITS.maxChars.toLocaleString()} limit. Remove unrelated content before saving; nothing was cut automatically.`);
  } else if (len > JD_LIMITS.longWarningChars) {
    w.push(`The text is unusually long (${len.toLocaleString()} characters) and may include unrelated page content. Review it before saving.`);
  }
  const sections = detectSections(text);
  if (ctx.method !== 'manual_paste' && !sections.has('responsibilities') && !sections.has('qualifications')) {
    w.push('No responsibilities or qualifications section was detected. Check that this is the full job description.');
  }
  if (ctx.loading) w.push('The page may still have been loading. If the text looks incomplete, wait and recapture.');
  if (ctx.collapsed) w.push('The page has a “See more” control. If the text below stops early, expand it on the page and recapture so the full description is saved.');
  if (ctx.multiplePostings && ctx.multiplePostings > 1) {
    w.push(`This page lists ${ctx.multiplePostings} job postings. Make sure the captured text is for the job you want.`);
  }
  if (ctx.adapterFallback) w.push(ctx.adapterFallback);
  if (ctx.method === 'selected_text') w.push('Captured from your text selection only.');
  return w;
}

export function extractJob(doc: Document, opts: ExtractOptions): ExtractedJob {
  const platform = detectPlatform(opts.url, { nuworksHosts: opts.nuworksHosts });
  const adapter = ADAPTERS[platform];
  const alternatives: ExtractAlternative[] = [];

  let adapterResult = null as ReturnType<typeof adapter.extract>;
  try {
    adapterResult = adapter.extract(doc);
  } catch {
    adapterResult = null;
  }
  const adapterText = adapterResult?.container ? normalizePlainText(domToText(cleanContainer(adapterResult.container))) : '';

  const postings = parseJobPostings(doc);
  const posting: JobPostingData | undefined = postings.find((p) => p.descriptionHtml) ?? postings[0];
  const structuredText = posting?.descriptionHtml ? htmlFragmentToText(doc, posting.descriptionHtml) : '';

  const generic = chooseJobContainer(doc);
  const genericText = generic ? normalizePlainText(generic.text) : '';

  const selection = opts.selectionText ? normalizePlainText(opts.selectionText) : '';

  let method: CaptureMethod;
  let text: string;
  let container: Element | null = null;
  let adapterFallback: string | null = null;

  if (adapterText.length >= 200) {
    method = 'adapter';
    text = adapterText;
    container = adapterResult?.container ?? null;
  } else if (
    structuredText.length >= 150 &&
    structuredText.length >= genericText.length * 0.5 &&
    detectSections(structuredText).size >= detectSections(genericText).size
  ) {
    method = 'structured_data';
    text = structuredText;
  } else if (genericText) {
    method = 'generic_dom';
    text = genericText;
    container = generic?.element ?? null;
  } else if (structuredText) {
    method = 'structured_data';
    text = structuredText;
  } else {
    method = 'generic_dom';
    text = '';
  }
  if ((adapter.supportLevel === 'fixture' || adapter.supportLevel === 'verified') && method !== 'adapter') {
    adapterFallback = `The ${adapter.label} selectors did not match this page, so ${method === 'structured_data' ? 'the page’s structured data' : 'generic extraction'} was used. If the page was still loading, wait and recapture.`;
  }
  if (text.length < 100 && selection.length >= 40) {
    method = 'selected_text';
    text = selection;
  }

  if (adapterText && method !== 'adapter') alternatives.push({ method: 'adapter', label: adapter.label, text: adapterText });
  if (structuredText && method !== 'structured_data') alternatives.push({ method: 'structured_data', label: 'Structured data (JobPosting)', text: structuredText });
  if (genericText && method !== 'generic_dom' && genericText !== text) alternatives.push({ method: 'generic_dom', label: 'Page content (generic)', text: genericText });
  if (selection && method !== 'selected_text') alternatives.push({ method: 'selected_text', label: 'Your selected text', text: selection });
  // Several JobPosting entries: offer each as a candidate the reviewer can pick.
  if (postings.length > 1) {
    for (const p of postings.slice(0, 10)) {
      if (!p.descriptionHtml) continue;
      alternatives.push({
        method: 'structured_data',
        label: `Posting: ${p.title ?? 'Untitled'}`,
        text: htmlFragmentToText(doc, p.descriptionHtml),
        meta: { title: p.title, company: p.company, location: p.location, jobId: p.identifier },
      });
    }
  }

  const docTitle = doc.title?.trim() || null;
  const split = splitDocumentTitle(meta(doc, 'og:title') ?? docTitle);
  const splitDoc = splitDocumentTitle(docTitle);
  const title = adapterResult?.title ?? posting?.title ?? headingTitle(doc) ?? split.title;
  let company = adapterResult?.company ?? posting?.company ?? split.company ?? splitDoc.company ?? meta(doc, 'og:site_name');
  // Workday's structured data often prefixes a legal-entity code ("100 Salesforce, Inc.").
  if (platform === 'workday' && company) company = company.replace(/^[A-Z]{0,3}\d{1,4}\s+(?=\S)/, '');
  const location = adapterResult?.location ?? posting?.location ?? null;
  const jobId = adapterResult?.jobId ?? (postings.length === 1 ? posting?.identifier : null) ?? jobIdFromUrl(opts.url, platform);

  const warnings = computeCaptureWarnings(text, {
    method,
    loading: hasLoadingIndicators(doc, text),
    collapsed: hasCollapsedContent(container, doc),
    multiplePostings: postings.length,
    adapterFallback,
  });
  if (method === 'adapter' && structuredText.length > adapterText.length * 1.5) {
    warnings.push('The page’s structured data has a longer description than the visible text. Compare the alternatives before saving.');
  }

  return {
    url: opts.url,
    platform,
    adapter: { id: adapter.id, label: adapter.label, supportLevel: adapter.supportLevel, matched: method === 'adapter' },
    company: company ? company.slice(0, 200) : null,
    title: title ? title.slice(0, 300) : null,
    location: location ? location.slice(0, 200) : null,
    jobId: jobId ? jobId.slice(0, 200) : null,
    employmentType: posting?.employmentType ?? null,
    pageTitle: docTitle ? docTitle.slice(0, 500) : null,
    text,
    method,
    warnings,
    alternatives,
    postings: postings.length > 1 ? postings.map((p) => ({ title: p.title, company: p.company, location: p.location })) : [],
  };
}
