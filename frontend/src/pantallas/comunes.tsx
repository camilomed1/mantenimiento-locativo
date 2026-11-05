import type { InfoSync } from '../db/db';
import { useEnLinea, useSincronizacion } from '../hooks';
import { cerrarSesion } from '../lib/api';
import { horaCorta } from '../lib/utilidades';

/** Operator-facing Spanish text for the server's result codes. */
const TEXTOS: Record<string, string> = {
  ERROR_TEMPORAL: 'el servidor no pudo guardarlo; se reintentará',
  EJECUCION_NO_SINCRONIZADA: 'esperando el envío del inicio',
  EVIDENCIAS_INCOMPLETAS: 'esperando el envío de las fotos',
  HASH_NO_COINCIDE: 'la foto llegó incompleta; se reenviará',
  NO_PROGRAMADO: 'no está programado en este conjunto hoy',
  CONJUNTO_NO_EXISTE: 'el conjunto no existe',
  ENTRADA_DUPLICADA: 'ya había una entrada registrada hoy',
  ENTRADA_ABIERTA: 'tenía una entrada abierta en otro conjunto',
  SALIDA_SIN_ENTRADA: 'no hay entrada registrada',
  SALIDA_DUPLICADA: 'ya había una salida registrada hoy',
  SALIDA_ANTERIOR_A_ENTRADA: 'la hora de salida es anterior a la entrada',
  ACTIVIDAD_NO_ASIGNADA: 'la actividad está asignada a otro operario',
  ACTIVIDAD_YA_INICIADA: 'la actividad ya fue iniciada desde otro dispositivo',
  PROGRAMACION_NO_PUBLICADA: 'la programación no está publicada',
  PROGRAMACION_NO_EXISTE: 'la actividad ya no existe',
  MOMENTO_YA_REGISTRADO: 'ya hay una foto para este momento',
  EJECUCION_FINALIZADA: 'la actividad ya estaba finalizada',
  FIN_ANTERIOR_A_INICIO: 'la hora de fin es anterior al inicio',
  TAMANO_INVALIDO: 'la foto es demasiado grande',
  TIPO_NO_PERMITIDO: 'formato de imagen no permitido',
};
const texto = (info: InfoSync) => (info.codigo && TEXTOS[info.codigo]) || info.mensaje || info.codigo || '';

/** One-line sync state of a record, with both clocks once it is sent. */
export function EstadoSync({ info }: { info: InfoSync | null | undefined }) {
  if (!info) return null;
  if (info.sync === 'SINCRONIZADO') {
    return <small className="ok">Enviado{info.horaServidor ? ` (recibido ${horaCorta(info.horaServidor)})` : ''}</small>;
  }
  if (info.sync === 'RECHAZADO') return <small className="malo">Rechazado: {texto(info)}</small>;
  return (
    <small className="pendiente">
      Pendiente de envío{info.intentos > 0 && texto(info) ? ` (${texto(info)})` : ''}
    </small>
  );
}

export function BarraSuperior({ nombre }: { nombre: string }) {
  const enLinea = useEnLinea();
  const { sincronizando, pendientes, ultima, resumen, sincronizar } = useSincronizacion();

  async function salir() {
    const aviso =
      pendientes > 0
        ? `Tiene ${pendientes} registro(s) sin enviar. Se conservan en el teléfono, pero solo usted podrá enviarlos. ¿Cerrar sesión?`
        : '¿Cerrar sesión?';
    if (window.confirm(aviso)) await cerrarSesion();
  }

  return (
    <>
      <div className="barra">
        <strong>{nombre}</strong>
        <span className="relleno" />
        <button className="enlace" onClick={salir}>
          Salir
        </button>
      </div>
      <div className="barra">
        <span className={enLinea ? 'ok' : 'pendiente'}>{enLinea ? 'En línea' : 'Sin conexión'}</span>
        <span className="tenue">
          {pendientes > 0 ? `${pendientes} pendiente(s)` : 'Todo enviado'}
          {ultima ? ` · última sincronización ${horaCorta(ultima)}` : ''}
        </span>
        <span className="relleno" />
        <button onClick={() => void sincronizar()} disabled={sincronizando || !enLinea}>
          {sincronizando ? 'Enviando...' : 'Sincronizar'}
        </button>
      </div>
      {resumen?.sesionExpirada && (
        <div className="aviso">
          Su sesión expiró. Los registros siguen guardados.{' '}
          <button className="enlace" onClick={() => void cerrarSesion()}>
            Ingresar de nuevo
          </button>
        </div>
      )}
      {resumen?.error && <div className="error">Error al sincronizar: {resumen.error}</div>}
    </>
  );
}
