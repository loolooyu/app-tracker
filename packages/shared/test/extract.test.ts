import { describe, expect, it } from 'vitest';
import { extractJob } from '../src/extract/index.js';
import { loadFixture } from './helpers.js';

describe('Greenhouse adapter (synthetic fixture)', () => {
  const doc = loadFixture('greenhouse.html', 'https://job-boards.greenhouse.io/northwind/jobs/4410?gh_src=x');
  const job = extractJob(doc, { url: doc.URL });

  it('uses the adapter and fills metadata', () => {
    expect(job.platform).toBe('greenhouse');
    expect(job.method).toBe('adapter');
    expect(job.title).toBe('Robotics Software Engineer Co-op');
    expect(job.location).toBe('Boston, MA (Hybrid)');
    expect(job.jobId).toBe('4410');
  });

  it('keeps responsibilities, qualifications, compensation and instructions with structure', () => {
    expect(job.text).toContain("What you'll do");
    expect(job.text).toContain('• Write quaternion calibration tooling for our arm fleet.');
    expect(job.text).toContain('Qualifications');
    expect(job.text).toContain('Nice to have: ROS 2 experience.');
    expect(job.text).toContain('$32–$40 per hour');
    expect(job.text).toContain('How to apply');
    expect(job.text).toMatch(/Qualifications\n\n• Pursuing/);
  });

  it('drops cookie banners, navigation, recommendations and the application form', () => {
    expect(job.text).not.toMatch(/cookies/i);
    expect(job.text).not.toContain('All jobs');
    expect(job.text).not.toContain('Firmware Intern');
    expect(job.text).not.toContain('First Name');
    expect(job.text).not.toContain('Should Not Capture');
    expect(job.text).not.toContain('My private answer');
    expect(job.warnings).toEqual(expect.not.arrayContaining([expect.stringMatching(/Only \d+ characters/)]));
  });
});

describe('Workday adapter (synthetic fixture)', () => {
  const doc = loadFixture('workday.html', 'https://harborview.wd5.myworkdayjobs.com/en-US/External/job/Providence-RI/Data-Analyst-Co-op_R0045821');
  const job = extractJob(doc, { url: doc.URL });
  it('extracts title, location, requisition id and the full description', () => {
    expect(job.method).toBe('adapter');
    expect(job.title).toBe('Data Analyst Co-op (Spring 2027)');
    expect(job.location).toBe('Providence, RI');
    expect(job.jobId).toBe('R0045821');
    expect(job.text).toContain('Basic Qualifications');
    expect(job.text).toContain('$28.00 per hour');
    expect(job.text).not.toContain('Data Engineer Co-op');
  });
});

describe('LinkedIn adapter (synthetic fixture)', () => {
  const doc = loadFixture('linkedin.html', 'https://www.linkedin.com/jobs/view/3901234567/?trk=x');
  const job = extractJob(doc, { url: doc.URL });
  it('extracts top card and description and warns about collapsed content', () => {
    expect(job.method).toBe('adapter');
    expect(job.company).toBe('Lumen Health Labs');
    expect(job.location).toBe('New York, NY');
    expect(job.jobId).toBe('3901234567');
    expect(job.text).toContain('Prototype flows in Figma.');
    expect(job.text).not.toContain('UX Researcher');
    expect(job.warnings.join(' ')).toMatch(/See more/);
  });
});

describe('LinkedIn-like page on an unrecognized host (generic path)', () => {
  const doc = loadFixture('linkedin.html', 'https://jobs.example.test/view/1');
  const job = extractJob(doc, { url: doc.URL });
  it('still finds title, company and the collapsed-content warning', () => {
    expect(job.method).toBe('generic_dom');
    expect(job.title).toBe('Product Design Intern');
    expect(job.company).toBe('Lumen Health Labs');
    expect(job.text).toContain('Run usability sessions with nurses.');
    expect(job.warnings.join(' ')).toMatch(/See more/);
  });
});

