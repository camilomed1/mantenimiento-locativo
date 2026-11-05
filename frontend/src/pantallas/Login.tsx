import { useState, type FormEvent } from 'react';
import { useEnLinea } from '../hooks';
import { entrar } from '../sync/sesion';

export function Login() {
  const enLinea = useEnLinea();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await entrar(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <h1>Mantenimiento Locativo</h1>
      <p className="tenue">Ingrese con su correo institucional.</p>
      {!enLinea && (
        <div className="aviso">
          Sin conexión. Para ingresar la primera vez necesita señal; después la aplicación funciona sin internet.
        </div>
      )}
      {!window.isSecureContext && (
        <div className="aviso">La aplicación debe abrirse con https:// para funcionar sin conexión y enviar fotos.</div>
      )}
      <label htmlFor="email">Correo</label>
      <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Contraseña</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <p style={{ marginTop: 16 }}>
        <button className="principal" type="submit" disabled={enviando} style={{ width: '100%' }}>
          {enviando ? 'Ingresando...' : 'Ingresar'}
        </button>
      </p>
    </form>
  );
}
