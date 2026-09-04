import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { API_URL } from '../config';
import { registrarPushToken } from '../lib/push';
import type { Usuario } from '../types';

interface AuthContextType {
  usuario: Usuario | null;
  token: string | null;
  loading: boolean;
  biometriaDisponible: boolean;
  biometriaHabilitada: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginConBiometria: () => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometriaDisponible, setBiometriaDisponible] = useState(false);
  const [biometriaHabilitada, setBiometriaHabilitada] = useState(false);

  // Verificar hardware biométrico y cargar sesión existente
  useEffect(() => {
    const init = async () => {
      try {
        // Verificar si el dispositivo tiene lector de huella o Face ID
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolado = await LocalAuthentication.isEnrolledAsync();
        setBiometriaDisponible(compatible && enrolado);

        const bioActiva = await AsyncStorage.getItem('vc_biometria');
        setBiometriaHabilitada(bioActiva === 'true');

        const savedToken = await AsyncStorage.getItem('vc_token');
        const savedUser = await AsyncStorage.getItem('vc_user');
        if (savedToken && savedUser) {
          setToken(savedToken);
          setUsuario(JSON.parse(savedUser));
          void registrarPushToken(savedToken);
        }
      } catch (err) {
        console.error('Error inicializando AuthContext:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
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
    await AsyncStorage.setItem('vc_biometria', 'true');
    setBiometriaHabilitada(true);

    // Pedir permisos de notificación y registrar token FCM
    void registrarPushToken(t);
  }, []);

  // [MEJORA C] Inicio de Sesión Biométrico (Huella / Face ID)
  const loginConBiometria = useCallback(async (): Promise<boolean> => {
    try {
      const savedToken = await AsyncStorage.getItem('vc_token');
      const savedUser = await AsyncStorage.getItem('vc_user');
      if (!savedToken || !savedUser) return false;

      const resultado = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Acceso seguro a VCDetection',
        fallbackLabel: 'Ingresar con contraseña',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });

      if (resultado.success) {
        setToken(savedToken);
        setUsuario(JSON.parse(savedUser));
        void registrarPushToken(savedToken);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[BIOMETRIA] Error autenticando:', err);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    setUsuario(null);
    await AsyncStorage.removeItem('vc_token');
    await AsyncStorage.removeItem('vc_user');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        token,
        loading,
        biometriaDisponible,
        biometriaHabilitada,
        login,
        loginConBiometria,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
