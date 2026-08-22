import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import type { Usuario } from '../types';
import { API_URL } from '../config';

interface AuthContextType {
  usuario: Usuario | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Recuperar sesión guardada
    const savedToken = localStorage.getItem('vc_token');
    const savedUser = localStorage.getItem('vc_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUsuario(JSON.parse(savedUser));
      axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await axios.post(`${API_URL}/api/auth/login`, { email, password });
    const { token: t, usuario: u } = res.data;
    setToken(t);
    setUsuario(u);
    localStorage.setItem('vc_token', t);
    localStorage.setItem('vc_user', JSON.stringify(u));
    axios.defaults.headers.common['Authorization'] = `Bearer ${t}`;
  };

  const logout = () => {
    setToken(null);
    setUsuario(null);
    localStorage.removeItem('vc_token');
    localStorage.removeItem('vc_user');
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ usuario, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
