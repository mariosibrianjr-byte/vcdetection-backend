import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config';
import type { Usuario } from '../types';

interface AuthContextType {
  usuario: Usuario | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Recuperar sesión guardada al iniciar la app
  useEffect(() => {
    const cargarSesion = async () => {
      try {
        const savedToken = await AsyncStorage.getItem('vc_token');
        const savedUser = await AsyncStorage.getItem('vc_user');
        if (savedToken && savedUser) {
          setToken(savedToken);
          setUsuario(JSON.parse(savedUser));
        }
      } catch (err) {
        console.error('Error cargando sesión:', err);
      } finally {
        setLoading(false);
      }
    };
    cargarSesion();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      throw new Error('Credenciales incorrectas');
    }

    const data = await res.json();
    const { token: t, usuario: u } = data;

    setToken(t);
    setUsuario(u);
    await AsyncStorage.setItem('vc_token', t);
    await AsyncStorage.setItem('vc_user', JSON.stringify(u));
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    setUsuario(null);
    await AsyncStorage.removeItem('vc_token');
    await AsyncStorage.removeItem('vc_user');
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
