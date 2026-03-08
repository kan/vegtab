/**
 * Minimal QR Code generator for SVG output.
 * Supports alphanumeric mode, error correction level L, versions 1-4.
 * Sufficient for short share codes (6-8 chars).
 */

// --- GF(256) arithmetic for Reed-Solomon ---
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function rsEncode(data: number[], ecLen: number): number[] {
  // Generator polynomial
  const gen: number[] = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], EXP[i]);
    }
    gen.length = 0;
    gen.push(...next);
  }
  const msg = [...data, ...new Array(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// --- QR constants ---
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// Version info: [totalCodewords, ecCodewords, dataCodewords] for EC level L
const VERSION_INFO: [number, number, number][] = [
  [0, 0, 0],       // placeholder for index 0
  [26, 7, 19],     // v1: 21x21
  [44, 10, 34],    // v2: 25x25
  [70, 15, 55],    // v3: 29x29
  [100, 18, 80],   // v4: 33x33
];

// Alphanumeric capacity per version (EC level L)
const ALPHA_CAPACITY = [0, 25, 47, 77, 114];

function encodeAlphanumeric(text: string): number[] {
  const bits: number[] = [];
  // Mode indicator: alphanumeric = 0010
  bits.push(0, 0, 1, 0);
  // Determine version for character count length
  const version = selectVersion(text.length);
  const ccBits = version <= 1 ? 9 : 11;
  // Character count
  for (let i = ccBits - 1; i >= 0; i--) bits.push((text.length >> i) & 1);
  // Encode pairs
  for (let i = 0; i < text.length; i += 2) {
    const a = ALPHANUMERIC.indexOf(text[i]);
    if (i + 1 < text.length) {
      const b = ALPHANUMERIC.indexOf(text[i + 1]);
      const val = a * 45 + b;
      for (let j = 10; j >= 0; j--) bits.push((val >> j) & 1);
    } else {
      for (let j = 5; j >= 0; j--) bits.push((a >> j) & 1);
    }
  }
  return bits;
}

function selectVersion(len: number): number {
  for (let v = 1; v <= 4; v++) {
    if (len <= ALPHA_CAPACITY[v]) return v;
  }
  return 4;
}

function bitsToBytes(bits: number[], totalBytes: number): number[] {
  // Add terminator (up to 4 zeros)
  const maxBits = totalBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  // Pad to byte boundary
  while (bits.length % 8 !== 0 && bits.length < maxBits) bits.push(0);
  // Convert to bytes
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    bytes.push(b);
  }
  // Pad with alternating bytes
  const pads = [0xEC, 0x11];
  let pi = 0;
  while (bytes.length < totalBytes) {
    bytes.push(pads[pi % 2]);
    pi++;
  }
  return bytes;
}

// --- Module placement ---

function createMatrix(version: number): { size: number; modules: number[][]; reserved: boolean[][] } {
  const size = 17 + version * 4;
  const modules = Array.from({ length: size }, () => new Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  return { size, modules, reserved };
}

function setModule(m: { modules: number[][]; reserved: boolean[][] }, r: number, c: number, val: number, reserve = true) {
  m.modules[r][c] = val;
  m.reserved[r][c] = reserve;
}

function placeFinder(m: { modules: number[][]; reserved: boolean[][]; size: number }, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      const inOuter = r === -1 || r === 7 || c === -1 || c === 7;
      const inBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setModule(m, rr, cc, (inBorder || inInner) && !inOuter ? 1 : 0);
    }
  }
}

function placeTiming(m: { modules: number[][]; reserved: boolean[][]; size: number }) {
  for (let i = 8; i < m.size - 8; i++) {
    const val = i % 2 === 0 ? 1 : 0;
    if (!m.reserved[6][i]) setModule(m, 6, i, val);
    if (!m.reserved[i][6]) setModule(m, i, 6, val);
  }
}

function reserveFormatBits(m: { modules: number[][]; reserved: boolean[][]; size: number }) {
  // Reserve format info areas
  for (let i = 0; i < 8; i++) {
    if (!m.reserved[8][i]) m.reserved[8][i] = true;
    if (!m.reserved[i][8]) m.reserved[i][8] = true;
    if (!m.reserved[8][m.size - 1 - i]) m.reserved[8][m.size - 1 - i] = true;
    if (!m.reserved[m.size - 1 - i][8]) m.reserved[m.size - 1 - i][8] = true;
  }
  m.reserved[8][8] = true;
  // Dark module
  setModule(m, m.size - 8, 8, 1);
}

