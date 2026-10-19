'use strict';

/** Excel / CSV in, Excel / PDF out. Needs:  npm i exceljs pdfkit */

const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const AppError = require('../utils/AppError');

const plain = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.result !== undefined) return plain(v.result);
    if (v.text !== undefined) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    return String(v);
  }
  return v;
};

/** Reads the first sheet of an uploaded .xlsx / .csv (multer memory storage). Row 1 = headers. Returns an array of objects. */
async function readRows(file) {
  if (!file || !file.buffer) throw new AppError('Upload an Excel (.xlsx) or CSV file');
  const wb = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(file.originalname || '') || /csv/i.test(file.mimetype || '');
  try {
    if (isCsv) await wb.csv.read(Readable.from(file.buffer));
    else await wb.xlsx.load(file.buffer);
  } catch (err) {
    throw new AppError('Could not read that file. Save it as .xlsx or .csv and try again.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('The file has no data');

  const headers = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = String(plain(cell.value)).trim().toLowerCase().replace(/[\s-]+/g, '_');
  });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = plain(row.getCell(col).value);
      if (v !== '') any = true;
      obj[h] = v;
    });
    if (any) rows.push(obj);
  });
  return rows;
}

const headerText = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const columnsFor = (rows) => Object.keys(rows[0] || {}).map((key) => ({ key, header: headerText(key) }));

async function toXlsx(title, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(title).slice(0, 31));
  const columns = columnsFor(rows);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 2) }));
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}

const fmt = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
  if (typeof v === 'number') return v.toLocaleString('en-KE', { maximumFractionDigits: 2 });
  return String(v);
};

/** Streams a simple table PDF into `res` (set the headers before calling). */
function toPdf(res, { title, subtitle, rows }) {
  const columns = columnsFor(rows);
  const doc = new PDFDocument({ size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait', margin: 30 });
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text(title);
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor('#555555').text(subtitle);
  doc.moveDown(0.5);

  const left = 30;
  const colW = (doc.page.width - 60) / Math.max(columns.length, 1);
  const heightOf = (vals) => Math.max(...vals.map((v) => doc.heightOfString(v, { width: colW - 4 })), 10);
  const draw = (vals, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000000');
    const h = heightOf(vals);
    const y = doc.y;
    vals.forEach((v, i) => doc.text(v, left + i * colW, y, { width: colW - 4 }));
    doc.x = left;
    doc.y = y + h + 4;
    if (bold) doc.moveTo(left, doc.y - 2).lineTo(left + colW * columns.length, doc.y - 2).strokeColor('#999999').stroke();
  };

  const headers = columns.map((c) => c.header);
  draw(headers, true);
  for (const r of rows) {
    const vals = columns.map((c) => fmt(r[c.key]));
    if (doc.y + heightOf(vals) > doc.page.height - 40) {
      doc.addPage();
      draw(headers, true);
    }
    draw(vals, false);
  }
  doc.end();
}

module.exports = { readRows, toXlsx, toPdf };
