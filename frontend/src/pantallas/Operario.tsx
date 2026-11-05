import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, type ActividadAgenda, type ConjuntoAgenda, type Ejecucion, type Marca, type Sesion } from '../db/db';
import { diaLargo, fechaLocal, horaCorta } from '../lib/utilidades';
import { ErrorLocal, registrarMarca } from '../sync/acciones';
import { Actividad } from './Actividad';
import { BarraSuperior, EstadoSync } from './comunes';

export function Operario({ sesion }: { sesion: Sesion }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <>
      <BarraSuperior nombre={sesion.usuario.nombre} />
      {abierta ? <Actividad programacionId={abierta} volver={() => setAbierta(null)} /> : <Hoy abrir={setAbierta} />}
    </>
  );
}

function estadoActividad(a: ActividadAgenda, e: Ejecucion | undefined): string {
  if (e?.fin) return 'Finalizada';
  if (e) return 'En curso';
  if (a.ejecucionServidor) return a.ejecucionServidor.estado === 'FINALIZADA' ? 'Finalizada (otro dispositivo)' : 'Iniciada (otro dispositivo)';
  return 'Por hacer';
}

function Hoy({ abrir }: { abrir: (programacionId: string) => void }) {
  const hoy = fechaLocal();
  const datos = useLiveQuery(async () => {
    const [agenda, marcas, ejecuciones] = await Promise.all([
      db.agenda.orderBy('fecha').toArray(),
      db.marcas.filter((m) => m.fecha === hoy).toArray(),
      db.ejecuciones.toArray(),
    ]);
    const rechazadas = (await db.marcas.where('sync').equals('RECHAZADO').toArray()).filter((m) => m.fecha >= hoy);
    return { agenda, marcas, ejecuciones, rechazadas };
  }, [hoy]);
  if (!datos) return null;

  const deHoy = datos.agenda.filter((a) => a.fecha === hoy);
  const proximas = datos.agenda.filter((a) => a.fecha > hoy);
  const conjuntos = [...new Map(deHoy.map((a) => [a.conjunto.id, a.conjunto])).values()];

  return (
    <>
      <h1>{diaLargo(hoy)}</h1>
      {datos.agenda.length === 0 && (
        <div className="aviso">No hay programación descargada. Conéctese a internet y pulse Sincronizar.</div>
      )}
      {deHoy.length === 0 && datos.agenda.length > 0 && <p className="tenue">No tiene actividades programadas para hoy.</p>}

      {conjuntos.map((c) => (
        <TarjetaConjunto
          key={c.id}
          conjunto={c}
          actividades={deHoy.filter((a) => a.conjunto.id === c.id)}
          marcas={datos.marcas.filter((m) => m.conjuntoId === c.id)}
          ejecuciones={datos.ejecuciones}
          abrir={abrir}
        />
      ))}

      {datos.rechazadas.length > 0 && (
        <>
          <h3>Registros rechazados</h3>
          <ul className="lista">
            {datos.rechazadas.map((m) => (
              <li key={m.clientUuid}>
                {m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} {horaCorta(m.horaDispositivo)} — <EstadoSync info={m} />
              </li>
            ))}
          </ul>
        </>
      )}

      {proximas.length > 0 && (
        <>
          <h3>Próximos días</h3>
          <ul className="lista">
            {proximas.map((a) => (
              <li key={a.programacionId}>
                {diaLargo(a.fecha)}: {a.actividad}
                <br />
                <small>{a.conjunto.nombre}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function TarjetaConjunto(props: {
  conjunto: ConjuntoAgenda;
  actividades: ActividadAgenda[];
  marcas: Marca[];
  ejecuciones: Ejecucion[];
  abrir: (programacionId: string) => void;
}) {
  const { conjunto, actividades, marcas, ejecuciones, abrir } = props;
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const validas = marcas.filter((m) => m.sync !== 'RECHAZADO');
  const entrada = validas.find((m) => m.tipo === 'ENTRADA');
  const salida = validas.find((m) => m.tipo === 'SALIDA');
  const enCurso = actividades.filter((a) => {
    const e = ejecuciones.find((x) => x.programacionId === a.programacionId);
    return e && !e.fin;
  });

  async function marcar(tipo: 'ENTRADA' | 'SALIDA') {
    if (tipo === 'SALIDA' && enCurso.length > 0 && !window.confirm('Hay actividades sin finalizar. ¿Registrar la salida de todos modos?')) {
      return;
    }
    setError('');
    setOcupado(true);
    try {
      await registrarMarca(conjunto.id, tipo);
    } catch (e) {
      setError(e instanceof ErrorLocal ? e.message : `No se pudo guardar: ${(e as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="caja">
      <h2>{conjunto.nombre}</h2>
      <small>{conjunto.direccion}</small>

      <table style={{ marginTop: 8 }}>
        <tbody>
          <FilaMarca nombre="Entrada" marca={entrada} />
          <FilaMarca nombre="Salida" marca={salida} />
        </tbody>
      </table>

      {error && <div className="error">{error}</div>}
      <div className="fila" style={{ marginTop: 8 }}>
        {!entrada && (
          <button className="principal" disabled={ocupado} onClick={() => marcar('ENTRADA')}>
            {ocupado ? 'Guardando...' : 'Registrar entrada'}
          </button>
        )}
        {entrada && !salida && (
          <button disabled={ocupado} onClick={() => marcar('SALIDA')}>
            {ocupado ? 'Guardando...' : 'Registrar salida'}
          </button>
        )}
      </div>

      <h3>Actividades</h3>
      <ul className="lista">
        {actividades.map((a) => {
          const e = ejecuciones.find((x) => x.programacionId === a.programacionId);
          return (
            <li key={a.programacionId} className="fila">
              <div style={{ flex: 3 }}>
                {a.actividad}
                <br />
                <small>{estadoActividad(a, e)}</small>
              </div>
              <button onClick={() => abrir(a.programacionId)}>Abrir</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilaMarca({ nombre, marca }: { nombre: string; marca?: Marca }) {
  return (
    <tr>
      <th style={{ width: 70 }}>{nombre}</th>
      <td>
        {marca ? (
          <>
            {horaCorta(marca.horaDispositivo)}
            {marca.dentroGeocerca === false && <small className="malo"> · fuera del conjunto</small>}
            {marca.ubicacion === null && <small className="tenue"> · sin GPS</small>}
            <br />
            <EstadoSync info={marca} />
          </>
        ) : (
          <span className="tenue">Sin registrar</span>
        )}
      </td>
    </tr>
  );
}
