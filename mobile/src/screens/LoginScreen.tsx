import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS, FONT } from '../config';

const { width, height } = Dimensions.get('window');

export default function LoginScreen() {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Animaciones
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleLogin = () => {
    if (!email || !password) return;
    setError('');
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true })
    ]).start(async () => {
      try {
        await login(email, password);
      } catch (err) {
        setError('Credenciales incorrectas');
      }
    });
  };

  return (
    <View style={styles.container}>
      {/* Fondo decorativo (simulando gradiente radial) */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <Animated.View style={[styles.headerContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={styles.logoIcon}>🔍</Text>
          <Text style={styles.title}>VCDetection</Text>
          <Text style={styles.subtitle}>Panel de Control Premium</Text>
        </Animated.View>

        <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>CORREO ELECTRÓNICO</Text>
            <TextInput
              style={styles.input}
              placeholder="admin@vcdetection.com"
              placeholderTextColor={COLORS.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>CONTRASEÑA</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          ) : null}

          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <TouchableOpacity 
              style={[styles.button, (!email || !password || loading) && styles.buttonDisabled]} 
              onPress={handleLogin}
              disabled={!email || !password || loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>INGRESAR AL SISTEMA</Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        <Animated.Text style={[styles.footerText, { opacity: fadeAnim }]}>
          Monitoreo de Calidad de Aire e IoT v2.0
        </Animated.Text>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    position: 'relative',
  },
  glowTop: {
    position: 'absolute',
    top: -100,
    left: -50,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: COLORS.blueGlow,
    opacity: 0.6,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -100,
    right: -50,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: COLORS.purple,
    opacity: 0.15,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    zIndex: 1,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoIcon: {
    fontSize: 50,
    marginBottom: 10,
    textShadowColor: COLORS.blue,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  title: {
    fontFamily: FONT.bold,
    fontSize: 32,
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: 16,
    color: COLORS.blue,
    marginTop: 5,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontFamily: FONT.bold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: 16,
    color: COLORS.textPrimary,
    fontFamily: FONT.regular,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    color: COLORS.red,
    fontSize: 13,
    fontFamily: FONT.regular,
    textAlign: 'center',
  },
  button: {
    backgroundColor: COLORS.blue,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: COLORS.blue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonDisabled: {
    backgroundColor: '#1e2d45',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#ffffff',
    fontFamily: FONT.bold,
    fontSize: 14,
    letterSpacing: 1,
  },
  footerText: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONT.regular,
    letterSpacing: 0.5,
  },
});
