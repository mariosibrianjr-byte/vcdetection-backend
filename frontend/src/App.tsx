import type { ReactNode } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

// Componente para proteger las rutas privadas
const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { usuario, loading } = useAuth();
  if (loading) return <div>Cargando...</div>;
  return usuario ? <>{children}</> : <Navigate to="/login" />;
};

function AppRoutes() {
  const { usuario, loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route
        path="/login"
        element={usuario ? <Navigate to="/" /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}
