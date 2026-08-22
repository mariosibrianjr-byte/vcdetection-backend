import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { TipoAlerta } from "@prisma/client";
import { emitNuevaAlerta, emitDispositivoUpdate, emitNuevaLectura } from "../services/websocket";
import { enviarPushATodos } from "../services/firebase";
import { enviarEmailAlerta } from "../services/email";

const router = Router();

// ============================================
// Cache de cooldown para evitar alertas repetidas
// Map<dispositivoId, timestampUltimaAlerta>
// ============================================
const alertaCooldown = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

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
  timestamp: string;
}

/**
 * POST /api/sensor/lectura
 * Recibe datos del ESP32, guarda lectura, evalúa alertas.
 * Este endpoint NO requiere autenticación (los ESP32 envían directamente).
 */
router.post("/lectura", async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body as LecturaESP32;

    // Validación básica
    if (!data.dispositivoId) {
      res.status(400).json({ error: "dispositivoId es requerido" });
      return;
    }

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
        timestamp: data.timestamp ?? new Date().toISOString(),
      },
    });

    // ---- Emitir lectura por WebSocket (para dashboard en vivo) ----
    emitNuevaLectura({
      dispositivoId: dispositivo.id,
      ppm135: data.ppm135,
      ppm2: data.ppm2,
      humoDetectado: data.humoDetectado,
      tipo: data.tipo,
      temperatura: data.temperatura,
      humedad: data.humedad,
      pm1: data.pm1,
      pm25: data.pm25,
      pm10: data.pm10,
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
    const debeAlertar = data.humoDetectado === true || (data.pm25 !== -1 && data.pm25 > 35);

    if (debeAlertar) {
      // Verificar cooldown
      const ultimaAlerta = alertaCooldown.get(dispositivo.id);
      const ahora = Date.now();

      if (ultimaAlerta && ahora - ultimaAlerta < COOLDOWN_MS) {
        // Cooldown activo, no crear nueva alerta
        console.log(
          `[SENSOR] Cooldown activo para ${dispositivo.nombre}, faltan ${Math.round(
            (COOLDOWN_MS - (ahora - ultimaAlerta)) / 1000
          )}s`
        );
      } else {
        // Determinar tipo de alerta
        let tipoAlerta: TipoAlerta = TipoAlerta.PM25_ALTO;
        let mensaje = "";

        if (data.tipo.toLowerCase().includes("alta confianza")) {
          tipoAlerta = TipoAlerta.ALTA_CONFIANZA;
          mensaje = `Detección de ALTA CONFIANZA en ${dispositivo.salon}. MQ135: ${data.ppm135}, MQ2: ${data.ppm2}, PM2.5: ${data.pm25}. Se detectaron múltiples indicadores simultáneamente.`;
        } else if (data.tipo.toLowerCase().includes("vape")) {
          tipoAlerta = TipoAlerta.VAPE_CONFIRMADO;
          mensaje = `Vape CONFIRMADO en ${dispositivo.salon}. MQ135: ${data.ppm135} ppm, humedad elevada: ${data.humedad}%. Los niveles de gas y humedad coinciden con patrón de vapeo.`;
        } else if (data.tipo.toLowerCase().includes("cigarrillo")) {
          tipoAlerta = TipoAlerta.CIGARRILLO;
          mensaje = `Cigarrillo detectado en ${dispositivo.salon}. MQ135: ${data.ppm135} ppm. Patrón consistente con humo de tabaco.`;
        } else if (data.pm25 > 35) {
          tipoAlerta = TipoAlerta.PM25_ALTO;
          mensaje = `PM2.5 alto en ${dispositivo.salon}: ${data.pm25} µg/m³ (límite: 35). Posible humo de vape o cigarrillo.`;
        }

        // Crear alerta en DB
        const alerta = await prisma.alerta.create({
          data: {
            dispositivoId: dispositivo.id,
            tipo: tipoAlerta,
            mensaje,
          },
        });

        // Actualizar cooldown
        alertaCooldown.set(dispositivo.id, ahora);

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
