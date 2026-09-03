const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GENERIC_PREFIX = 'CM-G1:';

export type OmrFormReference =
  | { kind: 'issued'; issuedFormToken: string }
  | { kind: 'generic'; templateId: string };

export function parseOmrFormReference(raw: string): OmrFormReference | null {
  if (UUID_V4.test(raw)) return { kind: 'issued', issuedFormToken: raw };
  if (!raw.startsWith(GENERIC_PREFIX)) return null;
  const templateId = raw.slice(GENERIC_PREFIX.length);
  return UUID_V4.test(templateId) ? { kind: 'generic', templateId } : null;
}

export function genericOmrFormReference(templateId: string): string {
  if (!UUID_V4.test(templateId)) throw new Error('Generic OMR template ID must be a canonical UUIDv4');
  return `${GENERIC_PREFIX}${templateId}`;
}
