import { Readable } from 'node:stream';
import { transaction } from '../db/index.js';
import { conflict } from '../lib/errors.js';
import { isWorkspaceEmpty } from '../lib/backup.js';
import { addLink, addSnapshot, createApplication, markApplied, changeStatus } from './applications.js';
import { uploadDocument } from './documents.js';
import { addAssessment, addInterview, updateAssessment } from './tasks.js';
import type { Ctx } from './core.js';

/** Build a tiny single-page PDF with the given text lines (used only for fictional demo resumes). */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => '\\' + m);
  const content = ['BT', '/F1 12 Tf', '72 740 Td', '16 TL', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const DEMO_TAG = 'demo';
const days = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

/**
 * Seed a clearly fictional demo workspace. Refuses unless the workspace is empty, and every
 * record is flagged is_demo so the dashboard can label it and remove it in one step.
 */
export async function seedDemo(ctx: Ctx, timezone: string) {
  if (!isWorkspaceEmpty(ctx.db)) {
    throw conflict('workspace_not_empty', 'Demo data can only be loaded into an empty workspace, so it never mixes with your real records.');
  }
  const r1 = await uploadDocument(ctx, Readable.from(makePdf(['DEMO RESUME - FICTIONAL', 'Alex Example', 'Robotics / Software v3', 'This file is sample data.'])), {
    filename: 'Alex_Example_Resume_Robotics_v3.pdf', type: 'resume', label: 'Robotics SWE — v3 (demo)', isDemo: true,
  });
  const r2 = await uploadDocument(ctx, Readable.from(makePdf(['DEMO RESUME - FICTIONAL', 'Alex Example', 'Data / Analytics v1', 'This file is sample data.'])), {
    filename: 'Alex_Example_Resume.pdf', type: 'resume', label: 'Data analytics — v1 (demo)', isDemo: true,
  });

  const mk = (company: string, title: string, location: string, foundOn: 'nuworks' | 'linkedin' | 'handshake' | 'greenhouse' | 'company', jd: string, url: string) => {
    const id = createApplication(ctx, { company, title, location, jobType: 'Co-op', program: null, season: 'Spring 2027', jobId: null, foundOn, appliedThrough: null, notes: null, tags: [DEMO_TAG] }, { isDemo: true });
    addLink(ctx, id, { url, platform: foundOn, relationship: 'discovery' });
    addSnapshot(ctx, id, { sourceUrl: url, rawText: jd, reviewedText: jd, method: 'generic_dom', warnings: [], reviewConfirmed: true, pageTitle: `${title} (demo)` });
    return id;
  };

  transaction(ctx.db, () => {
    const a = mk('Northwind Robotics (demo)', 'Robotics Software Engineer Co-op', 'Boston, MA', 'nuworks',
      'DEMO — fictional posting.\n\nWhat you\'ll do\n\n• Implement motion-planning features in C++.\n• Write quaternion calibration tooling.\n\nQualifications\n\n• Pursuing a BS/MS in CS or Robotics.\n\nCompensation\n\n$32–$40 per hour.\n\nHow to apply\n\nApply on the company Workday site.',
      'https://example.com/demo/nuworks/88213');
    addLink(ctx, a, { url: 'https://example.com/demo/workday/R0099123', platform: 'workday', relationship: 'application' });
    markApplied(ctx, a, { submittedAt: days(-9), resumeDocumentId: r1.document.id, coverLetterDocumentId: null, appliedThrough: 'workday', note: null });
    changeStatus(ctx, a, 'interview', null);
    addInterview(ctx, a, { title: 'Technical interview (demo)', startsAt: days(3), timezone, format: 'video', notes: 'Review the motion-planning section of the saved JD.' });

    const b = mk('Harborview Analytics (demo)', 'Data Analyst Co-op', 'Providence, RI', 'handshake',
      'DEMO — fictional posting.\n\nResponsibilities\n\n• Build SQL dashboards.\n\nBasic Qualifications\n\n• Statistics coursework.\n\nPay: $28 per hour.',
      'https://example.com/demo/handshake/5521');
    markApplied(ctx, b, { submittedAt: days(-4), resumeDocumentId: r2.document.id, coverLetterDocumentId: null, appliedThrough: 'company', note: null });
    changeStatus(ctx, b, 'assessment', null);
    addAssessment(ctx, b, { type: 'hirevue', title: 'HireVue video interview (demo)', url: null, dueAt: days(1.5), timezone, reminderOffsetsMinutes: null, notes: null });
    const done = addAssessment(ctx, b, { type: 'oa', title: 'SQL online assessment (demo)', url: null, dueAt: days(-1), timezone, reminderOffsetsMinutes: null, notes: null });
    updateAssessment(ctx, b, done.id, { completed: true });

    const c = mk('Lumen Health Labs (demo)', 'Product Design Intern', 'New York, NY', 'linkedin',
      'DEMO — fictional posting.\n\nResponsibilities\n\n• Prototype flows in Figma.\n\nRequirements\n\n• A portfolio.\n\nCompensation: $30/hr.',
      'https://example.com/demo/linkedin/3901234567');
    markApplied(ctx, c, { submittedAt: days(-2), resumeDocumentId: null, coverLetterDocumentId: null, appliedThrough: 'linkedin', note: null });

    mk('Contoso Bio (demo)', 'Lab Automation Engineer Co-op', 'Cambridge, MA', 'company',
      'DEMO — fictional posting.\n\nResponsibilities\n\n• Program liquid-handling robots.\n\nQualifications\n\n• Python.\n\nSalary: $27–$33 per hour.',
      'https://example.com/demo/contoso/CB-2291');
  });
}

export async function removeDemo(ctx: Ctx) {
  const docs = ctx.db.prepare('SELECT id, storage_key FROM documents WHERE is_demo = 1').all() as Array<{ id: string; storage_key: string }>;
  transaction(ctx.db, () => {
    ctx.db.prepare('DELETE FROM applications WHERE is_demo = 1').run();
    // Only delete demo documents no real application references.
    for (const d of docs) {
      const used = ctx.db.prepare('SELECT 1 FROM applications WHERE submitted_resume_document_id = ? OR submitted_cover_letter_document_id = ?').get(d.id, d.id);
      if (!used) ctx.db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
    }
  });
  for (const d of docs) {
    const still = ctx.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(d.id);
    if (!still) await ctx.files.remove(d.storage_key);
  }
}
