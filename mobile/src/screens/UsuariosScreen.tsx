import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { API_URL, COLORS } from '../config';
import type { Usuario } from '../types';

// ─── Gestión de Usuarios (solo ADMIN — tema claro pastel como PC) ────────────
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
          <View style={[styles.msgBox, { borderColor: 'rgba(244,63,94,0.22)', backgroundColor: COLORS.redSoft }]}>
            <Text style={[styles.msgTexto, { color: COLORS.red }]}>{error}</Text>
          </View>
        )}
        {ok !== '' && (
          <View style={[styles.msgBox, { borderColor: 'rgba(16,185,129,0.25)', backgroundColor: COLORS.greenSoft }]}>
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
                placeholderTextColor="#b6c0d4"
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
            placeholderTextColor="#b6c0d4"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            value={form.password}
            onChangeText={v => setForm({ ...form, password: v })}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor="#b6c0d4"
            secureTextEntry
          />

          <TouchableOpacity onPress={crear} disabled={creando} activeOpacity={0.85} style={[styles.btnCrearWrapper, creando && { opacity: 0.55 }]}>
            <LinearGradient
              colors={COLORS.gradPrimary as unknown as [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.btnCrear}
            >
              {creando
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.btnCrearTexto}>+ Crear usuario</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Lista de cuentas existentes */}
        <Text style={styles.sectionTitle}>Cuentas existentes ({usuarios.length})</Text>
        {cargando ? (
          <ActivityIndicator color={COLORS.blue} style={{ marginTop: 20 }} />
        ) : (
          <View style={{ gap: 8 }}>
            {usuarios.map(u => (
              <View key={u.id} style={styles.usuarioItem}>
                <LinearGradient
                  colors={COLORS.gradPrimary as unknown as [string, string, ...string[]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarTexto}>{u.nombre.charAt(0).toUpperCase()}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.usuarioNombre}>{u.nombre}</Text>
                  <Text style={styles.usuarioEmail}>{u.email}</Text>
                </View>
                <View style={[styles.rolBadge, u.rol === 'ADMIN' ? styles.rolAdmin : styles.rolCoord]}>
                  <Text style={[styles.rolBadgeTexto, { color: u.rol === 'ADMIN' ? '#7c3aed' : '#0369a1' }]}>
                    {u.rol === 'ADMIN' ? 'Admin' : 'Coord.'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.btnBorrar} onPress={() => eliminar(u)}>
                  <Text style={{ fontSize: 13 }}>🗑</Text>
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
    backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 8,
  },
  backText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.3 },
  // Mensajes (.login-error / .msg-ok de PC)
  msgBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  msgTexto: { fontSize: 13, fontWeight: '600' },
  // Formulario (tarjeta blanca)
  formCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 32,
    elevation: 2,
  },
  formRow: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 7, marginTop: 10 },
  input: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13,
    color: COLORS.textPrimary, fontSize: 14,
  },
  rolSelector: { flexDirection: 'row', gap: 6 },
  rolOpcion: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', backgroundColor: COLORS.bgSecondary,
  },
  rolOpcionActiva: { borderColor: '#a5b8fc', backgroundColor: COLORS.purpleSoft },
  rolTexto: { fontSize: 12.5, fontWeight: '600', color: COLORS.textSecondary },
  rolTextoActivo: { color: COLORS.indigo },
  btnCrearWrapper: { marginTop: 16 },
  btnCrear: {
    borderRadius: 10, paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 6,
  },
  btnCrearTexto: { color: '#fff', fontSize: 15, fontWeight: '700' },
  // Lista (.usuario-item de PC: fondo gris suave)
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: 24, marginBottom: 10,
  },
  usuarioItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 14,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarTexto: { color: '#fff', fontWeight: '800', fontSize: 16 },
  usuarioNombre: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  usuarioEmail: { fontSize: 12, color: COLORS.textSecondary },
  rolBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  rolAdmin: { backgroundColor: COLORS.purpleSoft },
  rolCoord: { backgroundColor: COLORS.blueSoft },
  rolBadgeTexto: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  btnBorrar: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: COLORS.redSoft,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(244,63,94,0.22)',
  },
});
