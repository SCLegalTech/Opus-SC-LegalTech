import phiMark from '../assets/brand/logo-aureo.svg';

// Pantalla de carga con la marca: el ouroboros dorado gira en bucle alrededor
// de la Φ (ciclo eterno · "una mejor realidad es posible"). Reemplaza el
// "Cargando..." genérico en los fallbacks de Suspense y en los estados de carga
// de autenticación/rutas, tanto públicas como internas.
//
// El ouroboros se sirve desde /public (public/ouroboros.png). Si el archivo aún
// no existe, se oculta con onError y queda solo la Φ latiendo (sin ícono roto).
export default function BrandLoader({ label = 'Cargando' }) {
  return (
    <div className="opus-boot" role="status" aria-live="polite" aria-label={label}>
      <div className="opus-boot-mark">
        <img
          className="opus-boot-ouroboros"
          src="/ouroboros.png"
          alt=""
          aria-hidden="true"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
        <img className="opus-boot-phi" src={phiMark} alt="" aria-hidden="true" />
      </div>
    </div>
  );
}
