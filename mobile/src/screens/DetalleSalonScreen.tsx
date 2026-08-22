import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions
} from 'react-native';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { COLORS, API_URL } from '../config';
import type { Dispositivo, Lectura, EstadoSalon } from '../types';
import { calcularEstado, formatTiempoRelativo } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Mini gráfica simple usando Views (sin dependencias pesadas) ─────────────
function MiniChart({ data, color, maxVal }: { data: number[]; color: string; maxVal?: number }) {
  if (data.length < 2) return null;
  const max = maxVal || Math.max(...data, 1);
  const barWidth = Math.max(2, (SCREEN_WIDTH - 100) / Math.min(data.length, 30));

  return (
    <View style={miniStyles.container}>
      {data.slice(-30).map((val, i) => {
        const height = Math.max(2, (val / max) * 60);
        return (
          <View
            key={i}
            style={[miniStyles.bar, { height, width: barWidth - 1, backgroundColor: color }]}
          />
        );
      })}
    </View>
  );
}

const miniStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 70,
    gap: 1,
    paddingVertical: 4,
  },
  bar: { borderRadius: 2, opacity: 0.8 },
});

// ─── Pantalla de Detalle de Salón ─────────────────────────────────────────────
export default function DetalleSalonScreen({ route, navigation }: any) {
  const { dispositivo } = route.params as { dispositivo: Dispositivo };
  const { lecturas } = useSocket();
  const { token } = useAuth();
  const [historial, setHistorial] = useState<Lectura[]>([]);

  const lectura = lecturas[dispositivo.id];
  const estado = calcularEstado(dispositivo, lectura);

  const colorMap: Record<EstadoSalon, string> = {
    verde: COLORS.green, amarillo: COLORS.yellow, rojo: COLORS.red, offline: COLORS.gray,
  };
  const color = colorMap[estado];

  // Cargar historial inicial desde el backend
  const fetchHistorial = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/dispositivos/${dispositivo.id}/lecturas?limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setHistorial(data.lecturas || []);
      }
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  }, [dispositivo.id, token]);

  useEffect(() => {
    fetchHistorial();
  }, [fetchHistorial]);

  // Agregar lecturas en tiempo real al historial local
  useEffect(() => {
    if (lectura) {
      setHistorial(prev => [...prev.slice(-49), lectura]);
    }
  }, [lectura]);

  // Datos para las gráficas
  const ppmData = historial.map(l => l.ppm135);
  const humData = historial.map(l => l.humedad);
  const tempData = historial.map(l => l.temperatura);
  const pmData = historial.map(l => Math.max(0, l.pm25));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.salonTitle}>{dispositivo.salon}</Text>
          <View style={[styles.estadoBadge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.estadoText, { color }]}>
              {lectura?.tipo || (dispositivo.online ? 'Sin datos' : 'Offline')}
            </Text>
          </View>
        </View>
      </View>

      {/* Métricas actuales */}
      <View style={styles.metricsGrid}>
        <MetricCard label="MQ135" value={lectura ? lectura.ppm135.toFixed(1) : '--'} unit="ppm" color={COLORS.blue} />
        <MetricCard label="MQ2" value={lectura ? lectura.ppm2.toFixed(1) : '--'} unit="ppm" color={COLORS.purple} />
        <MetricCard label="PM2.5" value={lectura && lectura.pm25 >= 0 ? String(lectura.pm25) : '--'} unit="µg/m³" color={lectura && lectura.pm25 > 35 ? COLORS.red : COLORS.green} />
        <MetricCard label="Temperatura" value={lectura ? lectura.temperatura.toFixed(1) : '--'} unit="°C" color={COLORS.yellow} />
        <MetricCard label="Humedad" value={lectura ? lectura.humedad.toFixed(1) : '--'} unit="%" color={COLORS.blue} />
        <MetricCard label="Última señal" value={formatTiempoRelativo(dispositivo.ultimaConexion)} unit="" color={COLORS.textSecondary} />
      </View>

      {/* Gráficas */}
      {historial.length > 1 && (
        <>
          <Text style={styles.chartTitle}>📊 MQ135 (últimas {Math.min(historial.length, 30)} lecturas)</Text>
          <View style={styles.chartBox}>
            <MiniChart data={ppmData} color={COLORS.blue} />
          </View>

          <Text style={styles.chartTitle}>💧 Humedad (%)</Text>
          <View style={styles.chartBox}>
            <MiniChart data={humData} color={COLORS.purple} maxVal={100} />
          </View>

          <Text style={styles.chartTitle}>🌡️ Temperatura (°C)</Text>
          <View style={styles.chartBox}>
            <MiniChart data={tempData} color={COLORS.yellow} />
          </View>

          {pmData.some(v => v > 0) && (
            <>
              <Text style={styles.chartTitle}>💨 PM2.5 (µg/m³)</Text>
              <View style={styles.chartBox}>
                <MiniChart data={pmData} color={COLORS.red} />
              </View>
            </>
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
  header: { paddingTop: 50, paddingHorizontal: 20, paddingBottom: 20, backgroundColor: COLORS.bgCard, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { marginBottom: 12 },
  backText: { color: COLORS.blue, fontSize: 14, fontWeight: '600' },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  salonTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  estadoBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99 },
  estadoText: { fontSize: 12, fontWeight: '700' },
  // Métricas
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 10 },
  metricCard: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  metricLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  metricVal: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  metricUnit: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },
  // Gráficas
  chartTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, paddingHorizontal: 20, marginTop: 20, marginBottom: 6 },
  chartBox: {
    marginHorizontal: 16,
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});
