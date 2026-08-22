import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../db";
import { TipoAlerta } from "@prisma/client";
import { emitNuevaAlerta, emitDispositivoUpdate, emitNuevaLectura } from "../services/websocket";
import { enviarPushATodos } from "../services/firebase";
import { enviarEmailAlerta } from "../services/email";

const router = Router();

// ============================================
// Cooldown de alertas: se consulta contra la última alerta
// guardada en la BD del dispositivo (sobrevive reinicios).
// ============================================
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

// ============================================
// Autenticación del ESP32 mediante API key compartida.
// El firmware debe enviar el header: x-device-key: <DEVICE_API_KEY>
// ============================================
function comparacionSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function verificarApiKeyDispositivo(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = process.env.DEVICE_API_KEY;
  const recibida = req.headers["x-device-key"];

  if (!apiKey) {
    res.status(500).json({
      error: "DEVICE_API_KEY no configurada en el servidor. Configúrala en el .env",
    });
    return;
  }

  if (typeof recibida !== "string" || !comparacionSegura(recibida, apiKey)) {
    res.status(401).json({ error: "API key de dispositivo inválida" });
    return;
  }

  next();
}

// ============================================
// Interfaz del JSON que envía el ESP32
// ============================================
interface LecturaESP32 {
  dispositivoId: string;
  ppm135: number;
  ppm2: number;
  humoDetectado: boolean;
  tipo: string;
  picoSubito: boolean;
  temperatura: number;
  humedad: number;
  pm1: number;
  pm25: number;
  pm10: number;
  co2: number;
  timestamp: string;
}

/**
 * POST /api/sensor/lectura
 * Recibe datos del ESP32, guarda lectura, evalúa alertas.
 * Requiere el header x-device-key con la DEVICE_API_KEY configurada.
 */
