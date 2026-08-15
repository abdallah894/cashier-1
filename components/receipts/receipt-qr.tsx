import QRCode from "qrcode";

/**
 * Synchronous SVG QR — no canvas, no effects, no async. Renders
 * server-side, so the code is guaranteed on the page before the print
 * dialog can open (a data-URL <img> could still be loading).
 */
export function ReceiptQr({ value, className }: { value: string; className?: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={value}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
