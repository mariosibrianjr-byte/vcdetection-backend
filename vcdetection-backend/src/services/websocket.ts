import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

/**
 * Inicializa Socket.io sobre el servidor HTTP.
 * Se llama una sola vez en index.ts al arrancar.
 */
export function initWebSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", // En producción, limitar a dominios específicos
      methods: ["GET", "POST"],
    },
  });

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
}): void {
  if (!io) return;
  io.emit("nueva-lectura", lectura);
}

export function getIO(): SocketIOServer | null {
  return io;
}
