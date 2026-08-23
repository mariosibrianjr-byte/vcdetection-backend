import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions, Alert
} from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { COLORS, API_URL } from '../config';
import type { Dispositivo, Lectura, EstadoSalon, PuntoHistorico } from '../types';
import { calcularEstado, formatTiempoRelativo } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Rango = 'live' | '1' | '7' | '30';
const RANGOS: [Rango, string][] = [
  ['live', 'En vivo'],
  ['1', '24 horas'],
  ['7', '7 días'],
  ['30', '30 días'],
];

// ─── Gráfica de líneas multi-serie (espejo del LineChart de recharts en PC) ──
interface Serie { data: number[]; color: string; nombre: string; }

function LineChartMulti({ series }: { series: Serie[] }) {
  const width = SCREEN_WIDTH - 64;
  const height = 190;
  const paddingY = 10;

  const limpias = series.map(s => ({ ...s, data: s.data.filter(v => Number.isFinite(v)) }));
  if (!limpias.some(s => s.data.length > 1)) return null;

  const todos = limpias.flatMap(s => s.data);
  const max = Math.max(...todos);
  const min = Math.min(...todos, 0);
  const range = max - min || 1;
  const n = Math.max(...limpias.map(s => s.data.length));

  const aPuntos = (data: number[]) =>
    data
      .slice(-n)
      .map((v, i) => `${(i / Math.max(n - 1, 1)) * width},${height - paddingY - ((v - min) / range) * (height - paddingY * 2)}`)
      .join(' ');

  return (
    <View>
      <Svg width={width} height={height}>
        <Line x1="0" y1={paddingY} x2={width} y2={paddingY} stroke={COLORS.borderLight} strokeWidth="0.5" strokeDasharray="3,3" />
        <Line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={COLORS.borderLight} strokeWidth="0.5" strokeDasharray="3,3" />
        <Line x1="0" y1={height - paddingY} x2={width} y2={height - paddingY} stroke={COLORS.borderLight} strokeWidth="0.5" strokeDasharray="3,3" />
        {limpias.filter(s => s.data.length > 0).map((s, idx) => (
          <Polyline key={idx} points={aPuntos(s.data)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </Svg>
      <View style={chartStyles.leyenda}>
        {limpias.filter(s => s.data.length > 0).map((s, idx) => (
          <View key={idx} style={chartStyles.leyendaItem}>
            <View style={[chartStyles.leyendaDot, { backgroundColor: s.color }]} />
            <Text style={chartStyles.leyendaTexto}>{s.nombre}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leyendaDot: { width: 8, height: 8, borderRadius: 4 },
  leyendaTexto: { fontSize: 10, color: COLORS.textSecondary },
});

// ─── Pantalla de Detalle de Salón (espejo del modal blanco pastel de PC) ─────
export default function DetalleSalonScreen({ route, navigation }: any) {
  const { dispositivo } = route.params as { dispositivo: Dispositivo };
  const { lecturas } = useSocket();
  const { token, usuario } = useAuth();
  const esAdmin = usuario?.rol === 'ADMIN';

  const [rango, setRango] = useState<Rango>('live');
  const [histo, setHisto] = useState<PuntoHistorico[]>([]);
  const [cargandoHisto, setCargandoHisto] = useState(false);
  const [historialLive, setHistorialLive] = useState<Lectura[]>([]);
  const [eliminando, setEliminando] = useState(false);

  const lectura = lecturas[dispositivo.id];
  const estado = calcularEstado(dispositivo, lectura);

  // Colores exactos de la PC
  const dotMap: Record<EstadoSalon, string> = {
    verde: COLORS.dotVerde, amarillo: COLORS.dotAmarillo, rojo: COLORS.dotRojo, offline: COLORS.dotOffline,
  };
  const badgeMap: Record<EstadoSalon, { bg: string; color: string }> = {
    verde: { bg: COLORS.greenSoft, color: COLORS.green },
    amarillo: { bg: COLORS.yellowSoft, color: COLORS.yellow },
    rojo: { bg: COLORS.redSoft, color: COLORS.red },
    offline: { bg: COLORS.graySoft, color: COLORS.gray },
  };
  const color = dotMap[estado];
  const badge = badgeMap[estado];

  // Cargar últimas lecturas reales para el modo "En vivo"
  const fetchHistorialLive = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/dispositivos/${dispositivo.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const lecs: Lectura[] = data.dispositivo?.lecturas || [];
        setHistorialLive(lecs.slice().reverse()); // ascendente por fecha
      }
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  }, [dispositivo.id, token]);

  // Cargar promedios históricos por hora según rango
  useEffect(() => {
    if (rango !== 'live') {
      setCargandoHisto(true);
      fetch(`${API_URL}/api/dispositivos/${dispositivo.id}/historico?dias=${rango}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : { puntos: [] })
        .then(data => setHisto(data.puntos || []))
        .catch(() => setHisto([]))
        .finally(() => setCargandoHisto(false));
    } else {
      fetchHistorialLive();
    }
  }, [rango, dispositivo.id, token]);

  // Agregar lecturas en tiempo real al historial local
  useEffect(() => {
    if (lectura && rango === 'live') {
      setHistorialLive(prev => [...prev.slice(-49), lectura]);
    }
  }, [lectura, rango]);

  const eliminarDispositivo = () => {
    Alert.alert(
      'Eliminar dispositivo',
      `¿Eliminar "${dispositivo.salon}" y TODOS sus datos?\nEsta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setEliminando(true);
            try {
              const res = await fetch(`${API_URL}/api/dispositivos/${dispositivo.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                navigation.goBack();
              } else {
                Alert.alert('Error', 'No se pudo eliminar el dispositivo');
                setEliminando(false);
              }
            } catch {
              Alert.alert('Error', 'No se pudo eliminar el dispositivo');
              setEliminando(false);
            }
          },
        },
      ]
    );
  };

  // Datos para la gráfica combinada CO / CO₂ / PM2.5 (mismos colores que PC)
  const chartData: Serie[] = rango === 'live'
    ? [
        { data: historialLive.slice(-20).map(l => parseFloat(l.ppm135.toFixed(1))), color: COLORS.blue, nombre: 'CO MQ7 (ppm)' },
        { data: historialLive.slice(-20).map(l => l.co2 > 0 ? l.co2 : 0), color: COLORS.green, nombre: 'CO₂ (ppm)' },
        { data: historialLive.slice(-20).map(l => l.pm25 > 0 ? l.pm25 : 0), color: COLORS.purple, nombre: 'PM2.5 (µg/m³)' },
      ]
    : [
        { data: histo.map(p => p.ppm135), color: COLORS.blue, nombre: 'CO MQ7 (ppm)' },
        { data: histo.map(p => p.co2 > 0 ? p.co2 : 0), color: COLORS.green, nombre: 'CO₂ (ppm)' },
        { data: histo.map(p => p.pm25 > 0 ? p.pm25 : 0), color: COLORS.purple, nombre: 'PM2.5 (µg/m³)' },
      ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.salonTitle}>{dispositivo.salon}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[styles.estadoBadge, { backgroundColor: badge.bg }]}>
              <View style={[styles.estadoDot, { backgroundColor: color }]} />
              <Text style={[styles.estadoText, { color: badge.color }]}>
                {estado === 'offline' ? 'Offline' : lectura?.tipo || 'Sin datos'}
              </Text>
            </View>
            {esAdmin && (
              <TouchableOpacity
                style={styles.btnEliminar}
                onPress={eliminarDispositivo}
                disabled={eliminando}
              >
                <Text style={{ fontSize: 15 }}>{eliminando ? '…' : '🗑'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Pestañas de rango (contenedor gris con pestaña blanca activa, como PC) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {RANGOS.map(([val, label]) => (
          <TouchableOpacity
            key={val}
            style={[styles.tab, rango === val && styles.tabActiva]}
            onPress={() => setRango(val)}
          >
            <Text style={[styles.tabTexto, rango === val && styles.tabTextoActiva]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Métricas actuales */}
      <View style={styles.metricsGrid}>
        <MetricCard label="CO (MQ7)" value={lectura ? lectura.ppm135.toFixed(1) : '--'} unit="ppm" color={COLORS.blue} />
        <MetricCard label="PM2.5" value={lectura && lectura.pm25 >= 0 ? String(lectura.pm25) : '--'} unit="µg/m³" color={lectura && lectura.pm25 > 35 ? COLORS.red : COLORS.green} />
        <MetricCard label="PM10" value={lectura && lectura.pm10 >= 0 ? String(lectura.pm10) : '--'} unit="µg/m³" color={COLORS.purple} />
        <MetricCard
          label="CO₂"
          value={lectura && lectura.co2 >= 0 ? String(lectura.co2) : '--'}
          unit="ppm"
          color={lectura && lectura.co2 > 2000 ? COLORS.red : lectura && lectura.co2 >= 1000 ? COLORS.yellow : COLORS.green}
        />
        <MetricCard label="Última señal" value={formatTiempoRelativo(dispositivo.ultimaConexion)} unit="" color={COLORS.textSecondary} />
      </View>

      {/* Gráfica de historial */}
      {cargandoHisto ? (
        <View style={styles.chartVacio}><Text style={styles.chartVacioTexto}>Cargando historial…</Text></View>
      ) : (
        <>
          <Text style={styles.chartTitulo}>
            {rango === 'live'
              ? `CO, CO₂ y PM2.5 en vivo${historialLive.length > 0 ? ` (últimas ${Math.min(historialLive.length, 20)} lecturas)` : ''}`
              : `Promedios por hora — últimos ${rango} día(s)`}
          </Text>
          <View style={styles.chartBox}>
            <LineChartMulti series={chartData} />
          </View>
          {(rango === 'live' ? historialLive.length <= 1 : histo.length <= 1) && (
            <View style={styles.chartVacio}>
              <Text style={styles.chartVacioTexto}>
                {rango === 'live' ? 'Esperando lecturas en tiempo real…' : 'Sin datos en este rango'}
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Componente de métrica individual ─────────────────────────────────────────
function MetricCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  // Header
  header: {
    paddingTop: 50, paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { marginBottom: 12 },
  backText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  headerInfo: { gap: 8 },
  salonTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.4 },
  estadoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
    alignSelf: 'flex-start',
  },
  estadoDot: { width: 7, height: 7, borderRadius: 4 },
  estadoText: { fontSize: 12, fontWeight: '600' },
  btnEliminar: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: COLORS.redSoft,
    borderWidth: 1.5,
    borderColor: 'rgba(244,63,94,0.22)',
    justifyContent: 'center', alignItems: 'center',
  },
  // Tabs de rango (.tabs-row de PC)
  tabsRow: {
    flexDirection: 'row', gap: 6,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12, padding: 5,
    marginHorizontal: 16, marginTop: 16, marginBottom: 6,
  },
  tab: {
    flexGrow: 1,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9,
    alignItems: 'center',
  },
  tabActiva: {
    backgroundColor: COLORS.card,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  tabTexto: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  tabTextoActiva: { color: COLORS.indigo },
  // Métricas (.modal-metric-card de PC: fondo gris suave)
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 12 },
  metricCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
    paddingVertical: 18, paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 11, color: COLORS.textMuted, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 8, textAlign: 'center',
  },
  metricVal: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  metricUnit: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  // Gráfica
  chartTitulo: {
    fontSize: 13, fontWeight: '700', color: COLORS.textSecondary,
    paddingHorizontal: 20, marginTop: 8, marginBottom: 10,
  },
  chartBox: {
    marginHorizontal: 16,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 32,
    elevation: 2,
  },
  chartVacio: {
    marginHorizontal: 16, marginTop: 10, padding: 36,
    alignItems: 'center',
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
  },
  chartVacioTexto: { color: COLORS.textMuted, fontSize: 13 },
});
