import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  Animated, Vibration, Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { API_URL, COLORS } from '../config';
import { Dispositivo, Lectura, Alerta, calcularEstado, EstadoSalon, tipoAlertaIcono, tipoAlertaLabel, formatTiempoRelativo } from '../types';

type RootStackParamList = { Dashboard: undefined; DetalleSalon: { dispositivo: Dispositivo }; Alertas: undefined; Usuarios: undefined; };
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;

// ─── Toast de Alerta (estilo PC: blanco con borde rojo) ──────────────────────
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
        <Text style={styles.toastTitle}>{tipoAlertaLabel(alerta.tipo)}</Text>
        <Text style={styles.toastBody}>{salon}: {alerta.mensaje.slice(0, 80)}</Text>
        <Text style={styles.toastTime}>{formatTiempoRelativo(alerta.fecha)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Card de Salón (blanca con franja de color arriba, como la PC) ───────────
function SalonCard({ disp, lectura, onPress }: { disp: Dispositivo, lectura?: Lectura, onPress: () => void }) {
  const estado = calcularEstado(disp, lectura);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (estado === 'rojo' || estado === 'amarillo') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [estado]);

  // Colores de los puntos — exactos a la PC (.dot-verde/.dot-amarillo/.dot-rojo)
  const dotColors: Record<EstadoSalon, string> = {
    verde: COLORS.dotVerde, amarillo: COLORS.dotAmarillo, rojo: COLORS.dotRojo, offline: COLORS.dotOffline,
  };
  const stripColors: Record<EstadoSalon, [string, string]> = {
    verde: ['#34d399', '#a7f3d0'],
    amarillo: ['#fbbf24', '#fde68a'],
    rojo: ['#fb7185', '#fecdd3'],
    offline: ['#cbd5e1', '#e2e8f0'],
  };
  const tipoStyles: Record<EstadoSalon, { bg: string; color: string }> = {
    verde: { bg: COLORS.greenSoft, color: COLORS.green },
    amarillo: { bg: COLORS.yellowSoft, color: COLORS.yellow },
    rojo: { bg: COLORS.redSoft, color: COLORS.red },
    offline: { bg: COLORS.graySoft, color: COLORS.gray },
  };

  return (
    <TouchableOpacity
      style={[styles.salonCard, estado === 'offline' && styles.salonCardOffline]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Franja de color superior (::before en PC) */}
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={stripColors[estado]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.cardStrip}
        />
      </View>

      <View style={styles.salonHeader}>
        <Text style={styles.salonTitle}>{disp.salon}</Text>
        <View style={styles.statusContainer}>
          <Animated.View style={[
            styles.statusGlow,
            { backgroundColor: dotColors[estado], transform: [{ scale: pulseAnim }], opacity: 0.35 }
          ]} />
          <View style={[styles.statusDot, { backgroundColor: dotColors[estado] }]} />
        </View>
      </View>

      <View style={[styles.tipoBadge, { backgroundColor: tipoStyles[estado].bg }]}>
        <Text style={[styles.tipoTexto, { color: tipoStyles[estado].color }]}>
          {lectura ? lectura.tipo : (disp.online ? 'Sin datos' : 'Offline')}
        </Text>
      </View>

      <View style={styles.metricsGrid}>
        <Metric label="CO (MQ7)" value={lectura ? lectura.ppm135.toFixed(1) : '--'} unit="ppm" />
        <Metric label="PM2.5" value={lectura && lectura.pm25 >= 0 ? String(lectura.pm25) : '--'} unit="µg" valueColor={!!lectura && lectura.pm25 > 35 ? COLORS.red : undefined} />
        <Metric label="PM10" value={lectura && lectura.pm10 >= 0 ? String(lectura.pm10) : '--'} unit="µg" />
        <Metric
          label="CO₂"
          value={lectura && lectura.co2 >= 0 ? String(lectura.co2) : '--'}
          unit="ppm"
          valueColor={!!lectura && lectura.co2 > 2000 ? COLORS.red : !!lectura && lectura.co2 >= 1000 ? COLORS.yellow : undefined}
        />
      </View>

      <Text style={styles.salonTiempo}>⏱ {formatTiempoRelativo(disp.ultimaConexion)}</Text>
    </TouchableOpacity>
  );
}

function Metric({ label, value, unit, valueColor }: { label: string; value: string | number; unit: string; valueColor?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );
}

