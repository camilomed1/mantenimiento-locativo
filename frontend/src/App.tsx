import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { Login } from './pantallas/Login';
import { Monitor } from './pantallas/Monitor';
import { Operario } from './pantallas/Operario';

export function App() {
  // undefined while IndexedDB loads; null when there is no session.
  const sesion = useLiveQuery(async () => (await db.sesion.get('actual')) ?? null, []);
  if (sesion === undefined) return null;
  if (!sesion) return <Login />;
  return sesion.usuario.rol === 'OPERARIO' ? <Operario sesion={sesion} /> : <Monitor sesion={sesion} />;
}
