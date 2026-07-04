/**
 * Minimal, dependency-free PDF writer.
 *
 * Produces a valid multi-page PDF (PDF 1.4) containing a title and a monospaced
 * table — enough for report exports — using the built-in Courier font (no font
 * embedding). In the spirit of the hand-rolled CSV/XLSX writers, this avoids a
 * heavy PDF dependency (puppeteer/pdfkit) and the supply-chain surface it brings.
 */

export interface PdfTable {
  title: string;
  headers: string[];
  rows: unknown[][];
}

const PAGE_W = 612; // Letter, points
const PAGE_H = 792;
const MARGIN = 40;
const FONT_SIZE = 8;
const LINE_H = 11;
const TOP = PAGE_H - MARGIN;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LINE_H) - 2;
const MAX_CHARS = 118; // ~page width at Courier 8pt

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\r?\n/g, " ");
}

/** Render the table to fixed-width text lines (header + padded rows). */
function toLines(table: PdfTable): string[] {
  const cols = table.headers.length;
  const widths = table.headers.map((h) => h.length);
  for (const row of table.rows) {
    // i < cols === widths.length, so widths[i] is always present
    for (let i = 0; i < cols; i++) widths[i] = Math.max(widths[i]!, cell(row[i]).length);
  }
  // Cap column width so wide tables stay on the page.
  const cap = Math.max(8, Math.floor(MAX_CHARS / cols) - 1);
  const w = widths.map((x) => Math.min(x, cap));
  const fmt = (vals: unknown[]) =>
    vals
      .map((v, i) => {
        const s = cell(v);
        // Cells beyond the header count have no sized column → width is the cell's
        // own length, making slice/padEnd no-ops (matches the prior undefined behaviour).
        const width = w[i] ?? s.length;
        return s.slice(0, width).padEnd(width);
      })
      .join(" ")
      .slice(0, MAX_CHARS);

  const lines = [fmt(table.headers), w.map((x) => "-".repeat(x)).join(" ").slice(0, MAX_CHARS)];
  for (const row of table.rows) lines.push(fmt(row));
  return lines;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface PdfObjects {
  /** 1-indexed PDF object bodies (index 0 unused). */
  objects: string[];
  /** The highest object number in use. */
  total: number;
}

/**
 * Build the PDF's page/content/font objects for a table — 1=Catalog, 2=Pages, 3=Font, then per
 * page: content + page. Pure data construction; no binary framing/xref/trailer, that's
 * `serializePdf`'s job (mirroring how xlsx.ts delegates its persist step to `buildZip`).
 */
function buildPdfObjects(table: PdfTable): PdfObjects {
  const stamp = new Date().toISOString().slice(0, 10);
  const allLines = [table.title, `Exported ${stamp} - ${table.rows.length} rows`, "", ...toLines(table)];
  const pages = chunk(allLines, LINES_PER_PAGE);
  if (pages.length === 0) pages.push([table.title]);

  const objects: string[] = [];
  const pageObjNums: number[] = [];
  let objNum = 3; // next after font

  const contentForPage = (lines: string[]): string => {
    const body = lines
      .map((ln, i) => (i === 0 ? `(${escapeText(ln)}) Tj` : `T* (${escapeText(ln)}) Tj`))
      .join("\n");
    return `BT /F1 ${FONT_SIZE} Tf ${MARGIN} ${TOP} Td ${LINE_H} TL\n${body}\nET`;
  };

  for (const lines of pages) {
    const content = contentForPage(lines);
    objNum += 1;
    const contentNum = objNum;
    objects[contentNum] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
    objNum += 1;
    const pageNum = objNum;
    objects[pageNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    pageObjNums.push(pageNum);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageObjNums.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;

  return { objects, total: objNum };
}

/** Hand-serialize built PDF objects into the final binary (Buffer): the object bodies, an xref
 *  table of their byte offsets, and the trailer. */
function serializePdf({ objects, total }: PdfObjects): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= total; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "binary");
}

/** Render a simple table to a minimal, dependency-free PDF document (Buffer). */
export function buildPdf(table: PdfTable): Buffer {
  return serializePdf(buildPdfObjects(table));
}
