import { describe, expect, it } from 'vitest';
import { detectPlatform, jobIdFromUrl, normalizeUrl } from '../src/url.js';

describe('normalizeUrl', () => {
  it('removes tracking parameters but keeps job-identifying ones', () => {
    expect(normalizeUrl('https://boards.greenhouse.io/northwind/jobs/123?gh_src=abc&utm_source=li#app')).toBe(
      'https://boards.greenhouse.io/northwind/jobs/123',
    );
    expect(normalizeUrl('https://www.linkedin.com/jobs/search/?currentJobId=3901&trk=public&refId=x')).toBe(
      'https://linkedin.com/jobs/search?currentJobId=3901',
    );
    expect(normalizeUrl('https://careers.example.com/apply?jobId=77&utm_campaign=x&source=nuworks')).toBe(
      'https://careers.example.com/apply?jobId=77&source=nuworks',
    );
  });

  it('treats host case, www, trailing slash and param order as equivalent', () => {
    expect(normalizeUrl('https://WWW.Example.com/jobs/1/?b=2&a=1')).toBe(normalizeUrl('https://example.com/jobs/1?a=1&b=2'));
  });

  it('keeps different jobs distinct', () => {
    expect(normalizeUrl('https://x.com/apply?jobId=1')).not.toBe(normalizeUrl('https://x.com/apply?jobId=2'));
  });
});

describe('detectPlatform', () => {
  it('recognizes known boards and treats unknown hosts as company sites', () => {
    expect(detectPlatform('https://job-boards.greenhouse.io/x/jobs/1')).toBe('greenhouse');
    expect(detectPlatform('https://acme.wd1.myworkdayjobs.com/en-US/careers/job/A_R1')).toBe('workday');
    expect(detectPlatform('https://www.linkedin.com/jobs/view/123')).toBe('linkedin');
    expect(detectPlatform('https://app.joinhandshake.com/jobs/1')).toBe('handshake');
    expect(detectPlatform('https://careers.contoso.test/jobs/1')).toBe('company');
  });

  it('only detects NUworks when the user configured its hostname', () => {
    const url = 'https://jobs.university.test/students/app/jobs/detail/1';
    expect(detectPlatform(url)).toBe('company');
    expect(detectPlatform(url, { nuworksHosts: ['jobs.university.test'] })).toBe('nuworks');
  });
});

describe('jobIdFromUrl', () => {
  it('extracts platform job ids', () => {
    expect(jobIdFromUrl('https://boards.greenhouse.io/n/jobs/4410', 'greenhouse')).toBe('4410');
    expect(jobIdFromUrl('https://n.com/careers?gh_jid=55', 'greenhouse')).toBe('55');
    expect(jobIdFromUrl('https://www.linkedin.com/jobs/view/3901234567/', 'linkedin')).toBe('3901234567');
    expect(jobIdFromUrl('https://a.wd1.myworkdayjobs.com/en-US/c/job/Boston-MA/SWE-Co-op_R0099123', 'workday')).toBe('R0099123');
    expect(jobIdFromUrl('https://careers.contoso.test/x', 'company')).toBeNull();
  });
});
