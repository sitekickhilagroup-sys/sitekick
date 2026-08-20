// Minimal .eml (RFC 822) parser — headers + best-effort text body.
// Good enough for forwarded single emails; multipart walks text/plain first.

export interface ParsedEmail {
  from: string;
  to: string;
  date: string;
  subject: string;
  body: string;
  messageId: string | null;
}

function decodeQP(s: string): string {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function header(raw: string, name: string): string {
  const re = new RegExp(`^${name}:[ \t]*(.*(?:\r?\n[ \t].*)*)`, 'im');
  const m = raw.match(re);
  return m ? m[1].replace(/\r?\n[ \t]+/g, ' ').trim() : '';
}

export function parseEml(raw: string): ParsedEmail {
  const splitAt = raw.search(/\r?\n\r?\n/);
  const head = splitAt === -1 ? raw : raw.slice(0, splitAt);
  let body = splitAt === -1 ? '' : raw.slice(splitAt).trim();

  const contentType = header(head, 'Content-Type');
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
  if (boundaryMatch) {
    const parts = body.split('--' + boundaryMatch[1]);
    const textPart = parts.find((p) => /content-type:\s*text\/plain/i.test(p))
      ?? parts.find((p) => /content-type:\s*text\/html/i.test(p));
    if (textPart) {
      const pSplit = textPart.search(/\r?\n\r?\n/);
      let content = pSplit === -1 ? textPart : textPart.slice(pSplit).trim();
      if (/content-transfer-encoding:\s*quoted-printable/i.test(textPart)) content = decodeQP(content);
      if (/content-transfer-encoding:\s*base64/i.test(textPart)) {
        content = Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8');
      }
      if (/text\/html/i.test(textPart)) {
        content = content.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
      }
      body = content.trim();
    }
  } else if (/quoted-printable/i.test(header(head, 'Content-Transfer-Encoding'))) {
    body = decodeQP(body);
  }

  return {
    from: header(head, 'From'),
    to: header(head, 'To'),
    date: header(head, 'Date'),
    subject: header(head, 'Subject'),
    body: body.slice(0, 30000),
    messageId: header(head, 'Message-ID') || null,
  };
}