router.post(
  "/lectura",
  verificarApiKeyDispositivo,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const data = req.body as LecturaESP32;

      // Validación básica
      if (!data.dispositivoId || typeof data.dispositivoId !== "string") {
        res.status(400).json({ error: "dispositivoId es requerido" });
        return;
      }

      // Normalizar valores (evita undefined llegando a la BD y al WebSocket)
      const valores = {
        ppm135: data.ppm135 ?? 0,
        ppm2: data.ppm2 ?? 0,
        humoDetectado: data.humoDetectado ?? false,
        tipo: data.tipo ?? "Desconocido",
        picoSubito: data.picoSubito ?? false,
        temperatura: data.temperatura ?? 0,
        humedad: data.humedad ?? 0,
        pm1: data.pm1 ?? -1,
        pm25: data.pm25 ?? -1,
        pm10: data.pm10 ?? -1,
        co2: data.co2 ?? -1,
      };

    // ---- Upsert del dispositivo ----
    const dispositivo = await prisma.dispositivo.upsert({
      where: { nombre: data.dispositivoId },
      update: {
        ultimaConexion: new Date(),
        online: true,
      },
      create: {
        nombre: data.dispositivoId,
        salon: data.dispositivoId.replace(/_/g, " "), // "SALON_01" → "SALON 01"
        ultimaConexion: new Date(),
        online: true,
      },
    });

    // ---- Guardar lectura ----
    const lectura = await prisma.lectura.create({
      data: {
        dispositivoId: dispositivo.id,
        ...valores,
        timestamp: data.timestamp ?? new Date().toISOString(),
      },
    });

    // ---- Emitir lectura por WebSocket (para dashboard en vivo) ----
    emitNuevaLectura({
      dispositivoId: dispositivo.id,
      ...valores,
    });

    // ---- Emitir actualización de dispositivo ----
    emitDispositivoUpdate({
      id: dispositivo.id,
      nombre: dispositivo.nombre,
      salon: dispositivo.salon,
      online: true,
      ultimaConexion: new Date(),
    });

    // ---- Evaluar si se debe disparar alerta ----
    const debeAlertar =
      valores.humoDetectado === true || (valores.pm25 !== -1 && valores.pm25 > 35);

    if (debeAlertar) {
      // Verificar cooldown contra la última alerta en la BD
      // (sobrevive reinicios del servidor y funciona con varias instancias)
      const alertaReciente = await prisma.alerta.findFirst({
        where: {
          dispositivoId: dispositivo.id,
          fecha: { gte: new Date(Date.now() - COOLDOWN_MS) },
        },
        select: { id: true },
      });

      if (alertaReciente) {
        // Cooldown activo, no crear nueva alerta
        console.log(`[SENSOR] Cooldown activo para ${dispositivo.nombre}`);
      } else {
        // Determinar tipo de alerta
        let tipoAlerta: TipoAlerta = TipoAlerta.PM25_ALTO;
        let mensaje = "";
        const tipoTexto = valores.tipo.toLowerCase(); // FIX: evita crash si el ESP32 no envía "tipo"

        if (tipoTexto.includes("alta confianza")) {
          tipoAlerta = TipoAlerta.ALTA_CONFIANZA;
          mensaje = `Detección de ALTA CONFIANZA en ${dispositivo.salon}. MQ135: ${valores.ppm135}, MQ2: ${valores.ppm2}, PM2.5: ${valores.pm25}. Se detectaron múltiples indicadores simultáneamente.`;
        } else if (tipoTexto.includes("vape")) {
          tipoAlerta = TipoAlerta.VAPE_CONFIRMADO;
          mensaje = `Vape CONFIRMADO en ${dispositivo.salon}. MQ135: ${valores.ppm135} ppm, humedad elevada: ${valores.humedad}%. Los niveles de gas y humedad coinciden con patrón de vapeo.`;
        } else if (tipoTexto.includes("cigarrillo")) {
          tipoAlerta = TipoAlerta.CIGARRILLO;
          mensaje = `Cigarrillo detectado en ${dispositivo.salon}. MQ135: ${valores.ppm135} ppm. Patrón consistente con humo de tabaco.`;
        } else if (valores.pm25 > 35) {
          tipoAlerta = TipoAlerta.PM25_ALTO;
          mensaje = `PM2.5 alto en ${dispositivo.salon}: ${valores.pm25} µg/m³ (límite: 35). Posible humo de vape o cigarrillo.`;
        }

        // Crear alerta en DB
        const alerta = await prisma.alerta.create({
          data: {
            dispositivoId: dispositivo.id,
            tipo: tipoAlerta,
            mensaje,
          },
        });

        console.log(
          `[ALERTA] ${tipoAlerta} en ${dispositivo.salon}: ${mensaje}`
        );

        // Emitir alerta por WebSocket
        emitNuevaAlerta({
          id: alerta.id,
          tipo: tipoAlerta,
          mensaje,
          salon: dispositivo.salon,
          dispositivoId: dispositivo.id,
          fecha: alerta.fecha,
        });

        // Enviar push notification (async, no bloquea respuesta)
        enviarPushATodos({
          titulo: `⚠️ Alerta: ${tipoAlerta.replace(/_/g, " ")}`,
          cuerpo: `${dispositivo.salon}: ${mensaje}`,
          salon: dispositivo.salon,
          tipo: tipoAlerta,
        }).catch((err) => console.error("[SENSOR] Error enviando push:", err));

        // Enviar email (async, no bloquea respuesta)
        enviarEmailAlerta({
          salon: dispositivo.salon,
          tipo: tipoAlerta,
          mensaje,
          timestamp: data.timestamp || new Date().toISOString(),
        }).catch((err) => console.error("[SENSOR] Error enviando email:", err));
      }
    }

    res.status(201).json({
      ok: true,
      lecturaId: lectura.id,
      alertaDisparada: debeAlertar,
    });
  } catch (error) {
    console.error("[SENSOR] Error procesando lectura:", error);
    res.status(500).json({ error: "Error interno al procesar lectura" });
  }
});

export default router;
