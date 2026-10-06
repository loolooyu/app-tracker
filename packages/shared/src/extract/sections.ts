/** Heuristic detection of the sections a complete job description usually has. */

export const SECTION_PATTERNS = {
  responsibilities:
    /\b(responsibilit|what you['’]?ll do|what you will do|what you['’]?ll be doing|the role\b|role overview|your impact|duties|day[- ]to[- ]day|job description|about the (job|role|position|opportunity)|position summary|job summary)/i,
  qualifications:
    /\b(qualification|requirements?\b|what you['’]?ll need|what you need|who you are|what we['’]?re looking for|skills|you have|must[- ]have|nice[- ]to[- ]have|preferred|minimum|basic qualifications|eligibility)/i,
  compensation: /\b(compensation|salary|pay range|pay rate|hourly rate|per hour|\/hr\b|benefits|stipend)|\$\s?\d/i,
  instructions: /\b(how to apply|application instructions|to apply|apply (via|through|at|on|directly)|submit (your|a) (resume|application)|please apply)/i,
} as const;

export type SectionName = keyof typeof SECTION_PATTERNS;

export function detectSections(text: string): Set<SectionName> {
  const found = new Set<SectionName>();
  for (const [name, re] of Object.entries(SECTION_PATTERNS) as Array<[SectionName, RegExp]>) {
    if (re.test(text)) found.add(name);
  }
  return found;
}
