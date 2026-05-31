import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-panel">
        <p className="not-found-eyebrow">404</p>
        <h1>Pagina no encontrada</h1>
        <p>La ruta solicitada no existe en esta instalacion self-hosted.</p>
        <Link className="btn btn-primary" to="/login">Ir al login</Link>
      </section>
    </main>
  );
}
