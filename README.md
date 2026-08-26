# VCDetection Backend

Backend del sistema encubierto de detección de humo de vape/cigarrillo para colegios.

## Descargas

| Plataforma | Enlace directo |
|------------|----------------|
| Android (APK) | https://github.com/mariosibrianjr-byte/vcdetection-backend/releases/download/latest/VCDetection-movil.apk |
| Windows (instalador) | https://github.com/mariosibrianjr-byte/vcdetection-backend/releases/download/latest/VCDetection-Setup.exe |

Los enlaces siempre apuntan a la última versión estable (release `latest`, publicado por los workflows de GitHub Actions).

## Página web

La página explicativa del proyecto vive en [`docs/index.html`](docs/index.html) y se publica gratis con **GitHub Pages**.

### Activar GitHub Pages (una sola vez)

1. En GitHub: **Settings** → **Pages**
2. **Source**: *Deploy from a branch*
3. **Branch**: `main` y carpeta `/docs`
4. Guardar. La página queda disponible en:
   `https://mariosibrianjr-byte.github.io/vcdetection-backend/`

### Compilar las apps

- **APK Android**: empujar un tag `movil-v*` o ejecutar el workflow "Build Movil" manualmente (pestaña **Actions**).
- **Instalador Windows**: empujar un tag `v*` o ejecutar el workflow "Build Desktop" manualmente.

Ambos workflows publican el artefacto tanto en un release versionado como en el release fijo `latest`.

## Stack

- **TypeScript** + **Node.js** + **Express**
- **PostgreSQL** con **Prisma ORM**
- **Socket.io** para WebSockets en tiempo real
- **Firebase FCM** para push notifications
- **Resend** para emails
- **JWT** para autenticación

## Setup rápido

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Editar .env con tus valores
```

### 3. Crear base de datos en Render.com
1. Ir a [render.com](https://render.com) → **New** → **PostgreSQL**
2. Nombre: `vcdetection-db`
3. Plan: **Free**
4. Copiar la **Internal Database URL** o **External Database URL**
5. Pegarla en el `.env` como `DATABASE_URL`

### 4. Migrar base de datos
```bash
npx prisma migrate dev --name init
```
Esto crea automáticamente todas las tablas.

### 5. Iniciar en desarrollo
```bash
npm run dev
```

El servidor arranca en `http://localhost:3000`.

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/sensor/lectura` | 🔑 API key | Recibe datos del ESP32 (header `x-device-key`) |
| POST | `/api/auth/register` | ⚠️ Especial | Solo abierto si no existe ningún usuario; después requiere token ADMIN |
| POST | `/api/auth/login` | ❌ | Login (retorna JWT) |
| PATCH | `/api/auth/fcm-token` | ✅ | Actualizar token FCM |
| GET | `/api/auth/me` | ✅ | Perfil del usuario |
| GET | `/api/alertas` | ✅ | Listar alertas (paginado) |
| GET | `/api/alertas/resumen` | ✅ | Resumen de alertas |
| PATCH | `/api/alertas/:id/vista` | ✅ | Marcar alerta como vista |
| PATCH | `/api/alertas/marcar-todas` | ✅ | Marcar todas como vistas |
| GET | `/api/dispositivos` | ✅ | Listar dispositivos |
| GET | `/api/dispositivos/:id` | ✅ | Detalle de dispositivo |
| PATCH | `/api/dispositivos/:id` | ✅ | Editar dispositivo |
| GET | `/api/health` | ❌ | Health check |

## Seguridad

- **API key de dispositivos**: el ESP32 debe enviar el header `x-device-key: <DEVICE_API_KEY>`. Configúrala en el `.env` del servidor y en el firmware (`DEVICE_API_KEY`).
- **Registro protegido**: el primer usuario se crea libre (bootstrap); después solo un ADMIN autenticado puede crear más cuentas vía `/register`.
- **Rate limiting**: máximo 20 requests cada 15 min por IP en `/api/auth`.
- **CORS**: configura `CORS_ORIGIN` con tus dominios separados por coma para restringir el acceso al dashboard/WebSocket.
- **Cooldown de alertas en BD**: no se repiten alertas del mismo dispositivo dentro de 5 minutos, incluso si el servidor se reinicia.

## JSON de ejemplo (ESP32)

```json
{
  "dispositivoId": "SALON_01",
  "ppm135": 7.20,
  "ppm2": 0.00,
  "humoDetectado": false,
  "tipo": "Aire limpio",
  "picoSubito": false,
  "temperatura": 29.8,
  "humedad": 67.0,
  "pm1": 0.0,
  "pm25": 0.0,
  "pm10": 0.0,
  "timestamp": "2025-06-26T10:30:00-06:00"
}
```

## Deploy en Render.com

1. Subir repo a GitHub
2. En Render → **New** → **Web Service**
3. Conectar repo
4. Build Command: `npm install && npx prisma generate && npm run build`
5. Start Command: `npm start`
6. Agregar variables de entorno del `.env`
7. Listo ✅

## WebSocket Events

Conectar con Socket.io al mismo URL del servidor:

```javascript
const socket = io("http://localhost:3000");

socket.on("nueva-alerta", (alerta) => { /* ... */ });
socket.on("nueva-lectura", (lectura) => { /* ... */ });
socket.on("dispositivo-update", (dispositivo) => { /* ... */ });
```
