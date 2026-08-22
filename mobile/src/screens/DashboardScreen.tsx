import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { API_URL, COLORS, FONT } from '../config';
import { Dispositivo, Lectura, calcularEstado, EstadoSalon } from '../types';

type RootStackParamList = { Dashboard: undefined; DetalleSalon: { dispositivo: Dispositivo }; Alertas: undefined; };
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;

function MetricGauge({ label, value, unit, isAlert = false }: { label: string; value: string | number; unit: string; isAlert?: boolean }) {
  return (
    <View style={styles.metricGauge}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, isAlert && { color: COLORS.red }]}>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );
}

function SalonCardPremium({ disp, lectura, onPress }: { disp: Dispositivo, lectura?: Lectura, onPress: () => void }) {
  const estado = calcularEstado(disp, lectura);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (estado === 'rojo' || estado === 'amarillo') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [estado]);

  const dotColors = {
    verde: COLORS.green,
    amarillo: COLORS.yellow,
    rojo: COLORS.red,
    offline: COLORS.gray,
  };

  return (
    <TouchableOpacity style={styles.salonCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.salonHeader}>
        <Text style={styles.salonTitle}>{disp.salon}</Text>
        <View style={styles.statusContainer}>
          <Animated.View style={[
            styles.statusGlow, 
            { backgroundColor: dotColors[estado], transform: [{ scale: pulseAnim }], opacity: 0.3 }
          ]} />
          <View style={[styles.statusDot, { backgroundColor: dotColors[estado] }]} />
        </View>
      </View>
      
      <Text style={[styles.salonType, { color: dotColors[estado] }]}>
        {lectura ? lectura.tipo : (disp.online ? 'Sin datos' : 'Offline')}
      </Text>

      <View style={styles.metricsGrid}>
        <MetricGauge label="MQ135" value={lectura ? lectura.ppm135.toFixed(0) : '--'} unit="ppm" />
        <MetricGauge label="MQ2" value={lectura ? lectura.ppm2.toFixed(0) : '--'} unit="ppm" />
        <MetricGauge label="CO2" value={lectura ? lectura.co2 : '--'} unit="ppm" isAlert={lectura && lectura.co2 > 1000} />
        <MetricGauge label="PM2.5" value={lectura && lectura.pm25 >= 0 ? lectura.pm25 : '--'} unit="µg" isAlert={lectura && lectura.pm25 > 35} />
      </View>
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const { usuario, logout } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const socketCtx = useSocket();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/dispositivos`);
      const data = await res.json();
      setDispositivos(data.dispositivos || []);
    } catch (err) {
      console.error('Error fetching dispositivos:', err);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!socketCtx) return;
    const { dispositivoUpdates: devsSocket } = socketCtx;
    if (Object.keys(devsSocket).length > 0) {
      setDispositivos(prev => prev.map(d => devsSocket[d.id] ? { ...d, ...devsSocket[d.id] } : d));
    }
  }, [socketCtx?.dispositivoUpdates]);

  const lecturas = socketCtx?.lecturas || {};

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Hola, {usuario?.nombre?.split(' ')[0]}</Text>
          <Text style={styles.headerSubtitle}>Resumen de Monitoreo</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} />}
      >
        <View style={styles.salonesGrid}>
          {dispositivos.map(d => (
            <SalonCardPremium 
              key={d.id} 
              disp={d} 
              lectura={lecturas[d.id]} 
              onPress={() => navigation.navigate('DetalleSalon', { dispositivo: d })}
            />
          ))}
          {dispositivos.length === 0 && (
            <Text style={{color: COLORS.textMuted, textAlign: 'center', marginTop: 50}}>
              Buscando dispositivos...
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: FONT.bold,
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: FONT.regular,
    color: COLORS.blue,
    marginTop: 4,
  },
  logoutBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: FONT.bold,
  },
  scrollContent: {
    padding: 20,
  },
  salonesGrid: {
    gap: 16,
  },
  salonCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  salonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  salonTitle: {
    fontSize: 18,
    fontFamily: FONT.bold,
    color: '#fff',
  },
  statusContainer: {
    position: 'relative',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusGlow: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  salonType: {
    fontSize: 13,
    fontFamily: FONT.bold,
    marginTop: 4,
    marginBottom: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: 12,
  },
  metricGauge: {
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 16,
    fontFamily: FONT.bold,
    color: '#fff',
  },
  metricUnit: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 2,
  }
});
