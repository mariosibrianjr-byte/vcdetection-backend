import admin from "firebase-admin";
import { prisma } from "../db";

let firebaseInitialized = false;

/**
 * Inicializa Firebase Admin SDK.
 * Intenta leer las credenciales desde base64 env o archivo.
 */
export function initFirebase(): void {
  if (firebaseInitialized) return;

  try {
    const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (base64) {
      const serviceAccount = JSON.parse(
        Buffer.from(base64, "base64").toString("utf-8")
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log("[FCM] Firebase inicializado (base64)");
    } else if (filePath) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const serviceAccount = require(filePath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log("[FCM] Firebase inicializado (archivo)");
    } else {
      console.warn(
        "[FCM] No se encontró FIREBASE_SERVICE_ACCOUNT_BASE64 ni FIREBASE_SERVICE_ACCOUNT_PATH. Push notifications deshabilitadas."
      );
    }
  } catch (error) {
    console.error("[FCM] Error inicializando Firebase:", error);
  }
}

/**
 * Envía push notification a todos los usuarios con tokenFCM.
 */
export async function enviarPushATodos(data: {
  titulo: string;
  cuerpo: string;
  salon: string;
  tipo: string;
}): Promise<void> {
  if (!firebaseInitialized) {
    console.warn("[FCM] Firebase no inicializado, push omitido");
    return;
  }

  try {
    // Obtener todos los tokens FCM de los usuarios
    const usuarios = await prisma.usuario.findMany({
      where: {
        tokenFCM: { not: null },
      },
      select: { tokenFCM: true },
    });

    const tokens = usuarios
      .map((u) => u.tokenFCM)
      .filter((t): t is string => t !== null && t.length > 0);

    if (tokens.length === 0) {
      console.log("[FCM] No hay tokens FCM registrados");
      return;
    }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: data.titulo,
        body: data.cuerpo,
      },
      data: {
        salon: data.salon,
        tipo: data.tipo,
        timestamp: new Date().toISOString(),
      },
      // Configuración para que la notificación sea de alta prioridad
      android: {
        priority: "high",
        notification: {
          channelId: "alertas_vcdetection",
          priority: "high",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: data.titulo,
              body: data.cuerpo,
            },
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `[FCM] Push enviado: ${response.successCount} éxitos, ${response.failureCount} fallos`
    );

    // Limpiar tokens inválidos
    if (response.failureCount > 0) {
      const tokensInvalidos: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          resp.error?.code === "messaging/registration-token-not-registered"
        ) {
          tokensInvalidos.push(tokens[idx]);
        }
      });

      if (tokensInvalidos.length > 0) {
        await prisma.usuario.updateMany({
          where: { tokenFCM: { in: tokensInvalidos } },
          data: { tokenFCM: null },
        });
        console.log(`[FCM] ${tokensInvalidos.length} tokens inválidos limpiados`);
      }
    }
  } catch (error) {
    console.error("[FCM] Error enviando push:", error);
  }
}
