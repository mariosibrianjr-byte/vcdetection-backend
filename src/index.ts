import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import http from "http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { prisma } from "./db";
import { initWebSocket } from "./services/websocket";
import { initFirebase } from "./services/firebase";
import { initEmail } from "./services/email";

// Rutas
import sensorRoutes from "./routes/sensor";
import authRoutes from "./routes/auth";
import alertasRoutes from "./routes/alertas";
import dispositivosRoutes from "./routes/dispositivos";

// ============================================
// Configuración de Express
// ============================================
const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Render y otros hosts ponen la app detrás de un proxy inverso.
// Necesario para que express-rate-limit vea la IP real del cliente.
app.set("trust proxy", 1);

// Orígenes permitidos vía variable de entorno (separados por coma).
import { allowedOrigins } from "./config";

// Middleware global
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.json());

// Rate limiting para autenticación (evita brute force de login/registro)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta de nuevo en 15 minutos" },
});
app.use("/api/auth", authLimiter);

// Logging de requests en desarrollo
if (process.env.NODE_ENV === "development") {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ============================================
// Rutas
// ============================================
app.use("/api/sensor", sensorRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/alertas", alertasRoutes);
app.use("/api/dispositivos", dispositivosRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    servicio: "VCDetection Backend",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 404 para rutas no encontradas
app.use((_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// ============================================
// Servidor HTTP + WebSocket
// ============================================
const httpServer = http.createServer(app);
initWebSocket(httpServer);

// ============================================
// Inicializar servicios externos
// ============================================
initFirebase();
initEmail();

// ============================================
// Chequeo periódico de dispositivos offline
// Cada 30 segundos, marcar como offline los dispositivos
// que no han enviado datos en más de 30 segundos.
// ============================================
const OFFLINE_CHECK_INTERVAL_MS = 30 * 1000;
const OFFLINE_THRESHOLD_MS = 30 * 1000;

setInterval(async () => {
  try {
    const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const result = await prisma.dispositivo.updateMany({
      where: {
        online: true,
        ultimaConexion: { lt: threshold },
      },
      data: { online: false },
    });

    if (result.count > 0) {
      console.log(`[OFFLINE CHECK] ${result.count} dispositivo(s) marcado(s) como offline`);
    }
  } catch (error) {
    console.error("[OFFLINE CHECK] Error:", error);
  }
}, OFFLINE_CHECK_INTERVAL_MS);

// ============================================
// Arrancar servidor
// ============================================
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         VCDetection Backend v1.0.0           ║
║══════════════════════════════════════════════║
║  Servidor:   http://localhost:${PORT}            ║
║  Entorno:    ${process.env.NODE_ENV || "development"}                   ║
║  WebSocket:  Activo                          ║
╚══════════════════════════════════════════════╝
  `);
});

// Manejar cierre graceful
process.on("SIGTERM", async () => {
  console.log("[SERVER] SIGTERM recibido, cerrando...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[SERVER] SIGINT recibido, cerrando...");
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
