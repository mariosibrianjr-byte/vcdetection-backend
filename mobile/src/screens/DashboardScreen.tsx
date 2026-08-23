import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  Animated, Vibration, Dimensions
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { API_URL, COLORS, FONT } from '../config';
import { Dispositivo, Lectura, Alerta, calcularEstado, EstadoSalon, tipoAlertaIcono, tipoAlertaLabel, formatTiempoRelativo } from '../types';

type RootStackParamList = { Dashboard: undefined; DetalleSalon: { dispositivo: Dispositivo }; Alertas: undefined; Usuarios: undefined; };
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Toast de Alerta (como la versión PC) ────────────────────────────────────
function ToastAlerta({ alerta, onDismiss }: { alerta: Alerta; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const salon = alerta.dispositivo?.salon || alerta.dispositivoId;
  return (
    <TouchableOpacity style={styles.toast} onPress={onDismiss} activeOpacity={0.9}>
      <Text style={styles.toastIcon}>{tipoAlertaIcono(alerta.tipo)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.toastTitle}>⚠️ {tipoAlertaLabel(alerta.tipo)}</Text>
        <Text style={styles.toastBody}>{salon}: {alerta.mensaje.slice(0, 80)}</Text>
        <Text style={styles.toastTime}>{formatTiempoRelativo(alerta.fecha)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Card de Salón (métricas idénticas a PC: CO/PM2.5/PM10/CO₂) ──────────────
function SalonCard({ disp, lectura, onPress }: { disp: Dispositivo, lectura?: Lectura, onPress: () => void }) {
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

  const dotColors: Record<EstadoSalon, string> = {
    verde: COLORS.green, amarillo: COLORS.yellow, rojo: COLORS.red, offline: COLORS.gray,
  };
  const color = dotColors[estado];

  return (
    <TouchableOpacity style={[styles.salonCard, estado !== 'offline' && { borderColor: color + '55' }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.salonHeader}>
        <Text style={styles.salonTitle}>{disp.salon}</Text>
        <View style={styles.statusContainer}>
          <Animated.View style={[
            styles.statusGlow,
            { backgroundColor: color, transform: [{ scale: pulseAnim }], opacity: 0.3 }
          ]} />
          <View style={[styles.statusDot, { backgroundColor: color }]} />
        </View>
      </View>

      <Text style={[styles.salonType, { color }]}>
        {lectura ? lectura.tipo : (disp.online ? 'Sin datos' : 'Offline')}
      </Text>

      <View style={styles.metricsGrid}>
        <MetricGauge label="CO (MQ7)" value={lectura ? lectura.ppm135.toFixed(1) : '--'} unit="ppm" />
        <MetricGauge label="PM2.5" value={lectura && lectura.pm25 >= 0 ? String(lectura.pm25) : '--'} unit="µg" isAlert={!!lectura && lectura.pm25 > 35} />
        <MetricGauge label="PM10" value={lectura && lectura.pm10 >= 0 ? String(lectura.pm10) : '--'} unit="µg" />
        <MetricGauge
          label="CO₂"
          value={lectura && lectura.co2 >= 0 ? String(lectura.co2) : '--'}
          unit="ppm"
          isAlert={!!lectura && lectura.co2 > 2000}
          isWarn={!!lectura && lectura.co2 >= 1000 && lectura.co2 <= 2000}
        />
      </View>

      <Text style={styles.salonTiempo}>⏱ {formatTiempoRelativo(disp.ultimaConexion)}</Text>
    </TouchableOpacity>
  );
}

function MetricGauge({ label, value, unit, isAlert = false, isWarn = false }: { label: string; value: string | number; unit: string; isAlert?: boolean; isWarn?: boolean }) {
  const valColor = isAlert ? COLORS.red : isWarn ? COLORS.yellow : '#fff';
  return (
    <View style={styles.metricGauge}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: valColor }]}>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );
}

// ─── Dashboard Principal (layout espejo de la versión PC) ────────────────────
export default function DashboardScreen() {
  const { usuario, logout, token } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const socketCtx = useSocket();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [toasts, setToasts] = useState<Alerta[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => (
    token ? { Authorization: `Bearer ${token}` } : {}
  ), [token]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/dispositivos`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDispositivos(data.dispositivos || []);
      }
    } catch (err) {
      console.error('Error fetching dispositivos:', err);
    }
  }, [authHeaders]);

  const fetchAlertas = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/alertas?limit=30`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAlertas(data.alertas || []);
      }
    } catch (err) {
      console.error('Error fetching alertas:', err);
    }
  }, [authHeaders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), fetchAlertas()]);
    setRefreshing(false);
  }, [fetchData, fetchAlertas]);

  useEffect(() => {
    fetchData();
    fetchAlertas();
  }, [fetchData, fetchAlertas]);

  // Sincronizar dispositivos actualizados por WebSocket
  useEffect(() => {
    if (!socketCtx) return;
    const devsSocket = socketCtx.dispositivoUpdates;
    if (Object.keys(devsSocket).length > 0) {
      setDispositivos(prev => prev.map(d => devsSocket[d.id] ? { ...d, ...devsSocket[d.id] } : d));
    }
  }, [socketCtx?.dispositivoUpdates]);

  // Lecturas en tiempo real + refresco de alertas cuando llega una nueva
  useEffect(() => {
    if (!socketCtx?.alertasNuevas.length) return;
    const nuevas = socketCtx.alertasNuevas;
    setAlertas(prev => {
      const filtradas = nuevas.filter(a => !prev.some(p => p.id === a.id));
      return [...filtradas, ...prev].slice(0, 30);
    });
    setToasts(prev => [...nuevas.filter(a => !prev.some(p => p.id === a.id)), ...prev].slice(0, 3));
    Vibration.vibrate([250, 120, 250]);
    fetchData();
  }, [socketCtx?.alertasNuevas]);

  const lecturas = socketCtx?.lecturas || {};
  const alertasNoVistas = alertas.filter(a => !a.vista).length;

  const online = dispositivos.filter(d => d.online).length;
  const offline = dispositivos.filter(d => !d.online).length;
  const enAlarma = dispositivos.filter(d => {
    const lec = lecturas[d.id];
    return d.online && lec && lec.humoDetectado;
  }).length;

  const marcarVista = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/alertas/${id}/vista`, { method: 'PATCH', headers: authHeaders() });
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, vista: true } : a));
    } catch { /* silencioso */ }
  };

  const marcarTodas = async () => {
    try {
      await fetch(`${API_URL}/api/alertas/marcar-todas`, { method: 'PATCH', headers: authHeaders() });
      setAlertas(prev => prev.map(a => ({ ...a, vista: true })));
    } catch { /* silencioso */ }
  };

  return (
    <View style={styles.container}>
      {/* Barra superior como la navbar de PC */}
      <View style={styles.navbar}>
        <View style={styles.navbarLeft}>
          <View style={styles.navbarLogo}><Text style={{ fontSize: 22 }}>🔍</Text></View>
          <View>
            <Text style={styles.navbarTitle}>VCDetection</Text>
            <Text style={styles.navbarSubtitle}>Panel de Control Encubierto</Text>
          </View>
        </View>
        <View style={styles.navbarRight}>
          {usuario?.rol === 'ADMIN' && (
            <TouchableOpacity style={styles.btnNav} onPress={() => navigation.navigate('Usuarios')}>
              <Text style={styles.btnNavText}>👥 Usuarios</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.btnLogout} onPress={logout}>
            <Text style={styles.btnLogoutText}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} />}
      >
        {/* Fila de estadísticas */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsBar}>
          <StatCard label="Total Salones" value={String(dispositivos.length)} color={COLORS.blue} />
          <StatCard label="En Línea" value={String(online)} color={COLORS.green} />
          <StatCard label="Offline" value={String(offline)} color={COLORS.gray} />
          <StatCard label="⚠️ En Alarma" value={String(enAlarma)} color={COLORS.red} />
          <StatCard label="Sin ver" value={String(alertasNoVistas)} color={COLORS.yellow} />
        </ScrollView>

        {/* Grid de salones */}
        <Text style={styles.sectionTitle}>Salones ({dispositivos.length})</Text>
        <View style={styles.salonesGrid}>
          {dispositivos.map(d => (
            <SalonCard
              key={d.id}
              disp={d}
              lectura={lecturas[d.id]}
              onPress={() => navigation.navigate('DetalleSalon', { dispositivo: d })}
            />
          ))}
          {dispositivos.length === 0 && (
            <Text style={styles.vacioTexto}>
              Esperando dispositivos... Asegurate de que el ESP32 esté enviando datos.
            </Text>
          )}
        </View>

        {/* Panel de alertas recientes */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Alertas Recientes</Text>
        <View style={styles.alertasPanel}>
          <View style={styles.alertasHeader}>
            <Text style={styles.alertasTitulo}>
              Últimas alertas{alertasNoVistas > 0 ? ` (${alertasNoVistas} nuevas)` : ''}
            </Text>
            {alertasNoVistas > 0 && (
              <TouchableOpacity onPress={marcarTodas}>
                <Text style={styles.marcarTodasBtn}>Marcar todas como vistas</Text>
              </TouchableOpacity>
            )}
          </View>

          {alertas.length === 0 && (
            <View style={styles.alertasEmpty}>
              <Text style={{ fontSize: 26 }}>✅</Text>
              <Text style={styles.alertasEmptyTexto}>Sin alertas — todo en orden</Text>
            </View>
          )}

          {alertas.slice(0, 15).map(alerta => {
            const salon = alerta.dispositivo?.salon || alerta.dispositivoId;
            return (
              <TouchableOpacity
                key={alerta.id}
                style={[styles.alertaItem, !alerta.vista && styles.alertaNoVista]}
                onPress={() => !alerta.vista && marcarVista(alerta.id)}
                activeOpacity={0.7}
              >
                <View style={styles.alertaIcono}>
                  <Text style={{ fontSize: 18 }}>{tipoAlertaIcono(alerta.tipo)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertaSalon}>{salon}</Text>
                  <Text style={styles.alertaMsg}>{alerta.mensaje}</Text>
                  <Text style={styles.alertaTime}>{formatTiempoRelativo(alerta.fecha)}</Text>
                </View>
                {!alerta.vista && <View style={styles.dotNueva} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Toasts flotantes arriba */}
      <View style={styles.toastContainer} pointerEvents="box-none">
        {toasts.map(t => (
          <ToastAlerta key={t.id} alerta={t} onDismiss={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
        ))}
      </View>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  // ── Navbar
  navbar: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  navbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navbarLogo: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: COLORS.blueGlow,
    borderWidth: 1, borderColor: COLORS.borderLight,
    justifyContent: 'center', alignItems: 'center',
  },
  navbarTitle: { fontSize: 17, fontFamily: FONT.bold, color: '#fff' },
  navbarSubtitle: { fontSize: 11, fontFamily: FONT.regular, color: COLORS.blue },
  navbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnNav: {
    backgroundColor: COLORS.blueGlow,
    borderWidth: 1, borderColor: COLORS.borderLight,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  btnNavText: { color: COLORS.blue, fontSize: 12, fontWeight: '700' },
  btnLogout: {
    backgroundColor: COLORS.redGlow,
    borderWidth: 1, borderColor: 'rgba(244,63,94,0.4)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  btnLogoutText: { color: COLORS.red, fontSize: 12, fontWeight: '700' },
  // ── Stats
  scrollContent: { padding: 16, paddingBottom: 40 },
  statsBar: { gap: 10, paddingRight: 16 },
  statCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    minWidth: 110,
  },
  statLabel: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  statValue: { fontSize: 24, fontWeight: '800', marginTop: 2 },
  // ── Secciones
  sectionTitle: {
    fontSize: 14, fontWeight: '800', color: COLORS.textPrimary,
    marginTop: 18, marginBottom: 10,
  },
  vacioTexto: { color: COLORS.textMuted, textAlign: 'center', marginTop: 20, paddingHorizontal: 20 },
  salonesGrid: { gap: 14 },
  // ── Salon Card
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
  salonTitle: { fontSize: 18, fontFamily: FONT.bold, color: '#fff' },
  statusContainer: { position: 'relative', width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  statusGlow: { position: 'absolute', width: 24, height: 24, borderRadius: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  salonType: { fontSize: 13, fontFamily: FONT.bold, marginTop: 4, marginBottom: 14 },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: 12,
  },
  metricGauge: { alignItems: 'center', flex: 1 },
  metricLabel: { fontSize: 9, color: COLORS.textSecondary, marginBottom: 4 },
  metricValue: { fontSize: 15, fontFamily: FONT.bold, fontVariant: ['tabular-nums'] },
  metricUnit: { fontSize: 9, color: COLORS.textMuted, marginTop: 2 },
  salonTiempo: { fontSize: 11, color: COLORS.textMuted, marginTop: 10 },
  // ── Panel de alertas
  alertasPanel: {
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  alertasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  alertasTitulo: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  marcarTodasBtn: { fontSize: 11, fontWeight: '700', color: COLORS.blue },
  alertasEmpty: { alignItems: 'center', padding: 28, gap: 6 },
  alertasEmptyTexto: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  alertaItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  alertaNoVista: { backgroundColor: 'rgba(244,63,94,0.05)' },
  alertaIcono: {
    width: 34, height: 34, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  alertaSalon: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  alertaMsg: { fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 },
  alertaTime: { fontSize: 10, color: COLORS.textMuted, marginTop: 3 },
  dotNueva: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red, marginTop: 6 },
  // ── Toasts
  toastContainer: {
    position: 'absolute',
    top: 100,
    left: 12, right: 12,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.yellow,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  toastIcon: { fontSize: 24 },
  toastTitle: { fontSize: 12.5, fontWeight: '800', color: COLORS.yellow },
  toastBody: { fontSize: 11.5, color: COLORS.textSecondary, marginTop: 2 },
  toastTime: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },
});
