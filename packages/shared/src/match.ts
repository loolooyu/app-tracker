/** Similarity helpers for *suggesting* existing applications. These never merge records. */

const COMPANY_SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'the', 'group', 'holdings']);
const TITLE_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'for', 'to', 'in', 'at', '-', '–', '|']);

export function tokens(text: string | null | undefined, stop: Set<string> = TITLE_STOPWORDS): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ')
    .filter((t) => t && !stop.has(t));
}

export function normalizeCompany(name: string | null | undefined): string {
  return tokens(name, COMPANY_SUFFIXES).join(' ');
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function companySimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return 1;
  if (na.startsWith(nb + ' ') || nb.startsWith(na + ' ')) return 0.8;
  return jaccard(na.split(' '), nb.split(' '));
}

export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  return jaccard(tokens(a), tokens(b));
}

export interface SimilarityInput {
  company?: string | null;
  title?: string | null;
  location?: string | null;
}

export interface SimilarityResult {
  score: number;
  reasons: string[];
}

/** Score how plausibly two records describe the same opening. Used only to rank suggestions. */
export function similarityScore(query: SimilarityInput, candidate: SimilarityInput): SimilarityResult {
  const c = companySimilarity(query.company, candidate.company);
  const t = titleSimilarity(query.title, candidate.title);
  const reasons: string[] = [];
  if (c >= 0.99) reasons.push('Same company');
  else if (c >= 0.6) reasons.push('Similar company name');
  if (t >= 0.99) reasons.push('Same title');
  else if (t >= 0.5) reasons.push('Similar title');
  let score = c * 0.5 + t * 0.5;
  if (query.location && candidate.location) {
    const l = jaccard(tokens(query.location), tokens(candidate.location));
    if (l >= 0.5) {
      reasons.push('Same location');
      score += 0.05;
    } else {
      reasons.push('Different location');
      score -= 0.1;
    }
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}
