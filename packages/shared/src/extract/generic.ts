import { cleanContainer } from './clean.js';
import { detectSections } from './sections.js';
import { domToText } from './text.js';

const CANDIDATE_SELECTORS = [
  '[itemprop="description"]',
  '[class*="job-description" i]', '[id*="job-description" i]',
  '[class*="jobdescription" i]', '[id*="jobdescription" i]',
  '[class*="job_description" i]', '[id*="job_description" i]',
  '[class*="job-details" i]', '[id*="job-details" i]',
  '[class*="posting" i]', '[class*="description" i]', '[id*="description" i]',
  'article', 'main', '[role="main"]', '#content', '.content',
];

const HEADING_LIKE = 'h1, h2, h3, h4, h5, strong, b, [role="heading"], dt';

export interface ContainerChoice {
  element: Element;
  text: string;
  sectionCount: number;
  linkDensity: number;
}

function linkDensity(el: Element, textLength: number): number {
  if (!textLength) return 1;
  let linkText = 0;
  for (const a of Array.from(el.querySelectorAll('a'))) linkText += (a.textContent ?? '').trim().length;
  return Math.min(1, linkText / textLength);
}

/**
 * Pick the element most likely to hold the full job description: among candidates that
 * contain the most recognizable JD sections, prefer the smallest that isn't link-heavy.
 */
export function chooseJobContainer(doc: Document): ContainerChoice | null {
  const candidates = new Set<Element>();
  for (const sel of CANDIDATE_SELECTORS) {
    try {
      for (const el of Array.from(doc.querySelectorAll(sel)).slice(0, 40)) candidates.add(el);
    } catch {
      // ignore unsupported selector
    }
  }
  // Ancestors of section headings ("Responsibilities", "Qualifications", ...).
  for (const h of Array.from(doc.querySelectorAll(HEADING_LIKE)).slice(0, 400)) {
    const t = (h.textContent ?? '').trim();
    if (!t || t.length > 80) continue;
    if (detectSections(t).size === 0) continue;
    let cur: Element | null = h.parentElement;
    for (let i = 0; i < 6 && cur && cur !== doc.documentElement; i++) {
      candidates.add(cur);
      cur = cur.parentElement;
    }
  }
  if (doc.body) candidates.add(doc.body);

  const scored: ContainerChoice[] = [];
  for (const el of candidates) {
    const rawLen = (el.textContent ?? '').trim().length;
    if (rawLen < 80) continue;
    const cleaned = cleanContainer(el);
    const text = domToText(cleaned);
    if (text.length < 80) continue;
    scored.push({
      element: el,
      text,
      sectionCount: detectSections(text).size,
      linkDensity: linkDensity(cleaned, text.length),
    });
  }
  if (!scored.length) return null;

  const usable = scored.filter((c) => c.linkDensity < 0.5);
  const pool = usable.length ? usable : scored;
  const maxSections = Math.max(...pool.map((c) => c.sectionCount));
  const best = pool.filter((c) => c.sectionCount === maxSections);
  // Prefer the smallest container with the most sections, but not a tiny fragment.
  const longest = Math.max(...best.map((c) => c.text.length));
  const viable = best.filter((c) => c.text.length >= Math.min(400, longest * 0.5));
  viable.sort((a, b) => a.text.length - b.text.length);
  return viable[0] ?? best[0];
}
