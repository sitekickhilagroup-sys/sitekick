import 'server-only';
// The package root runs debug code (reads a test PDF) whenever module.parent
// is falsy — true under Next's bundler, which kills the build at config
// collection. Importing the core module directly skips that wrapper.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// Text extraction for TEXT documents that happen to arrive as PDFs — meeting
// summary emails, letters. Invoices do NOT go through here: parse-invoice
// hands the raw PDF to Claude, which also reads scans and layout.
export async function pdfToText(buffer: Buffer): Promise<string> {
  const { text } = await pdfParse(buffer);
  return text;
}
