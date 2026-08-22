import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import AppNavigator from './src/navigation/AppNavigator';
import LoginScreen from './src/screens/LoginScreen';
import { COLORS } from './src/config';

// ─── Componente raíz que decide entre Login y la App principal ────────────────
function Root() {
  const { usuario, loading } = useAuth();

  // Pantalla de carga mientras se recupera la sesión guardada
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.blue} />
      </View>
    );
  }

  // Si no hay usuario logueado, mostrar pantalla de Login
  if (!usuario) {
    return <LoginScreen />;
  }

  // Si hay sesión activa, mostrar la App con WebSockets y Navegación
  return (
    <SocketProvider>
      <AppNavigator />
    </SocketProvider>
  );
}

// ─── App principal con contexto de autenticación ──────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
