/**
 * Convert a DOM subtree into readable plain text, keeping headings, list bullets,
 * paragraph breaks, and table rows. Works on any DOM implementation (browser or jsdom)
 * because it relies only on tag names, not layout.
 *
 * Form controls are never read, so application form answers can't leak into a capture.
 */

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'SOURCE', 'META', 'LINK', 'HEAD',
]);

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'HGROUP', 'MAIN', 'NAV', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'THEAD',
  'TFOOT', 'CAPTION', 'CENTER',
]);

const PARAGRAPH_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'DL']);

class TextBuilder {
  private out = '';
  private pendingBreaks = 0;
  private pendingSpace = false;

  breakLines(n: number) {
    if (this.out.length === 0) return;
    this.pendingBreaks = Math.max(this.pendingBreaks, n);
    this.pendingSpace = false;
  }

  text(raw: string, preformatted: boolean) {
    if (preformatted) {
      this.flush();
      this.out += raw;
      return;
    }
    const collapsed = raw.replace(/[\s ]+/g, ' ');
    if (!collapsed) return;
    const leadingSpace = collapsed.startsWith(' ');
    const trailingSpace = collapsed.endsWith(' ');
    const core = collapsed.trim();
    if (!core) {
      if (this.out.length && this.pendingBreaks === 0) this.pendingSpace = true;
      return;
    }
    if (leadingSpace && this.out.length && this.pendingBreaks === 0) this.pendingSpace = true;
    this.flush();
    this.out += core;
    this.pendingSpace = trailingSpace;
  }

  /** Raw prefix such as a bullet; placed after any pending breaks. */
  prefix(s: string) {
    this.flush();
    this.out += s;
    this.pendingSpace = false;
  }

  private flush() {
    if (this.pendingBreaks > 0) {
      this.out = this.out.replace(/[ \t]+$/, '') + '\n'.repeat(this.pendingBreaks);
      this.pendingBreaks = 0;
      this.pendingSpace = false;
    } else if (this.pendingSpace) {
      if (this.out.length && !/\s$/.test(this.out)) this.out += ' ';
      this.pendingSpace = false;
    }
  }

  result(): string {
    return this.out
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

interface WalkState {
  listStack: Array<{ ordered: boolean; index: number }>;
  pre: boolean;
}

function walk(node: Node, b: TextBuilder, state: WalkState) {
  if (node.nodeType === 3) {
    b.text(node.nodeValue ?? '', state.pre);
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
  const el = node as Element;
  const tag = node.nodeType === 1 ? el.tagName.toUpperCase() : '#fragment';
  if (SKIP_TAGS.has(tag)) return;
  if (node.nodeType === 1 && el.getAttribute('aria-hidden') === 'true') return;

  if (tag === 'BR') {
    b.breakLines(1);
    return;
  }
  if (tag === 'HR') {
    b.breakLines(2);
    return;
  }

  const isHeading = /^H[1-6]$/.test(tag);
  const isParagraph = PARAGRAPH_TAGS.has(tag);
  const isBlock = BLOCK_TAGS.has(tag);
  const inList = state.listStack.length > 0;

  if (tag === 'UL' || tag === 'OL') {
    b.breakLines(inList ? 1 : 2);
    state.listStack.push({ ordered: tag === 'OL', index: 0 });
    for (const child of Array.from(node.childNodes)) walk(child, b, state);
    state.listStack.pop();
    b.breakLines(inList ? 1 : 2);
    return;
  }

  if (tag === 'LI') {
    const list = state.listStack[state.listStack.length - 1];
    b.breakLines(1);
    const depth = Math.max(0, state.listStack.length - 1);
    let marker = '• ';
    if (list) {
      list.index += 1;
      if (list.ordered) marker = `${list.index}. `;
    }
    b.prefix('  '.repeat(depth) + marker);
    for (const child of Array.from(node.childNodes)) walk(child, b, state);
    b.breakLines(1);
    return;
  }

  if (tag === 'TR') {
    b.breakLines(1);
    let first = true;
    for (const cell of Array.from(el.children)) {
      if (!first) b.prefix(' | ');
      first = false;
      for (const child of Array.from(cell.childNodes)) walk(child, b, state);
    }
    b.breakLines(1);
    return;
  }

  if (tag === 'PRE') {
    b.breakLines(2);
    const prev = state.pre;
    state.pre = true;
    for (const child of Array.from(node.childNodes)) walk(child, b, state);
    state.pre = prev;
    b.breakLines(2);
    return;
  }

  if (isHeading || isParagraph) b.breakLines(inList ? 1 : 2);
  else if (isBlock || tag === 'LABEL') b.breakLines(1);

  for (const child of Array.from(node.childNodes)) walk(child, b, state);

  if (isHeading || isParagraph) b.breakLines(inList ? 1 : 2);
  else if (isBlock) b.breakLines(1);
}

export function domToText(root: Node): string {
  const b = new TextBuilder();
  walk(root, b, { listStack: [], pre: false });
  return b.result();
}

/** Normalize already-plain text: unify line endings, trim trailing spaces, collapse blank runs. */
export function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
