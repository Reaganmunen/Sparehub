// Receipts as PDFs: build (80 mm till-roll style), download, print, and share on WhatsApp.
// Needs jsPDF (loaded before this file) plus api.js. Used by the Sales page and the POS.
const Receipt = (() => {
  const money = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const W = 80, M = 5, CW = W - M * 2;
  const methodLabel = (m) => ({ mpesa: 'M-Pesa', bank_transfer: 'Bank', card: 'Card', cash: 'Cash' }[m] || m);

  /** Loads the receipt data for a sale. phone is optional (used for the WhatsApp link). */
  async function load(saleId, phone) {
    const q = phone ? '?phone=' + encodeURIComponent(phone) : '';
    return (await api(`/sales/${saleId}/receipt${q}`)).data; // { receipt, text, whatsapp_link }
  }

  function draw(doc, r) {
    let y = 8;
    const center = (t, size, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.splitTextToSize(String(t), CW).forEach((ln) => { doc.text(ln, W / 2, y, { align: 'center' }); y += size * 0.45; }); };
    const row = (l, rt, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8); doc.text(String(l), M, y); doc.text(String(rt), W - M, y, { align: 'right' }); y += 4; };
    const rule = () => { doc.setDrawColor(180); doc.setLineDashPattern([0.6, 0.8], 0); doc.line(M, y, W - M, y); doc.setLineDashPattern([], 0); y += 4; };
    const b = r.branch || {};
    center(r.business_name || b.name || 'Receipt', 12, true); y += 1;
    center(`${b.name || ''}${b.town ? ', ' + b.town : ''}`, 8);
    if (b.address) center(b.address, 7.5);
    if (b.phone) center('Tel: ' + b.phone, 8);
    if (b.kra_pin) center('KRA PIN: ' + b.kra_pin, 7.5);
    if (b.receipt_header) center(b.receipt_header, 7.5);
    y += 2; rule();
    if (r.status === 'voided') { doc.setTextColor(200, 40, 40); center('*** VOIDED ***', 11, true); doc.setTextColor(0); y += 1; }
    row('Receipt', r.receipt_no, true);
    row('Date', new Date(r.sold_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }));
    row('Served by', r.cashier_name || '');
    if (r.customer_name) row('Customer', r.customer_name);
    rule();
    (r.items || []).forEach((it) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.splitTextToSize(String(it.description), CW).forEach((ln) => { doc.text(ln, M, y); y += 3.6; });
      doc.setTextColor(90); row(`${Number(it.quantity)} x ${money(it.unit_price)}${Number(it.discount_amount) > 0 ? ' (-' + money(it.discount_amount) + ')' : ''}`, money(it.line_total)); doc.setTextColor(0);
    });
    rule();
    const tax = (r.items || []).reduce((a, it) => a + Number(it.tax_amount || 0), 0);
    if (Number(r.discount_total) > 0) row('Discount', '-' + money(r.discount_total));
    if (tax > 0) row('VAT included', money(tax));
    if (Number(r.returned_total) > 0) row('Returned', '-' + money(r.returned_total));
    row('TOTAL', money(r.total - r.returned_total), true); y += 1;
    (r.payments || []).filter((p) => !p.voided_at).forEach((p) => row(`${p.direction === 'out' ? 'Refunded' : 'Paid'} ${methodLabel(p.method)}${p.reference ? ' ' + p.reference : ''}`, money(p.amount)));
    if (Number(r.balance_due) > 0.004) { doc.setTextColor(200, 40, 40); row('BALANCE DUE', money(r.balance_due), true); doc.setTextColor(0); if (r.due_date) row('Pay by', String(r.due_date).slice(0, 10)); }
    if (b.mpesa_till_number && Number(r.balance_due) > 0.004) row('M-Pesa Till', b.mpesa_till_number, true);
    y += 2; rule();
    center(b.receipt_footer || 'Thank you for shopping with us!', 8);
    return y + 6;
  }

  /** Builds the PDF. Draws once on a tall page to measure, then again on a page cut to fit. */
  function pdf(r) {
    if (!window.jspdf) throw new Error('The PDF tool did not load. Check your internet connection and refresh.');
    const { jsPDF } = window.jspdf;
    const h = draw(new jsPDF({ unit: 'mm', format: [W, 600] }), r);
    const doc = new jsPDF({ unit: 'mm', format: [W, Math.max(h, 60)] });
    draw(doc, r);
    return doc;
  }
  const fileName = (r) => `receipt-${String(r.receipt_no).replace(/[^\w-]+/g, '_')}.pdf`;

  function download(r) { pdf(r).save(fileName(r)); }

  function print(r) {
    const doc = pdf(r); doc.autoPrint();
    const url = URL.createObjectURL(doc.output('blob'));
    const w = window.open(url, '_blank');
    if (!w) doc.save(fileName(r)); // pop-up blocked: give them the file instead
  }

  /**
   * Phones: opens the share sheet with the PDF attached, so WhatsApp can send the file itself.
   * Computers: browsers cannot attach a file to WhatsApp, so the PDF is downloaded and WhatsApp opens with the
   * receipt text and the customer's number ready; attach the downloaded PDF there.
   * Returns 'shared' | 'whatsapp' | 'cancelled'.
   */
  async function share(saleId, phone) {
    const d = await load(saleId, phone), r = d.receipt;
    const file = new File([pdf(r).output('blob')], fileName(r), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Receipt ${r.receipt_no}`, text: `Receipt ${r.receipt_no} from ${r.business_name || r.branch.name}` }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; /* otherwise fall through to WhatsApp */ }
    }
    download(r);
    if (d.whatsapp_link) window.open(d.whatsapp_link, '_blank', 'noopener');
    return 'whatsapp';
  }

  return { load, pdf, download, print, share, money };
})();