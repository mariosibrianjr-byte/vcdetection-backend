import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { COLORS } from '../config';

import DashboardScreen from '../screens/DashboardScreen';
import DetalleSalonScreen from '../screens/DetalleSalonScreen';
import AlertasScreen from '../screens/AlertasScreen';
import UsuariosScreen from '../screens/UsuariosScreen';

// ─── Tema claro pastel para toda la navegación ───────────────────────────────
const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: COLORS.blue,
    background: COLORS.bg,
    card: COLORS.card,
    text: COLORS.textPrimary,
    border: COLORS.border,
    notification: COLORS.red,
  },
};

// ─── Tabs (Dashboard + Alertas) ───────────────────────────────────────────────
const Tab = createBottomTabNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: COLORS.blue,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Salones"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🏫</Text>,
        }}
      />
      <Tab.Screen
        name="Alertas"
        component={AlertasScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🔔</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Stack principal (Tabs → Detalle) ─────────────────────────────────────────
const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer theme={LightTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen name="Detalle" component={DetalleSalonScreen} />
        <Stack.Screen name="Usuarios" component={UsuariosScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
