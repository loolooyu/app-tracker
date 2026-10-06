/** schema.org JobPosting structured data. */

export interface JobPostingData {
  title: string | null;
  company: string | null;
  location: string | null;
  identifier: string | null;
  employmentType: string | null;
  descriptionHtml: string | null;
  datePosted: string | null;
}

type Json = unknown;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: Json): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

function isJobPosting(node: Record<string, Json>): boolean {
  return asArray(node['@type'] as string | string[]).some((t) => typeof t === 'string' && t.toLowerCase() === 'jobposting');
}

function collectNodes(value: Json, out: Array<Record<string, Json>>, depth = 0) {
  if (depth > 6 || value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out, depth + 1);
    return;
  }
  const obj = value as Record<string, Json>;
  if (isJobPosting(obj)) out.push(obj);
  if (obj['@graph']) collectNodes(obj['@graph'], out, depth + 1);
  if (obj.mainEntity) collectNodes(obj.mainEntity, out, depth + 1);
  if (obj.itemListElement) collectNodes(obj.itemListElement, out, depth + 1);
  if (obj.item) collectNodes(obj.item, out, depth + 1);
}

function locationOf(node: Record<string, Json>): string | null {
  const parts: string[] = [];
  for (const loc of asArray(node.jobLocation as Json[])) {
    if (!loc || typeof loc !== 'object') continue;
    const address = (loc as Record<string, Json>).address;
    if (typeof address === 'string') {
      parts.push(address);
      continue;
    }
    if (address && typeof address === 'object') {
      const a = address as Record<string, Json>;
      const country = typeof a.addressCountry === 'object' && a.addressCountry ? str((a.addressCountry as Record<string, Json>).name) : str(a.addressCountry);
      const line = [str(a.addressLocality), str(a.addressRegion), country].filter(Boolean).join(', ');
      if (line) parts.push(line);
    }
  }
  const remote = asArray(node.jobLocationType as string[]).some((t) => typeof t === 'string' && /telecommute/i.test(t));
  if (remote) parts.push('Remote');
  const unique = [...new Set(parts)];
  return unique.length ? unique.join('; ') : null;
}

export function parseJobPostings(doc: Document): JobPostingData[] {
  const nodes: Array<Record<string, Json>> = [];
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json" i]'))) {
    const raw = script.textContent;
    if (!raw || raw.length > 2_000_000) continue;
    try {
      collectNodes(JSON.parse(raw), nodes);
    } catch {
      // Malformed structured data is common; ignore it.
    }
  }
  return nodes.map((n) => {
    const org = n.hiringOrganization;
    const company = typeof org === 'string' ? str(org) : org && typeof org === 'object' ? str((org as Record<string, Json>).name) : null;
    const ident = n.identifier;
    const identifier =
      typeof ident === 'object' && ident ? str((ident as Record<string, Json>).value) ?? str((ident as Record<string, Json>).name) : str(ident);
    return {
      title: str(n.title) ?? str(n.name),
      company,
      location: locationOf(n),
      identifier,
      employmentType: asArray(n.employmentType as string[]).filter((x) => typeof x === 'string').join(', ') || null,
      descriptionHtml: str(n.description),
      datePosted: str(n.datePosted),
    };
  });
}
