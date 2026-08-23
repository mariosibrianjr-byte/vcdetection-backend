import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { API_URL, COLORS } from '../config';
import type { Usuario } from '../types';

// ─── Gestión de Usuarios (solo ADMIN — espejo del modal de PC) ───────────────
export default function UsuariosScreen({ navigation }: any) {
  const { token } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [form, setForm] = useState({ nombre: '', rol: 'COORDINADOR', email: '', password: '' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsuarios(data.usuarios || []);
      } else {
        setError('No se pudieron cargar los usuarios');
      }
    } catch {
      setError('No se pudieron cargar los usuarios');
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    setError(''); setOk('');

    if (!form.nombre.trim() || !form.email.trim() || form.password.length < 8) {
      setError('Completa todos los campos (contraseña mínimo 8 caracteres)');
      return;
    }

    setCreando(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setOk(`✅ Usuario ${form.email} creado correctamente`);
        setForm({ nombre: '', rol: 'COORDINADOR', email: '', password: '' });
        cargar();
      } else {
        setError(data.error || 'Error al crear el usuario');
      }
    } catch {
      setError('Error al crear el usuario');
    } finally {
      setCreando(false);
    }
  };

  const eliminar = (u: Usuario) => {
    Alert.alert(
      'Eliminar usuario',
      `¿Eliminar la cuenta de ${u.email}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setError(''); setOk('');
            try {
              const res = await fetch(`${API_URL}/api/auth/users/${u.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await res.json();
              if (res.ok) {
                setOk(`Usuario ${u.email} eliminado`);
                cargar();
              } else {
                setError(data.error || 'Error al eliminar');
              }
            } catch {
              setError('Error al eliminar');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👥 Gestión de usuarios</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {error !== '' && (
          <View style={[styles.msgBox, { borderColor: COLORS.red, backgroundColor: COLORS.redGlow }]}>
            <Text style={[styles.msgTexto, { color: COLORS.red }]}>{error}</Text>
          </View>
        )}
        {ok !== '' && (
          <View style={[styles.msgBox, { borderColor: COLORS.green, backgroundColor: COLORS.greenGlow }]}>
            <Text style={[styles.msgTexto, { color: COLORS.green }]}>{ok}</Text>
          </View>
        )}

        {/* Formulario crear usuario */}
        <View style={styles.formCard}>
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Nombre</Text>
              <TextInput
                style={styles.input}
                value={form.nombre}
                onChangeText={v => setForm({ ...form, nombre: v })}
                placeholder="María Pérez"
                placeholderTextColor={COLORS.textMuted}
                maxLength={60}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Rol</Text>
              <View style={styles.rolSelector}>
                {(['COORDINADOR', 'ADMIN'] as const).map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.rolOpcion, form.rol === r && styles.rolOpcionActiva]}
                    onPress={() => setForm({ ...form, rol: r })}
                  >
                    <Text style={[styles.rolTexto, form.rol === r && styles.rolTextoActivo]}>
                      {r === 'ADMIN' ? 'Administrador' : 'Coordinador'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <Text style={styles.label}>Correo electrónico</Text>
          <TextInput
            style={styles.input}
            value={form.email}
            onChangeText={v => setForm({ ...form, email: v })}
            placeholder="usuario@colegio.edu"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            value={form.password}
            onChangeText={v => setForm({ ...form, password: v })}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
          />

          <TouchableOpacity style={[styles.btnCrear, creando && { opacity: 0.6 }]} onPress={crear} disabled={creando}>
            {creando
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnCrearTexto}>+ Crear usuario</Text>}
          </TouchableOpacity>
        </View>

        {/* Lista de cuentas existentes */}
        <Text style={styles.sectionTitle}>Cuentas existentes ({usuarios.length})</Text>
        {cargando ? (
          <ActivityIndicator color={COLORS.blue} style={{ marginTop: 20 }} />
        ) : (
          <View style={styles.listaCard}>
            {usuarios.map(u => (
              <View key={u.id} style={styles.usuarioItem}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTexto}>{u.nombre.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.usuarioNombre}>{u.nombre}</Text>
                  <Text style={styles.usuarioEmail}>{u.email}</Text>
                </View>
                <View style={[styles.rolBadge, u.rol === 'ADMIN' ? styles.rolAdmin : styles.rolCoord]}>
                  <Text style={[styles.rolBadgeTexto, { color: u.rol === 'ADMIN' ? COLORS.yellow : COLORS.blue }]}>
                    {u.rol === 'ADMIN' ? 'Administrador' : 'Coordinador'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.btnBorrar} onPress={() => eliminar(u)}>
                  <Text style={{ fontSize: 15 }}>🗑</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingTop: 50, paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: COLORS.bgCard, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 8,
  },
  backText: { color: COLORS.blue, fontSize: 14, fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  // Mensajes
  msgBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  msgTexto: { fontSize: 13, fontWeight: '600' },
  // Formulario
  formCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
    gap: 6,
  },
  formRow: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 5, marginTop: 8 },
  input: {
    backgroundColor: COLORS.bgInput,
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    color: COLORS.textPrimary, fontSize: 14,
  },
  rolSelector: { flexDirection: 'row', gap: 6 },
  rolOpcion: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', backgroundColor: COLORS.bgInput,
  },
  rolOpcionActiva: { borderColor: COLORS.blue, backgroundColor: COLORS.blueGlow },
  rolTexto: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  rolTextoActivo: { color: COLORS.blue },
  btnCrear: {
    backgroundColor: COLORS.blue,
    borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', marginTop: 14,
  },
  btnCrearTexto: { color: '#fff', fontSize: 14, fontWeight: '800' },
  // Lista
  sectionTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary, marginTop: 22, marginBottom: 10 },
  listaCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden',
  },
  usuarioItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.blueGlow,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.borderLight,
  },
  avatarTexto: { color: COLORS.blue, fontWeight: '800', fontSize: 15 },
  usuarioNombre: { fontSize: 13.5, fontWeight: '700', color: COLORS.textPrimary },
  usuarioEmail: { fontSize: 11.5, color: COLORS.textMuted, marginTop: 1 },
  rolBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99,
    borderWidth: 1,
  },
  rolAdmin: { borderColor: 'rgba(245,158,11,0.4)', backgroundColor: COLORS.amberGlow },
  rolCoord: { borderColor: 'rgba(59,130,246,0.4)', backgroundColor: COLORS.blueGlow },
  rolBadgeTexto: { fontSize: 10, fontWeight: '700' },
  btnBorrar: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: COLORS.redGlow,
    justifyContent: 'center', alignItems: 'center',
  },
});
