import qrcode from 'qrcode-generator';

/** QR em SVG escalável. Usado só para o payload de DEMONSTRAÇÃO; o QR real virá do gateway. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
