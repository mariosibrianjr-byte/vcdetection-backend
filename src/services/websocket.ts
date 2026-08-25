import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { allowedOrigins } from "../config";

let io: SocketIOServer | null = null;

/**
 * Middleware de autenticación del handshake de Socket.io.
 * El cliente debe enviar su JWT en auth.token; si es inválido o
 * falta, se rechaza la conexión (nadie recibe lecturas/alertas
 * sin estar autenticado).
 */
function autenticarHandshake(socket: any, next: (err?: Error) => void): void {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    next(new Error("Servidor sin JWT_SECRET configurado"));
    return;
  }

  const token = socket.handshake?.auth?.token;
  if (!token || typeof token !== "string") {
    next(new Error("No autenticado: falta token"));
    return;
  }

  try {
    jwt.verify(token, secret);
    next();
  } catch {
    next(new Error("Token inválido o expirado"));
  }
}

/**
 * Inicializa Socket.io sobre el servidor HTTP.
 * Se llama una sola vez en index.ts al arrancar.
 */
export function initWebSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : "*", // En producción, limitar a dominios específicos vía CORS_ORIGIN
      methods: ["GET", "POST"],
    },
  });

  io.use(autenticarHandshake);

  io.on("connection", (socket) => {
    console.log(`[WS] Cliente conectado: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`[WS] Cliente desconectado: ${socket.id}`);
    });
  });

  console.log("[WS] Socket.io inicializado");
  return io;
}

/**
 * Emite un evento de nueva alerta a todos los clientes conectados.
 */
export function emitNuevaAlerta(alerta: {
  id: string;
  tipo: string;
  mensaje: string;
  salon: string;
  dispositivoId: string;
  fecha: Date;
}): void {
  if (!io) {
    console.warn("[WS] Socket.io no inicializado, no se puede emitir alerta");
    return;
  }

  io.emit("nueva-alerta", alerta);
  console.log(`[WS] Alerta emitida: ${alerta.tipo} en ${alerta.salon}`);
}

/**
 * Emite actualización de estado de dispositivo.
 */
export function emitDispositivoUpdate(dispositivo: {
  id: string;
  nombre: string;
  salon: string;
  online: boolean;
  ultimaConexion: Date;
}): void {
  if (!io) return;
  io.emit("dispositivo-update", dispositivo);
}

/**
 * Emite nueva lectura en tiempo real (para dashboard).
 */
export function emitNuevaLectura(lectura: {
  dispositivoId: string;
  ppm135: number;
  ppm2: number;
  humoDetectado: boolean;
  tipo: string;
  temperatura: number;
  humedad: number;
  pm1: number;
  pm25: number;
  pm10: number;
  co2: number;
}): void {
  if (!io) return;
  io.emit("nueva-lectura", lectura);
}

export function getIO(): SocketIOServer | null {
  return io;
}
