import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db, type Foto, type Momento } from '../db/db';
import { useUrlBlob } from '../hooks';
import { fechaLocal, horaCorta } from '../lib/utilidades';
import { agregarFoto, ErrorLocal, finalizarActividad, iniciarActividad, MOMENTOS, nombreMomento } from '../sync/acciones';
import { EstadoSync } from './comunes';

const SERVICIOS: Record<string, string> = { PISCINA: 'Piscina', PINTURA: 'Pintura', JARDINERIA: 'Jardinería', OTRO: 'Otro' };

export function Actividad({ programacionId, volver }: { programacionId: string; volver: () => void }) {
  const datos = useLiveQuery(async () => {
    const actividad = await db.agenda.get(programacionId);
    const ejecucion = await db.ejecuciones.where('programacionId').equals(programacionId).first();
    const fotos = ejecucion ? await db.fotos.where('ejecucionClientUuid').equals(ejecucion.clientUuid).toArray() : [];
    return { actividad, ejecucion, fotos };
  }, [programacionId]);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [observaciones, setObservaciones] = useState('');

  if (!datos) return null;
  const { actividad, ejecucion, fotos } = datos;
  if (!actividad) {
    return (
      <>
        <p>La actividad ya no está en la programación descargada.</p>
        <button onClick={volver}>Volver</button>
      </>
    );
  }

  const fotosValidas = fotos.filter((f) => f.sync !== 'RECHAZADO');
  const completas = MOMENTOS.every((m) => fotosValidas.some((f) => f.momento === m));
  const esHoy = actividad.fecha === fechaLocal();

  async function hacer(accion: () => Promise<unknown>) {
    setError('');
    setOcupado(true);
    try {
      await accion();
    } catch (e) {
      setError(e instanceof ErrorLocal ? e.message : `No se pudo guardar: ${(e as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <p>
        <button className="enlace" onClick={volver}>
          Volver
        </button>
      </p>
      <h1>{actividad.actividad}</h1>
      <p>
        {SERVICIOS[actividad.tipoServicio] ?? actividad.tipoServicio} · {actividad.conjunto.nombre}
      </p>
      {actividad.descripcion && <p className="tenue">{actividad.descripcion}</p>}
      {error && <div className="error">{error}</div>}

      <div className="caja">
        <h2>1. Inicio</h2>
        {ejecucion ? (
          <p>
            Iniciada a las {horaCorta(ejecucion.horaInicio)}
            <br />
            <EstadoSync info={ejecucion.inicio} />
          </p>
        ) : (
          <button className="principal" disabled={ocupado || !esHoy} onClick={() => hacer(() => iniciarActividad(actividad))}>
            Iniciar actividad
          </button>
        )}
        {!esHoy && !ejecucion && <p className="tenue">Esta actividad es para otro día.</p>}
      </div>

      <div className="caja">
        <h2>2. Fotos</h2>
        <p className="tenue">Tome una foto antes, durante y después del trabajo.</p>
        <div className="fotos">
          {MOMENTOS.map((m) => (
            <CasillaFoto
              key={m}
              momento={m}
              foto={fotosValidas.find((f) => f.momento === m) ?? fotos.find((f) => f.momento === m)}
              habilitada={!!ejecucion && !ejecucion.fin && !ocupado}
              tomar={(archivo) => hacer(() => agregarFoto(ejecucion!.clientUuid, m, archivo))}
            />
          ))}
        </div>
      </div>

      <div className="caja">
        <h2>3. Fin</h2>
        {ejecucion?.fin ? (
          <p>
            Finalizada a las {horaCorta(ejecucion.horaFin)}
            {ejecucion.observaciones && (
              <>
                <br />
                <small>{ejecucion.observaciones}</small>
              </>
            )}
            <br />
            <EstadoSync info={ejecucion.fin} />
          </p>
        ) : (
          <>
            <label htmlFor="obs">Observaciones (opcional)</label>
            <textarea id="obs" rows={3} maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            <p style={{ marginTop: 8 }}>
              <button
                className="principal"
                style={{ width: '100%' }}
                disabled={!ejecucion || !completas || ocupado}
                onClick={() => hacer(() => finalizarActividad(ejecucion!.clientUuid, observaciones))}
              >
                Finalizar actividad
              </button>
            </p>
            {ejecucion && !completas && <p className="tenue">Faltan fotos para poder finalizar.</p>}
          </>
        )}
      </div>
    </>
  );
}

function CasillaFoto(props: { momento: Momento; foto?: Foto; habilitada: boolean; tomar: (archivo: File) => void }) {
  const { momento, foto, habilitada, tomar } = props;
  const entrada = useRef<HTMLInputElement>(null);
  const url = useUrlBlob(foto?.miniatura);
  const enviada = foto?.sync === 'SINCRONIZADO';

  return (
    <div className="foto">
      <strong>{nombreMomento(momento)}</strong>
      {url ? <img src={url} alt={`Foto ${nombreMomento(momento)}`} /> : <div className="vacia">Sin foto</div>}
      {foto && (
        <>
          <small>{horaCorta(foto.horaCaptura)} · {Math.round(foto.tamanoBytes / 1024)} KB</small>
          <br />
          <EstadoSync info={foto} />
        </>
      )}
      {/* capture="environment" opens the rear camera directly on phones. */}
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          e.target.value = '';
          if (archivo) tomar(archivo);
        }}
      />
      {!enviada && (
        <button disabled={!habilitada} onClick={() => entrada.current?.click()}>
          {foto ? 'Repetir' : 'Tomar foto'}
        </button>
      )}
    </div>
  );
}
