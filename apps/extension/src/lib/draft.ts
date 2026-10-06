import { detectPlatform, jobIdFromUrl } from '@appfolio/shared';
import type { ExtractedJob } from '@appfolio/shared/extract';
import type { Draft, DraftForm } from './types.js';

export function emptyForm(url = ''): DraftForm {
  return {
    mode: 'new',
    company: '',
    title: '',
    location: '',
    platform: url ? detectPlatform(url) : 'other',
    jobId: url ? (jobIdFromUrl(url, detectPlatform(url)) ?? '') : '',
    url,
    text: '',
    rawText: '',
    method: 'manual_paste',
    linkApplicationId: null,
    linkApplicationLabel: null,
    relationship: 'discovery',
    saveSnapshot: true,
    setAppliedThrough: false,
    makePrimary: false,
    reviewed: false,
    rememberNuworksHost: false,
  };
}

export function draftFromExtraction(id: string, x: ExtractedJob, pageTitle: string | null): Draft {
  const form: DraftForm = {
    ...emptyForm(x.url),
    company: x.company ?? '',
    title: x.title ?? '',
    location: x.location ?? '',
    platform: x.platform,
    jobId: x.jobId ?? '',
    text: x.text,
    rawText: x.text,
    method: x.method,
  };
  return { id, createdAt: new Date().toISOString(), source: { url: x.url, title: pageTitle }, extracted: x, captureError: null, form };
}

export function failedDraft(id: string, url: string, title: string | null, message: string): Draft {
  return { id, createdAt: new Date().toISOString(), source: { url, title }, extracted: null, captureError: message, form: { ...emptyForm(/^https?:/.test(url) ? url : ''), title: title ?? '' } };
}

/** Build the API capture payload from a reviewed draft. */
export function capturePayload(d: Draft): Record<string, unknown> {
  const f = d.form;
  const snapshot =
    f.saveSnapshot && f.text.trim()
      ? {
          sourceUrl: f.url || null,
          rawText: f.rawText || f.text,
          reviewedText: f.text,
          method: f.method,
          warnings: d.extracted?.warnings ?? [],
          reviewConfirmed: f.reviewed,
          pageTitle: d.source.title,
        }
      : null;
  const link = f.url ? { url: f.url, platform: f.platform, relationship: f.relationship } : null;
  if (f.mode === 'link') {
    return {
      mode: 'link',
      captureId: d.id,
      applicationId: f.linkApplicationId,
      link,
      snapshot,
      makePrimary: f.makePrimary,
      setAppliedThrough: f.setAppliedThrough,
    };
  }
  return {
    mode: 'new',
    captureId: d.id,
    application: {
      company: f.company,
      title: f.title,
      location: f.location || null,
      jobId: f.jobId || null,
      foundOn: f.platform,
      tags: [],
    },
    link,
    snapshot,
  };
}
