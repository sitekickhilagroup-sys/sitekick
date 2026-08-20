import mammoth from 'mammoth';

export async function docxToText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}
