'use strict';
/**
 * Draws the volunteer ID card as a PNG (1011 x 638 px = 3.37 x 2.125 in at 300 dpi)
 * and wraps the same picture into a card-size PDF. Fonts are bundled in /fonts so the
 * result looks the same on any server.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');

const root = path.join(__dirname, '..');
GlobalFonts.registerFromPath(path.join(root, 'fonts', 'DejaVuSans.ttf'), 'NMSans');
GlobalFonts.registerFromPath(path.join(root, 'fonts', 'DejaVuSans-Bold.ttf'), 'NMSansBold');
GlobalFonts.registerFromPath(path.join(root, 'fonts', 'DejaVuSerif-Bold.ttf'), 'NMSerifBold');
GlobalFonts.registerFromPath(path.join(root, 'fonts', 'DejaVuSansMono-Bold.ttf'), 'NMMonoBold');

const NAVY = '#0B2559'; const GOLD = '#C9A227'; const IVORY = '#FBF7EC';
const W = 1011; const H = 638;

function fitText(ctx, text, font, maxWidth, startPx, minPx) {
  let px = startPx;
  do { ctx.font = `${px}px ${font}`; if (ctx.measureText(text).width <= maxWidth) break; px -= 2; } while (px > minPx);
  return px;
}
function wrap(ctx, text, maxWidth) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * card = { name, country, department, volunteerId, issuedAt, expiresAt, state, photoPath, verifyUrl }
 */
async function renderCardPng(card, root_ = root) {
  const c = createCanvas(W, H); const ctx = c.getContext('2d');
  ctx.fillStyle = IVORY; ctx.fillRect(0, 0, W, H);
  // header
  ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = GOLD; ctx.fillRect(0, 150, W, 8);
  const logo = await loadImage(path.join(root_, 'public', 'img', 'logo.png'));
  ctx.drawImage(logo, 24, 12, 126, 126);
  ctx.fillStyle = GOLD; ctx.font = '48px NMSerifBold'; ctx.textBaseline = 'alphabetic'; ctx.fillText('NISMCAA', 175, 70);
  ctx.fillStyle = '#FFFFFF'; ctx.font = '17px NMSans';
  ctx.fillText('National Inter-School Music Competition', 177, 100);
  ctx.fillText('& Academic Award', 177, 124);
  ctx.fillStyle = GOLD; ctx.font = '22px NMSansBold'; ctx.textAlign = 'right'; ctx.fillText('VOLUNTEER ID', W - 36, 62); ctx.textAlign = 'left';
  // photo
  const px = 40; const py = 190;
  ctx.fillStyle = GOLD; ctx.fillRect(px - 6, py - 6, 224, 224);
  if (card.photoPath && fs.existsSync(card.photoPath)) ctx.drawImage(await loadImage(card.photoPath), px, py, 212, 212);
  else { ctx.fillStyle = '#ddd'; ctx.fillRect(px, py, 212, 212); }
  // text
  const tx = 290; const maxW = 470;
  ctx.fillStyle = NAVY;
  const namePx = fitText(ctx, card.name, 'NMSerifBold', maxW, 40, 22);
  ctx.font = `${namePx}px NMSerifBold`;
  let y = 235;
  const nameLines = wrap(ctx, card.name, maxW).slice(0, 2);
  nameLines.forEach((l) => { ctx.fillText(l, tx, y); y += namePx + 6; });
  ctx.fillStyle = GOLD; ctx.fillRect(tx, y - 18, 90, 4);
  y += 12;
  const row = (label, value) => {
    ctx.fillStyle = '#6b5a1a'; ctx.font = '15px NMSansBold'; ctx.fillText(label.toUpperCase(), tx, y);
    ctx.fillStyle = NAVY; ctx.font = '23px NMSans';
    const f = fitText(ctx, value, 'NMSans', maxW, 23, 15); ctx.font = `${f}px NMSans`;
    ctx.fillText(value, tx, y + 27); y += 62;
  };
  row('Role', 'Volunteer');
  row('Country', card.country);
  row('Department', card.department);
  // ID number
  ctx.fillStyle = '#6b5a1a'; ctx.font = '15px NMSansBold'; ctx.fillText('ID NUMBER', px, 450);
  ctx.fillStyle = NAVY; ctx.font = '25px NMMonoBold'; ctx.fillText(card.volunteerId, px, 482);
  // QR
  const qr = await loadImage(await QRCode.toBuffer(card.verifyUrl, { margin: 1, width: 330, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#FFFFFF' } }));
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(792, 196, 190, 190);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.strokeRect(792, 196, 190, 190);
  ctx.drawImage(qr, 798, 202, 178, 178);
  ctx.fillStyle = NAVY; ctx.font = '15px NMSansBold'; ctx.textAlign = 'center'; ctx.fillText('SCAN TO VERIFY', 887, 410); ctx.textAlign = 'left';
  // state stamp
  if (card.state && card.state !== 'VALID') {
    ctx.save(); ctx.translate(760, 520); ctx.rotate(-0.15); ctx.strokeStyle = '#B00020'; ctx.fillStyle = '#B00020'; ctx.lineWidth = 6;
    ctx.font = '44px NMSansBold'; const t = card.state; const w = ctx.measureText(t).width; ctx.strokeRect(-14, -48, w + 28, 66); ctx.fillText(t, 0, 0); ctx.restore();
  }
  // footer
  ctx.fillStyle = NAVY; ctx.fillRect(0, 548, W, 90);
  ctx.fillStyle = GOLD; ctx.fillRect(0, 548, W, 5);
  ctx.fillStyle = '#FFFFFF'; ctx.font = '19px NMSans';
  ctx.fillText(`Issued ${card.issuedAt}   |   Valid until ${card.expiresAt}`, 40, 588);
  ctx.fillStyle = GOLD; ctx.font = '15px NMSans';
  ctx.fillText('Valid for 1 year. Renewable subject to performance. Not access to children.', 40, 616);
  return c.toBuffer('image/png');
}

function pngToPdf(png) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [242.64, 153], margin: 0, info: { Title: 'NISMCAA Volunteer ID', Author: 'NISMCAA' } });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.image(png, 0, 0, { width: 242.64, height: 153 });
    doc.end();
  });
}

module.exports = { renderCardPng, pngToPdf };
