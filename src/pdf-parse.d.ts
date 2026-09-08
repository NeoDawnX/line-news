declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (data: Buffer, options?: { max?: number }) => Promise<{ text: string }>;
  export default pdfParse;
}