// ─── Dashboard Principal (tema claro pastel) ─────────────────────────────────
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

  useEffect(() => {
    if (!socketCtx) return;
    const devsSocket = socketCtx.dispositivoUpdates;
    if (Object.keys(devsSocket).length > 0) {
      setDispositivos(prev => prev.map(d => devsSocket[d.id] ? { ...d, ...devsSocket[d.id] } : d));
    }
  }, [socketCtx?.dispositivoUpdates]);

  // Alertas nuevas en tiempo real + vibración + toasts
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
      {/* Navbar blanca translúcida como la PC */}
      <View style={styles.navbar}>
        <View style={styles.navbarLeft}>
          <LinearGradient
            colors={COLORS.gradPrimary as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.navbarLogo}
          >
            <Text style={{ fontSize: 15 }}>🔍</Text>
          </LinearGradient>
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
              <TouchableOpacity style={styles.marcarTodasBtn} onPress={marcarTodas}>
                <Text style={styles.marcarTodasTexto}>Marcar todas</Text>
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
            const iconoBg =
              alerta.tipo === 'VAPE_CONFIRMADO' ? COLORS.yellowSoft :
              alerta.tipo === 'PM25_ALTO' ? COLORS.purpleSoft : COLORS.redSoft;
            return (
              <TouchableOpacity
                key={alerta.id}
                style={[styles.alertaItem, !alerta.vista && styles.alertaNoVista]}
                onPress={() => !alerta.vista && marcarVista(alerta.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.alertaIcono, { backgroundColor: iconoBg }]}>
                  <Text style={{ fontSize: 17 }}>{tipoAlertaIcono(alerta.tipo)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertaSalon}>{salon}</Text>
                  <Text style={styles.alertaMsg} numberOfLines={1}>{alerta.mensaje}</Text>
                  <Text style={styles.alertaTime}>{formatTiempoRelativo(alerta.fecha)}</Text>
                </View>
                {!alerta.vista && <View style={styles.dotNueva} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Toasts flotantes */}
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
  // ── Navbar (blanca translúcida como .navbar en PC)
  navbar: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  navbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navbarLogo: {
    width: 34, height: 34, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  navbarTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.2 },
  navbarSubtitle: { fontSize: 11, color: COLORS.textMuted },
  navbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnNav: {
    backgroundColor: COLORS.purpleSoft,
    borderWidth: 1.5,
    borderColor: 'rgba(139,92,246,0.25)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  btnNavText: { color: '#7c3aed', fontSize: 12.5, fontWeight: '600' },
  btnLogout: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  btnLogoutText: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '600' },
  // ── Stats (tarjetas blancas con sombra suave)
  scrollContent: { padding: 16, paddingBottom: 40 },
  statsBar: { gap: 12, paddingRight: 16 },
  statCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 18,
    borderWidth: 1, borderColor: COLORS.border,
    minWidth: 120,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 2,
  },
  statLabel: {
    fontSize: 10, color: COLORS.textMuted,
    fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.7,
  },
  statValue: { fontSize: 26, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  // ── Secciones
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: 20, marginBottom: 12,
  },
  vacioTexto: { color: COLORS.textMuted, textAlign: 'center', marginTop: 20, paddingHorizontal: 20 },
  salonesGrid: { gap: 14 },
  // ── Salon Card (blanca, franja superior, sombra)
  salonCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 32,
    elevation: 2,
  },
  salonCardOffline: { opacity: 0.62 },
  cardStrip: { height: 3, width: '100%' },
  salonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  salonTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: -0.1 },
  statusContainer: { position: 'relative', width: 22, height: 22, justifyContent: 'center', alignItems: 'center' },
  statusGlow: { position: 'absolute', width: 18, height: 18, borderRadius: 9 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  tipoBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 12,
  },
  tipoTexto: { fontSize: 12, fontWeight: '600' },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metric: { width: '47%', flexGrow: 1, gap: 1 },
  metricLabel: {
    fontSize: 10, color: COLORS.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600',
  },
  metricValue: {
    fontSize: 17, fontWeight: '700',
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  metricUnit: { fontSize: 10, color: COLORS.textMuted },
  salonTiempo: {
    fontSize: 11, color: COLORS.textMuted,
    marginTop: 12, fontVariant: ['tabular-nums'],
  },
  // ── Panel de alertas (blanco, header gris suave)
  alertasPanel: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 32,
    elevation: 2,
  },
  alertasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  alertasTitulo: { fontSize: 13.5, fontWeight: '700', color: COLORS.textPrimary },
  marcarTodasBtn: {
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
  },
  marcarTodasTexto: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '600' },
  alertasEmpty: { alignItems: 'center', padding: 36, gap: 6 },
  alertasEmptyTexto: { color: COLORS.textMuted, fontSize: 13.5 },
  alertaItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  alertaNoVista: { backgroundColor: COLORS.redSoft },
  alertaIcono: {
    width: 38, height: 38, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  alertaSalon: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  alertaMsg: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  alertaTime: {
    fontSize: 11, color: COLORS.textMuted,
    marginTop: 2, fontVariant: ['tabular-nums'],
  },
  dotNueva: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red, marginTop: 6 },
  // ── Toasts (blancos con borde rojo, como PC)
  toastContainer: {
    position: 'absolute',
    top: 100,
    left: 12, right: 12,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.28)',
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.14,
    shadowRadius: 44,
    elevation: 8,
  },
  toastIcon: { fontSize: 22 },
  toastTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.red },
  toastBody: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  toastTime: { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
});
