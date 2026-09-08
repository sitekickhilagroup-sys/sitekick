import 'server-only';
// ZIP / OLM email-archive parser (client feedback — Noa's Outlook-for-Mac exports).
// Outlook-for-Mac .olm exports are themselves a ZIP: message_N.xml entries under any
// folder, one Outlook "OPF" XML message per entry. Plain .zip bundles of forwarded
// .eml files (± loose .txt notes) are the other export shape Noa uses.

import JSZip from 'jszip';
import { parseEml } from './eml.ts';

export interface ExtractedEmail {
  raw: string;
  external_id: string | null;
  date: string | null;
}

// POC safety valve — mirrors the parseEmailsJsonl(limit) cap so one huge archive
// can't blow the request budget.
const MAX_ENTRIES = 500;

function matchOne(re: RegExp, text: string): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#13;/g, '\r')
    .replace(/&amp;/g, '&');
}

// OLM bodies embed the HTML message ENTITY-ESCAPED inside <OPFMessageCopyBody>
// (&lt;div&gt;…). Decode the entities FIRST so the tags become real, THEN strip
// them — the reverse order (strip, then decode) leaves the markup as visible
// text in the extractor's prompt.
function cleanOlmBody(raw: string): string {
  const decoded = decodeXmlEntities(raw);
  return decoded.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Every OPF tag in a real Outlook-for-Mac export carries attributes
// (xml:space="preserve"), so each field pattern must tolerate them with [^>]* —
// a bare `<Tag>` match silently yields a blank subject/date/sender/message-id on
// every message, which collapses newest-first ordering and positional dedup.
function extractOlmMessage(xml: string): ExtractedEmail {
  const subject = decodeXmlEntities(
    matchOne(/<OPFMessageCopySubject[^>]*>([\s\S]*?)<\/OPFMessageCopySubject>/, xml) ?? '',
  );
  const sender = matchOne(
    /<OPFMessageCopySenderAddress[^>]*>[\s\S]*?OPFContactEmailAddressAddress="([^"]+)"/,
    xml,
  ) ?? '';
  const date = matchOne(/<OPFMessageCopySentTime[^>]*>([^<]+)</, xml);
  const bodyRaw = matchOne(/<OPFMessageCopyBody[^>]*>([\s\S]*?)<\/OPFMessageCopyBody>/, xml) ?? '';
  const messageId = matchOne(/<OPFMessageCopyMessageID[^>]*>([^<]+)</, xml);
  const raw = `From: ${sender}\nDate: ${date ?? ''}\nSubject: ${subject}\n\n${cleanOlmBody(bodyRaw)}`;
  return { raw, external_id: messageId, date: date ?? null };
}

async function extractZipOfEml(zip: JSZip): Promise<ExtractedEmail[]> {
  const out: ExtractedEmail[] = [];
  for (const entry of Object.values(zip.files)) {
    if (out.length >= MAX_ENTRIES) break;
    if (entry.dir) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.eml')) {
      const text = (await entry.async('nodebuffer')).toString('utf8');
      const parsed = parseEml(text);
      const raw = `From: ${parsed.from}\nTo: ${parsed.to}\nDate: ${parsed.date}\nSubject: ${parsed.subject}\n\n${parsed.body}`;
      out.push({ raw, external_id: parsed.messageId, date: parsed.date ?? null });
    } else if (lower.endsWith('.txt')) {
      const text = (await entry.async('nodebuffer')).toString('utf8');
      out.push({ raw: text, external_id: null, date: null });
    }
    // anything else (folders' sibling metadata, .ini, etc.) is skipped
  }
  return out;
}

async function extractOlm(zip: JSZip): Promise<ExtractedEmail[]> {
  const out: ExtractedEmail[] = [];
  const messageEntries = Object.values(zip.files).filter(
    (f) => !f.dir && /message_\d+\.xml$/i.test(f.name),
  );
  for (const entry of messageEntries) {
    if (out.length >= MAX_ENTRIES) break;
    const xml = (await entry.async('nodebuffer')).toString('utf8');
    out.push(extractOlmMessage(xml));
  }
  return out;
}

export async function extractEmailsFromArchive(
  buffer: Buffer,
  kind: 'zip' | 'olm',
): Promise<ExtractedEmail[]> {
  const zip = await JSZip.loadAsync(buffer);
  return kind === 'olm' ? extractOlm(zip) : extractZipOfEml(zip);
}
