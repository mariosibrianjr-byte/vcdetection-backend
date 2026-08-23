import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { COLORS, API_URL } from '../config';
import type { Alerta } from '../types';
import { tipoAlertaIcono, tipoAlertaLabel, formatTiempoRelativo } from '../types';

export default function AlertasScreen() {
  const { token } = useAuth();
  const { alertasNuevas } = useSocket();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAlertas = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/alertas?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAlertas(data.alertas || []);
      }
    } catch (err) {
      console.error('Error cargando alertas:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchAlertas();
  }, [fetchAlertas]);

  // Agregar alertas que llegan en tiempo real
  useEffect(() => {
    if (alertasNuevas.length > 0) {
      setAlertas(prev => {
        const nuevas = alertasNuevas.filter(a => !prev.some(p => p.id === a.id));
        return [...nuevas, ...prev];
      });
    }
  }, [alertasNuevas]);

  const marcarVista = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/alertas/${id}/vista`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, vista: true } : a));
    } catch (err) {
      console.error('Error marcando alerta:', err);
    }
  };

  const marcarTodas = async () => {
    try {
      await fetch(`${API_URL}/api/alertas/marcar-todas`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setAlertas(prev => prev.map(a => ({ ...a, vista: true })));
    } catch (err) {
      console.error('Error marcando alertas:', err);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAlertas();
    setRefreshing(false);
  };

  const noVistas = alertas.filter(a => !a.vista).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alertas</Text>
        {noVistas > 0 && (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{noVistas} nuevas</Text>
            </View>
            <TouchableOpacity style={styles.marcarTodasBtn} onPress={marcarTodas}>
              <Text style={styles.marcarTodasTexto}>Marcar todas</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <FlatList
        data={alertas}
        keyExtractor={a => a.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} />
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>✅</Text>
            <Text style={styles.emptyText}>Sin alertas</Text>
            <Text style={styles.emptySub}>Todo en orden por ahora</Text>
          </View>
        }
        renderItem={({ item }) => {
          const salon = item.dispositivo?.salon || item.dispositivoId;
          return (
            <TouchableOpacity
              style={[styles.alertaItem, !item.vista && styles.alertaNoVista]}
              onPress={() => !item.vista && marcarVista(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.alertaIcono}>
                <Text style={{ fontSize: 20 }}>{tipoAlertaIcono(item.tipo)}</Text>
              </View>
              <View style={styles.alertaInfo}>
                <Text style={styles.alertaSalon}>{salon}</Text>
                <Text style={styles.alertaTipo}>{tipoAlertaLabel(item.tipo)}</Text>
                <Text style={styles.alertaMsg} numberOfLines={2}>{item.mensaje}</Text>
                <Text style={styles.alertaTime}>{formatTiempoRelativo(item.fecha)}</Text>
              </View>
              {!item.vista && <View style={styles.dotNueva} />}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  badge: { backgroundColor: COLORS.redGlow, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
  badgeText: { color: COLORS.red, fontSize: 12, fontWeight: '700' },
  marcarTodasBtn: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: COLORS.borderLight },
  marcarTodasTexto: { color: COLORS.blue, fontSize: 12, fontWeight: '700' },
  // Alerta Item
  alertaItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  alertaNoVista: { backgroundColor: 'rgba(239,68,68,0.04)' },
  alertaIcono: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertaInfo: { flex: 1 },
  alertaSalon: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  alertaTipo: { fontSize: 12, fontWeight: '600', color: COLORS.red, marginTop: 1 },
  alertaMsg: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 },
  alertaTime: { fontSize: 11, color: COLORS.textMuted, marginTop: 4, fontVariant: ['tabular-nums'] },
  dotNueva: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red, marginTop: 6 },
  // Empty
  emptyBox: { padding: 60, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  emptySub: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
});
