// Builds the excise self-audit report as a real PDF file (volumes only, no
// dollar amounts) and downloads it, so it can be saved and printed without
// going through the browser's print screen. jsPDF is loaded only when used.

// The built-in PDF font only covers Western characters; swap the rest.
const clean = (t) =>
  String(t ?? "")
    .replace(/✓/g, "OK")
    .replace(/→/g, "->")
    .replace(/≈/g, "~")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…·]/g, "");

export async function downloadExciseReportPdf({ months, companyName, periodRange, abvMethod, full, intro, summaryLine, counts, renderMonth, fileName }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  let y = M;

  const ensure = (h) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (t, { size = 9.5, bold = false, color = [26, 31, 22], gap = 1.2, indent = 0 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(clean(t), W - 2 * M - indent);
    const lh = size * 0.42;
    lines.forEach((ln) => {
      ensure(lh);
      doc.text(ln, M + indent, y + lh * 0.8);
      y += lh;
    });
    y += gap;
  };
  const rule = () => {
    ensure(3);
    doc.setDrawColor(201, 209, 172);
    doc.line(M, y, W - M, y);
    y += 3;
  };
  // Simple table: widths as fractions of the page width; right-aligned columns by index.
  const table = (headers, rows, widths, right = []) => {
    const total = W - 2 * M;
    const cols = widths.map((w) => w * total);
    const draw = (cells, bold) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(8);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(clean(c), cols[i] - 2));
      const h = Math.max(...wrapped.map((w) => w.length)) * 3.4 + 1.2;
      ensure(h);
      let x = M;
      wrapped.forEach((w, i) => {
        w.forEach((ln, k) => {
          const ty = y + 3 + k * 3.4;
          if (right.includes(i)) doc.text(ln, x + cols[i] - 1, ty, { align: "right" });
          else doc.text(ln, x + 1, ty);
        });
        x += cols[i];
      });
      y += h;
      doc.setDrawColor(bold ? 201 : 232, bold ? 209 : 235, bold ? 172 : 220);
      doc.line(M, y, W - M, y);
    };
    doc.setTextColor(26, 31, 22);
    draw(headers, true);
    rows.forEach((r) => draw(r, false));
    y += 2;
  };

  // Front page
  if (intro) text(intro, { size: 9, gap: 3 });
  if (counts) text(counts, { size: 9.5, bold: true, gap: 1 });
  if (summaryLine) text(summaryLine, { size: 9, gap: 4 });

  // Each month on its own page (the first follows the heading).
  months.forEach((m, idx) => {
    if (idx > 0) {
      doc.addPage();
      y = M;
    } else rule();
    renderMonth(m, { text, table, ensure });
  });

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(155, 168, 138);
    doc.text(`Page ${i} of ${pages}`, W / 2, H - 7, { align: "center" });
  }
  doc.save(fileName);
}
