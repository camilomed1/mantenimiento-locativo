import { db, nuevoInfoSync, type ActividadAgenda, type Ejecucion, type Foto, type Marca, type Momento } from '../db/db';
import { procesarFoto } from '../lib/fotos';
import { obtenerUbicacion } from '../lib/ubicacion';
import { distanciaMetros, fechaLocal, nuevoUuid } from '../lib/utilidades';
import { motor } from './motor';

/** A local rule was broken; the message is shown to the operator as is. */
export class ErrorLocal extends Error {}

export const MOMENTOS: Momento[] = ['ANTES', 'DURANTE', 'DESPUES'];

/** Fire-and-forget sync after every local action (no-op when offline). */
function intentarEnviar(): void {
  void motor.sincronizar();
}

/**
 * The operator's actions. Each one is saved in IndexedDB first, with the
 * device time and a client_uuid, so it works with no signal at all. The local
 * checks mirror the server rules to give immediate feedback; the server is
 * still the final authority.
 */
export async function registrarMarca(conjuntoId: string, tipo: 'ENTRADA' | 'SALIDA', ahora = new Date()): Promise<Marca> {
  const fecha = fechaLocal(ahora);
  const delDia = await db.marcas.filter((m) => m.fecha === fecha && m.sync !== 'RECHAZADO').toArray();
  const enSitio = delDia.filter((m) => m.conjuntoId === conjuntoId);

  if (tipo === 'ENTRADA') {
    if (enSitio.some((m) => m.tipo === 'ENTRADA')) throw new ErrorLocal('Ya registró la entrada en este conjunto hoy.');
    const abierta = delDia.find(
      (e) => e.tipo === 'ENTRADA' && !delDia.some((s) => s.tipo === 'SALIDA' && s.conjuntoId === e.conjuntoId),
    );
    if (abierta) throw new ErrorLocal('Tiene una entrada abierta en otro conjunto. Registre primero la salida.');
  } else {
    if (!enSitio.some((m) => m.tipo === 'ENTRADA')) throw new ErrorLocal('Debe registrar la entrada antes de la salida.');
    if (enSitio.some((m) => m.tipo === 'SALIDA')) throw new ErrorLocal('Ya registró la salida de este conjunto hoy.');
  }

  // The time is taken when the button is pressed, before waiting for GPS.
  const horaDispositivo = ahora.toISOString();
  const ubicacion = await obtenerUbicacion();
  const conjunto = (await db.agenda.filter((a) => a.conjunto.id === conjuntoId).first())?.conjunto;
  const dentroGeocerca =
    ubicacion && conjunto
      ? distanciaMetros(ubicacion.latitud, ubicacion.longitud, conjunto.latitud, conjunto.longitud) -
          Math.min(ubicacion.precisionMetros, conjunto.radioGeocercaMetros) <=
        conjunto.radioGeocercaMetros
      : null;

  const marca: Marca = {
    clientUuid: nuevoUuid(),
    conjuntoId,
    fecha,
    tipo,
    horaDispositivo,
    ubicacion,
    dentroGeocerca,
    ...nuevoInfoSync(),
  };
  await db.marcas.add(marca);
  intentarEnviar();
  return marca;
}

export async function iniciarActividad(actividad: ActividadAgenda, ahora = new Date()): Promise<Ejecucion> {
  const fecha = fechaLocal(ahora);
  if (actividad.fecha !== fecha) throw new ErrorLocal('Solo puede iniciar actividades programadas para hoy.');
  if (actividad.ejecucionServidor) throw new ErrorLocal('Esta actividad ya fue iniciada desde otro dispositivo.');

  const marcas = await db.marcas
    .where('[fecha+conjuntoId]')
    .equals([fecha, actividad.conjunto.id])
    .filter((m) => m.sync !== 'RECHAZADO')
    .toArray();
  if (!marcas.some((m) => m.tipo === 'ENTRADA')) throw new ErrorLocal('Registre la entrada al conjunto antes de iniciar.');
  if (marcas.some((m) => m.tipo === 'SALIDA')) throw new ErrorLocal('Ya registró la salida de este conjunto.');

  const ejecucion: Ejecucion = {
    clientUuid: nuevoUuid(),
    programacionId: actividad.programacionId,
    fecha,
    horaInicio: ahora.toISOString(),
    inicio: nuevoInfoSync(),
    horaFin: null,
    observaciones: null,
    fin: null,
  };
  try {
    await db.ejecuciones.add(ejecucion); // &programacionId: one execution per activity
  } catch {
    throw new ErrorLocal('La actividad ya fue iniciada.');
  }
  intentarEnviar();
  return ejecucion;
}

export async function agregarFoto(ejecucionClientUuid: string, momento: Momento, archivo: Blob): Promise<Foto> {
  const ejecucion = await db.ejecuciones.get(ejecucionClientUuid);
  if (!ejecucion) throw new ErrorLocal('Inicie la actividad antes de tomar fotos.');
  if (ejecucion.fin) throw new ErrorLocal('La actividad ya fue finalizada.');

  const anterior = await db.fotos
    .where('ejecucionClientUuid')
    .equals(ejecucionClientUuid)
    .filter((f) => f.momento === momento)
    .first();
  if (anterior && anterior.sync === 'SINCRONIZADO') throw new ErrorLocal('Esta foto ya fue enviada y no se puede cambiar.');

  const horaCaptura = new Date().toISOString();
  const [procesada, ubicacion] = await Promise.all([procesarFoto(archivo), obtenerUbicacion(5_000)]);

  const foto: Foto = {
    clientUuid: nuevoUuid(),
    ejecucionClientUuid,
    momento,
    blob: procesada.blob,
    miniatura: procesada.miniatura,
    sha256: procesada.sha256,
    mimeType: 'image/jpeg',
    tamanoBytes: procesada.blob.size,
    horaCaptura,
    ubicacion,
    ...nuevoInfoSync(),
  };
  await db.transaction('rw', db.fotos, async () => {
    // A photo not sent yet can be retaken; it is replaced, never duplicated.
    if (anterior) await db.fotos.delete(anterior.clientUuid);
    await db.fotos.add(foto);
  });
  intentarEnviar();
  return foto;
}

export async function finalizarActividad(ejecucionClientUuid: string, observaciones: string, ahora = new Date()): Promise<void> {
  const ejecucion = await db.ejecuciones.get(ejecucionClientUuid);
  if (!ejecucion) throw new ErrorLocal('La actividad no ha sido iniciada.');
  if (ejecucion.fin) throw new ErrorLocal('La actividad ya fue finalizada.');
  const fotos = await db.fotos.where('ejecucionClientUuid').equals(ejecucionClientUuid).toArray();
  const faltan = MOMENTOS.filter((m) => !fotos.some((f) => f.momento === m && f.sync !== 'RECHAZADO'));
  if (faltan.length) throw new ErrorLocal(`Faltan fotos: ${faltan.map(nombreMomento).join(', ')}.`);

  await db.ejecuciones.update(ejecucionClientUuid, {
    horaFin: ahora.toISOString(),
    observaciones: observaciones.trim() || null,
    fin: nuevoInfoSync(),
  });
  intentarEnviar();
}

export function nombreMomento(m: Momento): string {
  return { ANTES: 'Antes', DURANTE: 'Durante', DESPUES: 'Después' }[m];
}
