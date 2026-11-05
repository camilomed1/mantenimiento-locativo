/**
 * Client-side photo compression (critical decision #4). A 3-8 MB camera
 * photo becomes a ~300 KB JPEG before it is stored or sent, which matters on
 * 2 GB RAM phones and slow connections.
 */
const LADO_MAXIMO = 1280;
const OBJETIVO_BYTES = 350_000;
const LIMITE_SERVIDOR = 2 * 1024 * 1024;
const CALIDADES = [0.75, 0.65, 0.55, 0.45, 0.35];

async function decodificar(archivo: Blob): Promise<ImageBitmap> {
  try {
    // Respect the EXIF rotation of phone photos.
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(archivo);
  }
}

function lienzo(ancho: number, alto: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(ancho, alto);
    return { ctx: c.getContext('2d')!, aBlob: (q: number) => c.convertToBlob({ type: 'image/jpeg', quality: q }) };
  }
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = alto;
  return {
    ctx: c.getContext('2d')!,
    aBlob: (q: number) =>
      new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo comprimir'))), 'image/jpeg', q)),
  };
}

async function redimensionar(bmp: ImageBitmap, ladoMaximo: number, calidades: number[], objetivo: number): Promise<Blob> {
  const escala = Math.min(1, ladoMaximo / Math.max(bmp.width, bmp.height));
  const ancho = Math.round(bmp.width * escala);
  const alto = Math.round(bmp.height * escala);
  const { ctx, aBlob } = lienzo(ancho, alto);
  ctx.drawImage(bmp, 0, 0, ancho, alto);
  let blob = await aBlob(calidades[0]);
  for (const q of calidades.slice(1)) {
    if (blob.size <= objetivo) break;
    blob = await aBlob(q);
  }
  return blob;
}

export interface FotoProcesada {
  blob: Blob;
  miniatura: Blob;
  sha256: string;
}

export async function procesarFoto(archivo: Blob): Promise<FotoProcesada> {
  const bmp = await decodificar(archivo);
  try {
    const blob = await redimensionar(bmp, LADO_MAXIMO, CALIDADES, OBJETIVO_BYTES);
    if (blob.size > LIMITE_SERVIDOR) throw new Error('La foto es demasiado grande incluso comprimida');
    const miniatura = await redimensionar(bmp, 240, [0.6], Infinity);
    return { blob, miniatura, sha256: await sha256Hex(blob) };
  } finally {
    bmp.close();
  }
}

/** SHA-256 of the exact bytes that will be uploaded; the server re-checks it. */
export async function sha256Hex(blob: Blob): Promise<string> {
  if (!crypto.subtle) {
    throw new Error('Esta función requiere HTTPS. Abra la aplicación con https:// o desde localhost.');
  }
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
