import { useEffect, useState } from 'react';
import type { Sesion } from '../db/db';
import { pedir, pedirJson } from '../lib/api';
import { horaCorta } from '../lib/utilidades';
import { BarraSuperior } from './comunes';

interface Evento {
  id: string;
  tipo: string;
  recibido: string;
  datos: Record<string, unknown>;
}

const NOMBRES: Record<string, string> = {
  'asistencia.EntradaRegistrada': 'Entrada',
  'asistencia.SalidaRegistrada': 'Salida',
  'ejecucion.ActividadIniciada': 'Inicio de actividad',
  'ejecucion.EvidenciaRecibida': 'Foto recibida',
  'ejecucion.ActividadFinalizada': 'Actividad finalizada',
};
const MOMENTOS: Record<string, string> = { ANTES: 'antes', DURANTE: 'durante', DESPUES: 'después' };
const MAXIMO = 100;

/**
 * Parses a Server-Sent Events stream read with fetch. fetch (not EventSource)
 * is used so the token goes in the Authorization header, never in the URL.
 */
async function leerSse(cuerpo: ReadableStream<Uint8Array>, alEvento: (tipo: string, id: string, data: string) => void) {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let resto = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;
    resto += decodificador.decode(value, { stream: true });
    const bloques = resto.split('\n\n');
    resto = bloques.pop() ?? '';
    for (const bloque of bloques) {
      let tipo = 'message';
      let id = '';
      const datos: string[] = [];
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith('event:')) tipo = linea.slice(6).trim();
        else if (linea.startsWith('id:')) id = linea.slice(3).trim();
        else if (linea.startsWith('data:')) datos.push(linea.slice(5).trimStart());
      }
      if (datos.length) alEvento(tipo, id, datos.join('\n'));
    }
  }
}

/** Real-time panel for administrators and supervisors. */
export function Monitor({ sesion }: { sesion: Sesion }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [conectado, setConectado] = useState(false);
  const [catalogo, setCatalogo] = useState<{ operarios: Record<string, string>; conjuntos: Record<string, string> }>({
    operarios: {},
    conjuntos: {},
  });

  useEffect(() => {
    pedirJson<typeof catalogo>('/monitoreo/catalogo').then(setCatalogo).catch(() => undefined);
  }, []);

  useEffect(() => {
    const control = new AbortController();
    let reintento: ReturnType<typeof setTimeout>;

    async function conectar() {
      try {
        const r = await pedir('/monitoreo/stream', { signal: control.signal, headers: { Accept: 'text/event-stream' } });
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
        setConectado(true);
        await leerSse(r.body, (tipo, id, data) => {
          if (tipo === 'latido') return;
          const evento: Evento = { id, tipo, recibido: new Date().toISOString(), datos: JSON.parse(data) };
          setEventos((lista) => (lista.some((e) => e.id === id) ? lista : [evento, ...lista].slice(0, MAXIMO)));
        });
      } catch {
        // fall through to reconnect
      }
      setConectado(false);
      if (!control.signal.aborted) reintento = setTimeout(conectar, 5_000);
    }
    void conectar();
    return () => {
      control.abort();
      clearTimeout(reintento);
    };
  }, []);

  async function verFoto(evidenciaId: string) {
    // Open the tab synchronously so pop-up blockers allow it, then load the signed URL.
    const ventana = window.open('', '_blank');
    try {
      const { url } = await pedirJson<{ url: string }>(`/ejecuciones/evidencias/${evidenciaId}/url`);
      if (ventana) ventana.location.href = url;
    } catch (e) {
      ventana?.close();
      window.alert(`No se pudo abrir la foto: ${(e as Error).message}`);
    }
  }

  const nombre = (mapa: Record<string, string>, id: unknown) => mapa[String(id)] ?? String(id ?? '').slice(0, 8);

  return (
    <>
      <BarraSuperior nombre={sesion.usuario.nombre} />
      <h1>Monitoreo en tiempo real</h1>
      <p className="tenue">
        {conectado ? 'Conectado.' : 'Conectando...'} Los datos llegan cuando cada operario sincroniza; la hora de captura es la
        del teléfono.
      </p>
      {eventos.length === 0 ? (
        <p className="tenue">Aún no hay eventos.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Operario / conjunto</th>
              <th>Captura</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => {
              const d = e.datos;
              const captura = (d.horaDispositivo ?? d.horaCaptura) as string | undefined;
              return (
                <tr key={e.id || e.recibido}>
                  <td>
                    {NOMBRES[e.tipo] ?? e.tipo}
                    {d.momento ? ` (${MOMENTOS[String(d.momento)] ?? d.momento})` : ''}
                    {d.inconsistenciaHora === true && <div className="malo">Hora inconsistente</div>}
                    {d.dentroGeocerca === false && <div className="malo">Fuera del conjunto</div>}
                  </td>
                  <td>
                    {nombre(catalogo.operarios, d.operarioId)}
                    <br />
                    <small>{nombre(catalogo.conjuntos, d.conjuntoId)}</small>
                  </td>
                  <td>
                    {horaCorta(captura)}
                    <br />
                    <small>recibido {horaCorta(e.recibido)}</small>
                  </td>
                  <td>
                    {e.tipo === 'ejecucion.EvidenciaRecibida' && (
                      <button onClick={() => verFoto(String(d.evidenciaId))}>Ver foto</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
