// Hilla email dump format (hilla_emails_full_1.jsonl):
// {folder, subject, sent, received, from:[{addr,name}], to:[], cc:[], attachments:[], body}

export interface DumpEmail {
  subject: string;
  date: string;
  from: string;
  to: string;
  body: string;
  externalId: string;
}

interface RawAddr { addr?: string; name?: string }
interface RawLine {
  folder?: string; subject?: string; sent?: string; received?: string;
  from?: RawAddr[]; to?: RawAddr[]; cc?: RawAddr[]; body?: string;
}

const fmtAddrs = (list?: RawAddr[]) =>
  (list ?? []).map((a) => a.name && a.name !== a.addr ? `${a.name} <${a.addr}>` : (a.addr ?? '')).join(', ');

export function parseEmailsJsonl(raw: string, limit = 500): DumpEmail[] {
  const out: DumpEmail[] = [];
  for (const line of raw.split('\n')) {
    if (out.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: RawLine;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    const date = obj.received || obj.sent || '';
    const subject = obj.subject ?? '';
    const from = fmtAddrs(obj.from);
    out.push({
      subject,
      date,
      from,
      to: fmtAddrs(obj.to),
      body: (obj.body ?? '').slice(0, 30000),
      externalId: `dump:${date}:${subject}:${from}`.slice(0, 300),
    });
  }
  return out;
}

export function dumpEmailToRaw(e: DumpEmail): string {
  return `From: ${e.from}\nTo: ${e.to}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.body}`;
}
