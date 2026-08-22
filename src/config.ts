/**
 * Orígenes permitidos para CORS y WebSocket.
 * Configurar vía variable de entorno CORS_ORIGIN (separados por coma).
 * Si no se configura, se permite cualquier origen (modo permisivo).
 */
export const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0 && process.env.NODE_ENV === "production") {
  console.warn(
    "[CORS] CORS_ORIGIN no configurado en producción: se permiten TODOS los orígenes. Configúralo en tu .env"
  );
}
