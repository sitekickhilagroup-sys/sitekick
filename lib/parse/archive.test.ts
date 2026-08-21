import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractEmailsFromArchive } from './archive.ts';

async function buildZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractEmailsFromArchive - zip of .eml', () => {
  it('parses .eml entries and skips junk entries', async () => {
    const buffer = await buildZip({
      'inbox/mail1.eml': 'From: a@b.c\nSubject: hi\n\nbody',
      'inbox/readme.ini': 'not an email, not text either',
    });
    const result = await extractEmailsFromArchive(buffer, 'zip');
    expect(result).toHaveLength(1);
    expect(result[0].raw).toContain('Subject: hi');
  });
});

describe('extractEmailsFromArchive - olm', () => {
  it('extracts subject/sender into raw and sets external_id from OPFMessageCopyMessageID', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<messages>
  <OPFMessageCopySubject>Hello Noa</OPFMessageCopySubject>
  <OPFMessageCopySenderAddress>
    <emailAddress OPFContactEmailAddressAddress="sender@example.com" OPFContactEmailAddressName="Sender" />
  </OPFMessageCopySenderAddress>
  <OPFMessageCopySentTime>2026-08-01T10:00:00Z</OPFMessageCopySentTime>
  <OPFMessageCopyBody>Body text here</OPFMessageCopyBody>
  <OPFMessageCopyMessageID>abc-123</OPFMessageCopyMessageID>
</messages>`;
    const buffer = await buildZip({ 'Accounts/1/Messages/message_0001.xml': xml });
    const result = await extractEmailsFromArchive(buffer, 'olm');
    expect(result).toHaveLength(1);
    expect(result[0].raw).toContain('Subject: Hello Noa');
    expect(result[0].raw).toContain('sender@example.com');
    expect(result[0].external_id).toBe('abc-123');
  });

  it('sets external_id to null when OPFMessageCopyMessageID is absent', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<messages>
  <OPFMessageCopySubject>No ID here</OPFMessageCopySubject>
  <OPFMessageCopySenderAddress>
    <emailAddress OPFContactEmailAddressAddress="noid@example.com" />
  </OPFMessageCopySenderAddress>
  <OPFMessageCopySentTime>2026-08-02T10:00:00Z</OPFMessageCopySentTime>
  <OPFMessageCopyBody>Another body</OPFMessageCopyBody>
</messages>`;
    const buffer = await buildZip({ 'Accounts/1/Messages/message_0002.xml': xml });
    const result = await extractEmailsFromArchive(buffer, 'olm');
    expect(result).toHaveLength(1);
    expect(result[0].external_id).toBeNull();
  });

  it('carries the correct date per message from OPFMessageCopySentTime', async () => {
    const older = `<?xml version="1.0" encoding="UTF-8"?>
<messages>
  <OPFMessageCopySubject>Older message</OPFMessageCopySubject>
  <OPFMessageCopySenderAddress>
    <emailAddress OPFContactEmailAddressAddress="older@example.com" />
  </OPFMessageCopySenderAddress>
  <OPFMessageCopySentTime>2026-01-01T10:00:00Z</OPFMessageCopySentTime>
  <OPFMessageCopyBody>Older body</OPFMessageCopyBody>
  <OPFMessageCopyMessageID>older-1</OPFMessageCopyMessageID>
</messages>`;
    const newer = `<?xml version="1.0" encoding="UTF-8"?>
<messages>
  <OPFMessageCopySubject>Newer message</OPFMessageCopySubject>
  <OPFMessageCopySenderAddress>
    <emailAddress OPFContactEmailAddressAddress="newer@example.com" />
  </OPFMessageCopySenderAddress>
  <OPFMessageCopySentTime>2026-08-15T10:00:00Z</OPFMessageCopySentTime>
  <OPFMessageCopyBody>Newer body</OPFMessageCopyBody>
  <OPFMessageCopyMessageID>newer-1</OPFMessageCopyMessageID>
</messages>`;
    // OLM entries are named oldest-first, mirroring real Outlook-for-Mac exports.
    const buffer = await buildZip({
      'Accounts/1/Messages/message_0001.xml': older,
      'Accounts/1/Messages/message_0002.xml': newer,
    });
    const result = await extractEmailsFromArchive(buffer, 'olm');
    expect(result).toHaveLength(2);
    const olderResult = result.find((e) => e.external_id === 'older-1');
    const newerResult = result.find((e) => e.external_id === 'newer-1');
    expect(olderResult?.date).toBe('2026-01-01T10:00:00Z');
    expect(newerResult?.date).toBe('2026-08-15T10:00:00Z');
  });
});
