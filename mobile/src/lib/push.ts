import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { API_URL } from '../config';

/**
 * Solicita permisos de notificación, obtiene el token FCM del dispositivo
 * y lo registra en el backend para recibir alertas de humo.
 * Llamar después de un login exitoso (o al restaurar sesión).
 */
export async function registrarPushToken(authToken: string): Promise<void> {
  try {
    // Los emuladores no soportan push
    if (!Device.isDevice) {
      console.log('[PUSH] Omitido: no es un dispositivo físico');
      return;
    }

    const { status: statusActual } = await Notifications.getPermissionsAsync();
    let status = statusActual;

    if (status !== 'granted') {
      const pedido = await Notifications.requestPermissionsAsync();
      status = pedido.status;
    }

    if (status !== 'granted') {
      console.log('[PUSH] Permisos de notificación denegados');
      return;
    }

    // Canal Android con el mismo ID que usa el backend al enviar
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alertas_vcdetection', {
        name: 'Alertas de humo',
        description: 'Notificaciones de detección de vape/cigarrillo',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#f43f5e',
        sound: 'default',
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    // Token FCM nativo (requiere build EAS con google-services.json)
    const tokenRes = await Notifications.getDevicePushTokenAsync();
    const fcmToken = String(tokenRes.data);

    const res = await fetch(`${API_URL}/api/auth/fcm-token`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ tokenFCM: fcmToken }),
    });

    if (!res.ok) throw new Error(`Backend respondió ${res.status}`);

    console.log('[PUSH] Token FCM registrado correctamente');
  } catch (e) {
    // En Expo Go esto falla (no hay config nativa); no rompe la app
    console.log('[PUSH] No se pudo registrar el token:', e);
  }
}
