import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SelfHostedProvider } from './context/SelfHostedContext';
import SeoManager from './components/SeoManager';
import BrandLoader from './components/BrandLoader';

const Layout = lazy(() => import('./components/Layout/Layout'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Cases = lazy(() => import('./pages/Cases'));
const CaseDetail = lazy(() => import('./pages/CaseDetail'));
const Clients = lazy(() => import('./pages/Clients'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const Integrations = lazy(() => import('./pages/Integrations'));
const WorkspaceArea = lazy(() => import('./pages/WorkspaceArea'));
const AgentPlans = lazy(() => import('./pages/AgentPlans'));
const Approvals = lazy(() => import('./pages/Approvals'));
const RadarColombia = lazy(() => import('./pages/RadarColombia'));
const CompetitiveRadar = lazy(() => import('./pages/CompetitiveRadar'));
const Kaizen = lazy(() => import('./pages/Kaizen'));
const Whatsapp = lazy(() => import('./pages/Whatsapp'));
const Prospects = lazy(() => import('./pages/Prospects'));
const JudicialAgents = lazy(() => import('./pages/JudicialAgents'));
const Recepcion = lazy(() => import('./pages/Recepcion'));
const PortalCliente = lazy(() => import('./pages/PortalCliente'));
const MiProductividad = lazy(() => import('./pages/MiProductividad'));
const Integra = lazy(() => import('./pages/Integra'));

function useNoIndexMeta() {
  useEffect(() => {
    const metaName = 'robots';
    const privateValue = 'noindex,nofollow';
    let tag = document.querySelector(`meta[name="${metaName}"]`);
    let originalValue = null;
    let created = false;

    if (tag) {
      originalValue = tag.getAttribute('content');
      tag.setAttribute('content', privateValue);
    } else {
      tag = document.createElement('meta');
      tag.setAttribute('name', metaName);
      tag.setAttribute('content', privateValue);
      document.head.appendChild(tag);
      created = true;
    }

    return () => {
      if (created) tag.parentNode?.removeChild(tag);
      else if (originalValue !== null) tag.setAttribute('content', originalValue);
    };
  }, []);
}

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  useNoIndexMeta();
  if (loading) return <BrandLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <BrandLoader />;
  if (user) return <Navigate to="/" replace />;
  return children;
};

function AuthedLayout() {
  useNoIndexMeta();
  return <Layout />;
}

function RouteFallback() {
  return <BrandLoader />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SeoManager />
      <AuthProvider>
        <SelfHostedProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/portal/:token" element={<PortalCliente />} />
              <Route path="/integra" element={<ProtectedRoute><Integra /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute><AuthedLayout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="recepcion" element={<Recepcion />} />
                <Route path="productividad" element={<MiProductividad />} />
                <Route path="recepcion-legacy" element={<WorkspaceArea area="recepcion" />} />
                <Route path="office" element={<WorkspaceArea area="oficina" />} />
                <Route path="library" element={<WorkspaceArea area="biblioteca" />} />
                <Route path="vault" element={<WorkspaceArea area="caja" />} />
                <Route path="planes" element={<AgentPlans />} />
                <Route path="aprobaciones" element={<Approvals />} />
                <Route path="radar-colombia" element={<RadarColombia />} />
                <Route path="radar-competitivo" element={<CompetitiveRadar />} />
                <Route path="kaizen" element={<Kaizen />} />
                <Route path="whatsapp" element={<Whatsapp />} />
                <Route path="judicial-agents" element={<JudicialAgents />} />
                <Route path="prospects" element={<Prospects />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="cases" element={<Cases />} />
                <Route path="cases/:id" element={<CaseDetail />} />
                <Route path="clients" element={<Clients />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/:id" element={<ProjectDetail />} />
                <Route path="settings" element={<Settings />} />
                <Route path="integrations" element={<Integrations />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </SelfHostedProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
