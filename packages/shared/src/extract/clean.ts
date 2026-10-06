/**
 * Conservative clutter removal applied to a *clone* of the chosen container.
 * It removes navigation, cookie banners, recommendation rails, share widgets and embedded
 * application forms. It never removes headings or lists by content, so qualifications,
 * compensation and application instructions stay.
 */

const CLUTTER_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'svg', 'iframe',
  'nav', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
  'footer', 'body > header',
  '[aria-hidden="true"]',
  '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]', '[id^="onetrust" i]', '[class*="onetrust" i]',
  '[class*="similar-job" i]', '[class*="similar_job" i]', '[class*="related-job" i]', '[class*="recommended-job" i]',
  '[class*="jobs-recommend" i]', '[data-automation-id="similarJobs"]', '[class*="people-also-viewed" i]',
  '[class*="social-share" i]', '[class*="share-buttons" i]',
  '[id="application_form"]', '[id="application-form"]', '[class*="application-form" i]', '[class*="application--form" i]',
  '[class*="skip-link" i]', '.visually-hidden', '.sr-only',
];

function removeMatches(root: Element, selector: string) {
  let nodes: Element[] = [];
  try {
    nodes = Array.from(root.querySelectorAll(selector));
  } catch {
    return; // selector unsupported by this DOM implementation
  }
  for (const n of nodes) n.remove();
}

function hasFormFields(el: Element): boolean {
  return el.querySelectorAll('input:not([type="hidden"]), textarea, select').length >= 2;
}

export function cleanContainer(container: Element): Element {
  const clone = container.cloneNode(true) as Element;
  for (const sel of CLUTTER_SELECTORS) {
    if (sel === '.visually-hidden' || sel === '.sr-only') continue;
    removeMatches(clone, sel);
  }
  // Screen-reader-only text often duplicates a visible sibling. Drop it only when the same
  // text also appears elsewhere in its parent; otherwise keep it.
  for (const sel of ['.visually-hidden', '.sr-only']) {
    for (const n of Array.from(clone.querySelectorAll(sel))) {
      const t = (n.textContent ?? '').trim();
      const parentText = (n.parentElement?.textContent ?? '').replace(t, '');
      if (t && parentText.includes(t)) n.remove();
    }
  }
  // Embedded application forms (e.g. Greenhouse's form below the JD): drop forms that hold
  // several fields but are a minor part of the container text.
  const total = (clone.textContent ?? '').length || 1;
  for (const form of Array.from(clone.querySelectorAll('form'))) {
    if (hasFormFields(form) && (form.textContent ?? '').length / total < 0.5) form.remove();
  }
  return clone;
}
