// Codificador QR mínimo, sin dependencias (el proyecto no tiene librería
// de QR instalada y la tarea prohíbe añadir dependencias pesadas).
//
// Cubre ISO/IEC 18004 para el rango que necesitamos: modo byte, nivel
// de corrección L, máscara 0, versiones 1–10 (hasta 271 bytes — de sobra
// para el enlace del perfil). La máscara 0 es una máscara válida: no
// hace falta evaluar ni puntuar máscaras.
//
// El enlace del perfil se codifica en cliente, sin enviar nada a ningún
// servicio externo.

export interface QrCode {
  version: number;
  size: number;
  /** modules[fila][columna], true = módulo oscuro. */
  modules: boolean[][];
}

// Por versión (1–10): [bloques grupo 1, codewords de datos por bloque
// grupo 1, bloques grupo 2, codewords de datos por bloque grupo 2].
const BLOCKS: Array<[number, number, number, number]> = [
  [1, 19, 0, 0],
  [1, 34, 0, 0],
  [1, 55, 0, 0],
  [1, 80, 0, 0],
  [1, 108, 0, 0],
  [2, 68, 0, 0],
  [2, 78, 0, 0],
  [2, 97, 0, 0],
  [2, 116, 0, 0],
  [2, 68, 2, 69],
];

// Codewords de corrección por bloque, por versión (nivel L).
const ECC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];

// Posiciones de los patrones de alineación, por versión.
const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// Bits de resto, por versión.
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

const MAX_BYTES = 271;

function dataCodewords(version: number): number {
  const [g1n, g1d, g2n, g2d] = BLOCKS[version - 1];
  return g1n * g1d + g2n * g2d;
}

function byteCapacity(version: number): number {
  // Modo byte: 4 bits de modo + 8 bits de conteo (v1–9) o 16 (v10).
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}

function chooseVersion(byteLength: number): number {
  for (let v = 1; v <= 10; v++) {
    if (byteLength <= byteCapacity(v)) return v;
  }
  throw new Error(`El texto es demasiado largo para el QR (máx. ${MAX_BYTES} bytes).`);
}

// ---------- Galois field GF(256) y Reed–Solomon ----------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[result.length - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

// ---------- Información de formato y de versión (BCH) ----------

/** Bits de formato (15) para nivel L (01) y máscara dada. */
export function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** Bits de versión (18) para versiones 7–10. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return (version << 12) | rem;
}

function bitAt(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

// ---------- Codificación ----------

export function encodeQr(text: string): QrCode {
  if (!text) throw new Error("El texto del QR no puede estar vacío.");
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const size = version * 4 + 17;
  const eccLen = ECC_PER_BLOCK[version - 1];
  const [g1n, g1d, g2n, g2d] = BLOCKS[version - 1];

  // --- Flujo de bits: modo 0100, conteo, datos, terminador, relleno.
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacityBits = dataCodewords(version) * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  put(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i++) put(padBytes[i % 2], 8);

  // --- Codewords de datos y ECC por bloque, intercalados.
  const dataCw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let cw = 0;
    for (let j = 0; j < 8; j++) cw = (cw << 1) | bits[i + j];
    dataCw.push(cw);
  }
  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < g1n; i++) {
    blocks.push(dataCw.slice(offset, offset + g1d));
    offset += g1d;
  }
  for (let i = 0; i < g2n; i++) {
    blocks.push(dataCw.slice(offset, offset + g2d));
    offset += g2d;
  }
  const divisor = rsDivisor(eccLen);
  const eccBlocks = blocks.map((b) => rsRemainder(b, divisor));
  const finalBits: number[] = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) if (i < b.length) {
      for (let j = 7; j >= 0; j--) finalBits.push((b[i] >>> j) & 1);
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (const b of eccBlocks) {
      for (let j = 7; j >= 0; j--) finalBits.push((b[i] >>> j) & 1);
    }
  }
  for (let i = 0; i < REMAINDER_BITS[version - 1]; i++) finalBits.push(0);

  // --- Matriz: patrones de función.
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null),
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const set = (x: number, y: number, dark: boolean, fn = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    if (fn) isFunction[y][x] = true;
  };
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        // Anillo exterior oscuro (dist 3), centro oscuro (dist 0–1),
        // anillos claros en dist 2 y 4 (el 4 es el separador).
        set(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };
  // Temporización ANTES que los finders: el finder gana en el solape.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);
  // Alineación (se saltan las tres esquinas de los finders).
  const pos = ALIGNMENT[version - 1];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === pos.length - 1) ||
        (i === pos.length - 1 && j === 0)
      ) {
        continue;
      }
      const cx = pos[i];
      const cy = pos[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // Módulo oscuro y reserva de formato/versión.
  set(8, size - 8, true);
  const fmt = formatBits(0);
  for (let i = 0; i <= 5; i++) set(8, i, bitAt(fmt, i));
  set(8, 7, bitAt(fmt, 6));
  set(8, 8, bitAt(fmt, 7));
  set(7, 8, bitAt(fmt, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bitAt(fmt, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitAt(fmt, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitAt(fmt, i));
  if (version >= 7) {
    const ver = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = bitAt(ver, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // --- Datos en zigzag, máscara 0: se invierte si (fila + col) es par.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < finalBits.length) {
          let bit = finalBits[bitIndex];
          if ((y + x) % 2 === 0) bit ^= 1;
          modules[y][x] = bit === 1;
          bitIndex++;
        }
      }
    }
  }
  if (bitIndex !== finalBits.length) {
    throw new Error("Error interno del QR: no caben los bits de datos.");
  }
  return {
    version,
    size,
    modules: modules as boolean[][],
  };
}