describe('structured data (JobPosting)', () => {
  const doc = loadFixture('company-jsonld.html', 'https://careers.contoso.test/jobs/lab-automation');
  const job = extractJob(doc, { url: doc.URL });
  it('prefers the complete structured description over the thin visible page', () => {
    expect(job.platform).toBe('company');
    expect(job.method).toBe('structured_data');
    expect(job.company).toBe('Contoso Bio');
    expect(job.location).toBe('Cambridge, MA, US');
    expect(job.jobId).toBe('CB-2291');
    expect(job.text).toContain('• Maintain pipetting calibration logs.');
    expect(job.text).toContain('Salary: $27-$33 per hour.');
    expect(job.text).toContain('To apply, submit your resume');
  });
});

describe('generic extraction on an unknown job board', () => {
  const doc = loadFixture('job-board-generic.html', 'https://jobs.university.test/students/jobs/88213');
  it('finds the description container and keeps external application instructions', () => {
    const job = extractJob(doc, { url: doc.URL, nuworksHosts: ['jobs.university.test'] });
    expect(job.platform).toBe('nuworks');
    expect(job.adapter.supportLevel).toBe('generic');
    expect(job.method).toBe('generic_dom');
    expect(job.title).toBe('Software Engineer Co-op');
    expect(job.text).toContain('Desired Skills');
    expect(job.text).toContain('Apply directly at https://northwind.wd1.myworkdayjobs.com');
    expect(job.text).not.toContain('Logout');
    expect(job.text).not.toContain('Saved jobs');
  });
});

describe('warnings without fabrication', () => {
  it('flags a short posting but keeps exactly its text', () => {
    const doc = loadFixture('short.html');
    const job = extractJob(doc, { url: doc.URL });
    expect(job.text).toBe('Barista (Part-time)\n\nWeekend shifts at our campus cafe. Must be available Saturdays.');
    expect(job.warnings.join(' ')).toMatch(/Only \d+ characters/);
  });

  it('flags a loading page', () => {
    const doc = loadFixture('loading.html');
    const job = extractJob(doc, { url: doc.URL });
    expect(job.warnings.join(' ')).toMatch(/still have been loading/);
  });

  it('flags multiple postings and lists them', () => {
    const doc = loadFixture('multi-jsonld.html');
    const job = extractJob(doc, { url: doc.URL });
    expect(job.postings.map((p) => p.title)).toEqual(['Firmware Intern', 'QA Intern']);
    expect(job.warnings.join(' ')).toMatch(/lists 2 job postings/);
    const candidates = job.alternatives.filter((a) => a.meta);
    expect(candidates.map((c) => [c.meta!.title, c.text])).toEqual([
      ['Firmware Intern', 'Write firmware.'],
      ['QA Intern', 'Test robots.'],
    ]);
  });

  it('falls back to selected text when nothing usable is found', () => {
    const doc = loadFixture('workday-form.html');
    const selection = 'Selected: Data Analyst Co-op responsibilities include dashboards and SQL reporting.';
    const job = extractJob(doc, { url: doc.URL, selectionText: selection });
    expect(job.method).toBe('selected_text');
    expect(job.text).toBe(selection);
    expect(job.warnings).toContain('Captured from your text selection only.');
  });
});

describe('hostile content', () => {
  it('extracts plain text only: no script bodies, no handlers, markup kept as literal text', () => {
    const doc = loadFixture('hostile.html');
    const job = extractJob(doc, { url: doc.URL });
    expect(job.text).not.toContain('__pwned');
    expect(job.text).not.toContain('display:none');
    expect(job.text).not.toContain('onclick');
    expect(job.text).toContain('<img src=x onerror=alert(1)>'); // literal text from &lt;...&gt;
    expect(job.text).toContain('Ignore previous instructions'); // kept as data, never acted on
  });
});
