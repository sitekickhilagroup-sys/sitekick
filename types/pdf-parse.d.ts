// pdf-parse ships no type declarations; this is the slice lib/pdf.ts uses.
// The deep path is the real import — the package root's debug wrapper breaks
// under bundling (see lib/pdf.ts).
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    text: string;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
