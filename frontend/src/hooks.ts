import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db/db';
import { contarPendientes, motor, type ResumenSync } from './sync/motor';

export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return enLinea;
}

const INTERVALO_MS = 60_000;

/**
 * Triggers sync when the app opens, when the network comes back, when the
 * app returns to the foreground and once a minute.
 */
export function useSincronizacion() {
  const [sincronizando, setSincronizando] = useState(false);
  const [resumen, setResumen] = useState<ResumenSync>();
  const pendientes = useLiveQuery(contarPendientes, [], 0);
  const ultima = useLiveQuery(() => db.ajustes.get('ultimaSync'), [])?.valor;

  useEffect(() => {
    const quitar = motor.suscribir((e) => {
      setSincronizando(e.sincronizando);
      if (e.resumen) setResumen(e.resumen);
    });
    const disparar = () => {
      if (navigator.onLine) void motor.sincronizar();
    };
    const alVolver = () => document.visibilityState === 'visible' && disparar();
    disparar();
    window.addEventListener('online', disparar);
    document.addEventListener('visibilitychange', alVolver);
    const t = setInterval(disparar, INTERVALO_MS);
    return () => {
      quitar();
      window.removeEventListener('online', disparar);
      document.removeEventListener('visibilitychange', alVolver);
      clearInterval(t);
    };
  }, []);

  return { sincronizando, resumen, pendientes, ultima, sincronizar: () => motor.sincronizar() };
}

/** Object URL for a Blob, revoked when it changes or the component unmounts. */
export function useUrlBlob(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
