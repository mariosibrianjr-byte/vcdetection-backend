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

  // Fondo pastel del icono según tipo (icono-vape/icono-cig/icono-alta/icono-pm de PC)
  const iconoBg = (tipo: string) =>
    tipo === 'VAPE_CONFIRMADO' ? COLORS.yellowSoft :
    tipo === 'PM25_ALTO' ? COLORS.purpleSoft : COLORS.redSoft;

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
            <View style={styles.okPill}><Text style={styles.okPillText}>OK</Text></View>
            <Text style={styles.emptyText}>Sin alertas activas</Text>
            <Text style={styles.emptySub}>Ambiente escolar en orden</Text>
          </View>
        }
        renderItem={({ item }) => {
          const salon = item.dispositivo?.salon || item.dispositivoId;
          return (
            <View style={[styles.alertaItem, !item.vista && styles.alertaNoVista]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={[styles.alertaIcono, { backgroundColor: iconoBg(item.tipo) }]}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.textPrimary }}>{tipoAlertaIcono(item.tipo)}</Text>
                </View>
                <View style={styles.alertaInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.alertaSalon}>{salon}</Text>
                    <View style={styles.tipoPill}>
                      <Text style={styles.tipoPillTexto}>{tipoAlertaLabel(item.tipo)}</Text>
                    </View>
                  </View>
                  <Text style={styles.alertaMsg} numberOfLines={2}>{item.mensaje}</Text>
                  <Text style={styles.alertaTime}>{formatTiempoRelativo(item.fecha)}</Text>
                </View>
                {!item.vista && <View style={styles.dotNueva} />}
              </View>

              {/* Botones de acción rápida */}
              <View style={styles.alertaAccionesRow}>
                <TouchableOpacity
                  style={styles.btnAccionCamino}
                  onPress={() => {
                    marcarVista(item.id);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnAccionCaminoTexto}>Voy en camino</Text>
                </TouchableOpacity>
                {!item.vista && (
                  <TouchableOpacity
                    style={styles.btnAccionVista}
                    onPress={() => marcarVista(item.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.btnAccionVistaTexto}>Marcar como vista</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
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
    gap: 10,
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  badge: {
    backgroundColor: COLORS.redSoft,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.25)',
    paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999,
  },
  badgeText: { color: COLORS.red, fontSize: 11, fontWeight: '700' },
  marcarTodasBtn: {
    marginLeft: 'auto',
    backgroundColor: COLORS.card,
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1.5, borderColor: COLORS.borderLight,
  },
  marcarTodasTexto: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  // Alerta Item
  alertaItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 1,
  },
  alertaNoVista: { backgroundColor: COLORS.redSoft, borderColor: 'rgba(244,63,94,0.15)' },
  alertaIcono: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertaInfo: { flex: 1 },
  alertaSalon: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  tipoPill: {
    backgroundColor: COLORS.bgSecondary,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99,
  },
  tipoPillTexto: { fontSize: 9.5, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  alertaMsg: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, lineHeight: 17 },
  alertaTime: {
    fontSize: 11, color: COLORS.textMuted, marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  dotNueva: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red, marginTop: 6 },
  // Acciones Rápidas
  alertaAccionesRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  btnAccionCamino: {
    backgroundColor: '#4f46e5',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  btnAccionCaminoTexto: { color: '#ffffff', fontSize: 11.5, fontWeight: '700' },
  btnAccionVista: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  btnAccionVistaTexto: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: '600' },
  // Empty
  emptyBox: { padding: 60, alignItems: 'center' },
  okPill: {
    backgroundColor: COLORS.greenSoft,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
    marginBottom: 10,
  },
  okPillText: { color: COLORS.green, fontWeight: '800', fontSize: 13 },
  emptyText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  emptySub: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
});
