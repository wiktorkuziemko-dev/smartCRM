export interface ExportColumn<T> { label: string; value: (row: T) => string | number | Date | null | undefined; width?: number }

/** Generuje plik .xlsx w przeglądarce (exceljs ładowany dopiero przy eksporcie). */
export async function exportXlsx<T>(fileName: string, sheetName: string, columns: ExportColumn<T>[], rows: T[]) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SmartCRM';
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.label, width: c.width ?? Math.max(12, c.label.length + 4) }));
  // Excel nie zna stref czasowych – zapisujemy czas lokalny użytkownika.
  const local = (v: unknown) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60_000) : v);
  rows.forEach((r) => ws.addRow(columns.map((c) => local(c.value(r)) ?? '')));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  ws.eachRow((row, i) => { if (i > 1) row.eachCell((cell) => { if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm'; }); });

  // Zapis w dzienniku zdarzeń (kto i co wyeksportował) – bez czekania na odpowiedź.
  void import('./api').then(({ api }) => api.post('/api/audit/export', { file: fileName, rows: rows.length })).catch(() => {});

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}