function placeData(m: { modules: number[][]; reserved: boolean[][]; size: number }, data: number[]) {
  let bitIdx = 0;
  const bits: number[] = [];
  for (const b of data) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }

  let upward = true;
  for (let col = m.size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5; // Skip timing column
    const rows = upward
      ? Array.from({ length: m.size }, (_, i) => m.size - 1 - i)
      : Array.from({ length: m.size }, (_, i) => i);
    for (const row of rows) {
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (c < 0 || m.reserved[row][c]) continue;
        m.modules[row][c] = bitIdx < bits.length ? bits[bitIdx] : 0;
        bitIdx++;
      }
    }
    upward = !upward;
  }
}

// Mask pattern 0: (row + col) % 2 === 0
function applyMask(m: { modules: number[][]; reserved: boolean[][]; size: number }) {
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.reserved[r][c] && (r + c) % 2 === 0) {
        m.modules[r][c] ^= 1;
      }
    }
  }
}

function placeFormatInfo(m: { modules: number[][]; size: number }) {
  // EC level L (01) + mask 0 (000) = 01000
  // Format info with BCH error correction for L/mask0 = 0x77C0...
  // Pre-computed: EC L, mask 0 → format bits = 111011111000100
  const formatBits = 0b111011111000100;

  // Around top-left finder
  const positions1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    m.modules[positions1[i][0]][positions1[i][1]] = (formatBits >> (14 - i)) & 1;
  }
  // Around other finders
  const positions2: [number, number][] = [];
  for (let i = 0; i < 7; i++) positions2.push([m.size - 1 - i, 8]);
  for (let i = 0; i < 8; i++) positions2.push([8, m.size - 8 + i]);
  for (let i = 0; i < 15; i++) {
    m.modules[positions2[i][0]][positions2[i][1]] = (formatBits >> i) & 1;
  }
}

export function generateQrMatrix(text: string): number[][] {
  const version = selectVersion(text.length);
  const [totalCw, ecCw, dataCw] = VERSION_INFO[version];

  const bits = encodeAlphanumeric(text.toUpperCase());
  const dataBytes = bitsToBytes(bits, dataCw);
  const ecBytes = rsEncode(dataBytes, ecCw);
  const allBytes = [...dataBytes, ...ecBytes];

  // Ensure we have exactly totalCw bytes
  while (allBytes.length < totalCw) allBytes.push(0);

  const m = createMatrix(version);

  // Place finder patterns
  placeFinder(m, 0, 0);
  placeFinder(m, 0, m.size - 7);
  placeFinder(m, m.size - 7, 0);

  placeTiming(m);
  reserveFormatBits(m);
  placeData(m, allBytes);
  applyMask(m);
  placeFormatInfo(m);

  return m.modules;
}

function renderQrRects(matrix: number[][], offsetX: number, offsetY: number, scale: number, margin: number): string {
  const parts: string[] = [];
  const moduleCount = matrix.length;
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        const x = offsetX + (c + margin) * scale;
        const y = offsetY + (r + margin) * scale;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${scale.toFixed(1)}" height="${scale.toFixed(1)}"/>`);
      }
    }
  }
  return parts.join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateQrSvg(text: string, size = 200, margin = 2): string {
  const matrix = generateQrMatrix(text);
  const totalModules = matrix.length + margin * 2;
  const scale = size / totalModules;
  const paths = renderQrRects(matrix, 0, 0, scale, margin);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#fff"/>
<g fill="#333">${paths}</g>
</svg>`;
}

/** Generate an OGP-ready SVG image containing QR code, title, and description */
export function generateOgpSvg(shareCode: string, shareUrl: string, description: string): string {
  const width = 1200;
  const height = 630;
  const qrSize = 240;
  const qrMargin = 2;

  const matrix = generateQrMatrix(shareUrl);
  const totalModules = matrix.length + qrMargin * 2;
  const scale = qrSize / totalModules;

  const qrX = width - qrSize - 80;
  const qrY = (height - qrSize) / 2;
  const qrPaths = renderQrRects(matrix, qrX, qrY, scale, qrMargin);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="${width}" height="${height}" fill="#f5f0e8"/>
<text x="80" y="200" font-family="sans-serif" font-size="64" font-weight="800" fill="#4CAF50">Tomado</text>
<text x="80" y="280" font-family="sans-serif" font-size="36" font-weight="700" fill="#333" letter-spacing="0.15em">${escapeXml(shareCode)}</text>
<text x="80" y="340" font-family="sans-serif" font-size="22" fill="#666">${escapeXml(description)}</text>
<text x="80" y="500" font-family="sans-serif" font-size="18" fill="#999">TODO x 3-Match Puzzle</text>
<rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" rx="8" fill="#fff"/>
<g fill="#333">${qrPaths}</g>
</svg>`;
}
