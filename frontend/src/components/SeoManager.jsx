import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const DEFAULT_TITLE = 'Opus SC LegalTech | Self-hosted';
const DEFAULT_DESCRIPTION = 'Opus SC LegalTech self-hosted workspace.';

function upsertMeta(selector, create, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = create();
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
}

export default function SeoManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const isLogin = pathname.replace(/\/$/, '') === '/login';
    const title = isLogin ? 'Login | Opus SC LegalTech' : DEFAULT_TITLE;

    document.documentElement.lang = 'es-CO';
    document.title = title;

    upsertMeta('meta[name="description"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'description');
      return element;
    }, { content: DEFAULT_DESCRIPTION });

    upsertMeta('meta[name="robots"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'robots');
      return element;
    }, { content: 'noindex,nofollow' });

    upsertMeta('meta[name="googlebot"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'googlebot');
      return element;
    }, { content: 'noindex,nofollow' });

    document.head.querySelectorAll('link[rel="canonical"], script[data-seo-jsonld="true"]').forEach((node) => {
      node.remove();
    });
  }, [pathname]);

  return null;
}
