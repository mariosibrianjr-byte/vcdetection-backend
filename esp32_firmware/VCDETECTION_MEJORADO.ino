/*
 * VCDETECTION — ESP32 Covert Sensor (VERSIÓN CORREGIDA)
 * 
 * Hardware:
 *   - ESP32 (Microcontrolador Principal)
 *   - MQ135 (GPIO 35) — Detecta VOCs, humo general
 *   - MQ2   (GPIO 34) — Detecta Gas/Humo
 *   - DHT11 (GPIO 4)  — Temperatura y Humedad
 *   - PMS5003 (RX: GPIO16, TX: GPIO17) — Partículas PM1.0, PM2.5, PM10
 *   - MH-Z19C (RX: GPIO26, TX: GPIO27) — CO2 en ppm (UART1)
 * 
 * Correcciones aplicadas:
 *   [1] WiFi con flag de estado para no llamar begin() múltiples veces
 *   [2] procesarCola() solo se llama si hay datos pendientes
 *   [3] StaticJsonDocument aumentado a 400 bytes
 *   [4] PMS5003 con verificación de checksum
 *   [5] Watchdog con API actualizada del ESP32 core
 *   [6] WiFi.disconnect() antes de reconectar para evitar estado colgado
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include <time.h>
#include <MHZ19.h>

// ─── Configuración — CAMBIÁ ESTOS VALORES ─────────────────────────────────────
const char* DISPOSITIVO_ID = "SALON_01";          // Cambiá por el salón correspondiente
const char* WIFI_SSID      = "737MUVIECABLE";
const char* WIFI_PASSWORD  = "5F7UHI650JCI89P";
const char* SERVER_URL = "https://vcdetection-backend.onrender.com/api/sensor/lectura";

// ─── Pines ────────────────────────────────────────────────────────────────────
const int MQ135_PIN = 35;
const int MQ2_PIN   = 34;
const int DHT_PIN   = 4;
#define DHT_TYPE DHT11
#define PMS_RX 16
#define PMS_TX 17
#define CO2_RX 26   // MH-Z19C: cable verde (TXD del sensor) -> este pin
#define CO2_TX 27   // MH-Z19C: cable azul  (RXD del sensor) -> este pin

// ─── Tiempos ──────────────────────────────────────────────────────────────────
const unsigned long INTERVALO_MUESTREO = 5000;    // 5 segundos entre lecturas
const int           WDT_TIMEOUT        = 15;      // Watchdog: reinicia si se cuelga 15s

// ─── NTP (El Salvador UTC-6) ───────────────────────────────────────────────────
const char* ntpServer        = "pool.ntp.org";
const long  gmtOffset_sec    = -21600;
const int   daylightOffset_sec = 0;

// ─── Sensores ─────────────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long ultimoMuestreo = 0;

// MH-Z19C (CO2) por UART1
HardwareSerial mhzSerial(1);
MHZ19 myMHZ19;
int   co2ppm = -1;   // -1 = sin lectura válida todavía

// Historial de gases (últimas 5 muestras para detectar pico)
float historial135[5] = {0};
float historial2[5]   = {0};
int   indiceGases     = 0;

// ─── Baseline dinámico de gases (ventana larga, ~5 min = 60 muestras de 5s) ──
// En vez de comparar contra un número fijo (que varía por sala/instalación),
// comparamos contra el promedio "normal" reciente de ESA sala.
const int NUM_MUESTRAS_BASELINE = 60;
float historialBase135[NUM_MUESTRAS_BASELINE] = {0};
float historialBase2[NUM_MUESTRAS_BASELINE]   = {0};
int   indiceBase       = 0;
bool  bufferBaseLleno  = false;

// Historial de humedad (últimas 12 muestras = 1 minuto) — baseline lento
const int NUM_MUESTRAS_HUM = 12;
float historialHumedad[NUM_MUESTRAS_HUM] = {0};
int   indiceHum      = 0;
bool  bufferHumLleno = false;

// Historial de humedad RÁPIDO (últimas 4 muestras = ~20s) — detecta el salto
// brusco de humedad que provoca el vapor de un vape, que el promedio de
// 1 minuto no alcanza a capturar a tiempo.
const int NUM_MUESTRAS_HUM_RAPIDO = 4;
float historialHumedadRapida[NUM_MUESTRAS_HUM_RAPIDO] = {0};
int   indiceHumRapido = 0;

// ─── Confirmación por muestras consecutivas (anti falso-positivo) ───────────
// Un solo pico de 5s puede ser ruido (alguien abre perfume, entra vapor de
// ducha, etc). Exigimos que la condición se repita para confirmar.
int contadorVape       = 0;
int contadorCigarrillo = 0;
const int MUESTRAS_CONFIRMACION = 2;   // 2 lecturas seguidas (10s) para confirmar

// ─── Tiempo de calentamiento de sensores MQ ──────────────────────────────────
// Los MQ135/MQ2 dan lecturas erráticas los primeros minutos tras encender.
// Ignoramos detecciones (pero seguimos logueando) durante este período.
const unsigned long TIEMPO_CALENTAMIENTO_MS = 3UL * 60UL * 1000UL; // 3 minutos
unsigned long inicioSistema = 0;

// Variables PMS5003
int pm1_0 = -1;
int pm2_5 = -1;
int pm10  = -1;
unsigned long ultimoPMSRx = 0;

// ─── [CORRECCIÓN 1] WiFi con flag de estado ───────────────────────────────────
unsigned long ultimoIntentoWiFi = 0;
unsigned long backoffWiFi       = 5000;
bool          wifiConectando    = false;   // ← NUEVO: evita llamar begin() repetidamente

// ─── Cola Offline (hasta 10 lecturas sin WiFi) ────────────────────────────────
#define QUEUE_SIZE 10
struct Lectura {
  float  ppm135;
  float  ppm2;
  bool   humoDetectado;
  String tipo;
  bool   picoSubito;
  float  temperatura;
  float  humedad;
  int    pm1;
  int    pm25;
  int    pm10;
  int    co2;
  String timestamp;
};

Lectura colaOffline[QUEUE_SIZE];
int colaHead  = 0;
int colaTail  = 0;
int colaCount = 0;

// ─── Prototipos ───────────────────────────────────────────────────────────────
void  leerSensoresYProcesar();
void  leerPMS5003();
void  procesarCola();
bool  enviarDatos(Lectura &lec);
void  gestionarWiFi();
String getTimestampISO();
float leerPPM(int pin, float RL, float RO, float A, float B);
bool  detectarPico(float* hist, int size);
float obtenerPromedioHumedad();
float obtenerPromedio(float* hist, int size, bool lleno, int indiceActual);

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Iniciar PMS5003 por Serial2
  Serial2.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);

  // Iniciar MH-Z19C por UART1 (pines distintos al PMS5003 para no chocar)
  mhzSerial.begin(9600, SERIAL_8N1, CO2_RX, CO2_TX);
  myMHZ19.begin(mhzSerial);
  myMHZ19.autoCalibration();   // Calibración automática (ABC) activada

  dht.begin();

  // Configuración ADC para MQ135 y MQ2
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // [CORRECCIÓN 5] Watchdog con configuración actualizada
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms    = WDT_TIMEOUT * 1000,
    .idle_core_mask = (1 << 0),           // Solo core 0
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdt_config);
  esp_task_wdt_add(NULL);

  WiFi.mode(WIFI_STA);
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  inicioSistema = millis();
  Serial.println("\n=== VCDETECTION — Iniciando (calentando sensores MQ ~3 min) ===");
}

// ─── Loop Principal ───────────────────────────────────────────────────────────
void loop() {
  // Alimentar watchdog para evitar reinicio
  esp_task_wdt_reset();

  unsigned long ahora = millis();

  // 1. Gestión de WiFi (corregida)
  gestionarWiFi();

  // 2. Leer PMS5003 continuamente del buffer UART (no bloqueante)
  leerPMS5003();

  // 3. Muestreo cada 5 segundos (no bloqueante)
  if (ahora - ultimoMuestreo >= INTERVALO_MUESTREO) {
    ultimoMuestreo = ahora;
    leerSensoresYProcesar();
  }

  // [CORRECCIÓN 2] procesarCola() SOLO si hay datos pendientes y hay WiFi
  if (colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    procesarCola();
  }
}

// ─── [CORRECCIÓN 1 y 6] Gestión WiFi con flag y disconnect() ─────────────────
void gestionarWiFi() {
  unsigned long ahora = millis();

  if (WiFi.status() == WL_CONNECTED) {
    // Si reconectó, resetear backoff y flag
    if (wifiConectando) {
      Serial.printf("[WiFi] Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
      wifiConectando = false;
      backoffWiFi    = 5000;
    }
    return;
  }

  // Si no está conectado y ya pasó el tiempo de backoff
  if (ahora - ultimoIntentoWiFi > backoffWiFi) {
    Serial.printf("[WiFi] Intentando conectar... (backoff: %lums)\n", backoffWiFi);

    // [CORRECCIÓN 6] Desconectar limpiamente antes de reintentar
    WiFi.disconnect(true);
    delay(100);                             // 100ms mínimo para limpiar estado interno
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    wifiConectando      = true;
    ultimoIntentoWiFi   = ahora;

    // Backoff exponencial hasta 60 segundos máximo
    backoffWiFi = min(backoffWiFi * 2, (unsigned long)60000);
  }
}

// ─── Lectura de Sensores y Lógica de Detección ───────────────────────────────
void leerSensoresYProcesar() {
  // 1. DHT11
  float humedad     = dht.readHumidity();
  float temperatura = dht.readTemperature();

  if (isnan(humedad) || isnan(temperatura)) {
    humedad     = -1;
    temperatura = -1;
    Serial.println("[DHT11] Error de lectura");
  } else {
    historialHumedad[indiceHum] = humedad;
    indiceHum = (indiceHum + 1) % NUM_MUESTRAS_HUM;
    if (indiceHum == 0) bufferHumLleno = true;

    historialHumedadRapida[indiceHumRapido] = humedad;
    indiceHumRapido = (indiceHumRapido + 1) % NUM_MUESTRAS_HUM_RAPIDO;
  }

  // 2. MQ135 y MQ2
  float ppm135 = leerPPM(MQ135_PIN, 10.0, 6.0,  110.47, -2.862);
  float ppm2   = leerPPM(MQ2_PIN,   10.0, 9.83, 574.25, -2.222);

  // 2.b MH-Z19C (CO2)
  int lecturaCO2 = myMHZ19.getCO2();
  if (myMHZ19.errorCode == RESULT_OK) {
    co2ppm = lecturaCO2;
  } else {
    Serial.printf("[MH-Z19C] Error de lectura, status: %d\n", myMHZ19.errorCode);
    // Se mantiene el último valor válido de co2ppm en vez de sobreescribir con error
  }

  historial135[indiceGases % 5] = ppm135;
  historial2[indiceGases % 5]   = ppm2;
  indiceGases++;

  // Baseline dinámico (promedio "normal" de esta sala en los últimos ~5 min)
  historialBase135[indiceBase] = ppm135;
  historialBase2[indiceBase]   = ppm2;
  indiceBase = (indiceBase + 1) % NUM_MUESTRAS_BASELINE;
  if (indiceBase == 0) bufferBaseLleno = true;

  float base135 = obtenerPromedio(historialBase135, NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float base2   = obtenerPromedio(historialBase2,   NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);

  bool sensoresCalientes = (millis() - inicioSistema) > TIEMPO_CALENTAMIENTO_MS;

  // 3. Lógica de detección
  bool  picoGas     = detectarPico(historial135, 5) || detectarPico(historial2, 5);
  float promHum     = obtenerPromedioHumedad();
  bool  subidaHum   = (promHum > 0) && (humedad > promHum + 10.0);
  bool  humedadNorm = (promHum > 0) && (humedad <= promHum + 5.0);

  // Salto RÁPIDO de humedad (~20s): firma típica del vapor de un vape.
  // Comparamos la muestra más nueva contra la más vieja de la ventana corta.
  int idxViejo = (indiceHumRapido) % NUM_MUESTRAS_HUM_RAPIDO; // el que se va a sobreescribir = el más viejo
  float humRapidaVieja = historialHumedadRapida[idxViejo];
  bool  saltoHumRapido = (humRapidaVieja > 0) && (humedad - humRapidaVieja > 6.0);

  // Umbral relativo al baseline de ESA sala en vez de un número fijo global.
  // Esto evita que una sala naturalmente más "cargada" (poca ventilación)
  // dispare falsos positivos todo el tiempo, y que una sala muy ventilada
  // nunca dispare aunque haya un pico real.
  bool subidaVOC_fuerte = ((base135 > 0) && (ppm135 > base135 * 1.8) && (ppm135 > 350)) ||
                          ((base2   > 0) && (ppm2   > base2   * 1.8) && (ppm2   > 250));
  bool subidaVOC_leve   = ((base135 > 0) && (ppm135 > base135 * 1.3) && (ppm135 > 300)) ||
                          ((base2   > 0) && (ppm2   > base2   * 1.3) && (ppm2   > 200));

  // Perfil de partícula: PMS5003 permite distinguir aerosol fino (vape)
  // de humo de combustión (cigarrillo) mirando la relación entre PM1.0/PM2.5
  // y cuánto "extra" aporta PM10 sobre PM2.5.
  bool  datosPmValidos = (pm1_0 != -1 && pm2_5 != -1 && pm10 != -1);
  float ratioPM1_25    = (datosPmValidos && pm2_5 > 0) ? (float)pm1_0 / pm2_5 : -1;
  bool  particulaFina  = datosPmValidos && (ratioPM1_25 > 0.85);           // aerosol líquido ~ vape
  bool  particulaAncha = datosPmValidos && (pm10 > pm2_5 * 1.3) && (pm2_5 > 15); // combustión ~ cigarrillo
  bool  pm25_alto      = datosPmValidos && (pm2_5 > 35);

  // Condiciones "crudas" de este ciclo (antes de exigir confirmación)
  bool vapeCrudo = sensoresCalientes && subidaVOC_fuerte &&
                   (subidaHum || saltoHumRapido) &&
                   (!datosPmValidos || particulaFina || pm25_alto);

  bool cigarrilloCrudo = sensoresCalientes && subidaVOC_fuerte && humedadNorm &&
                         (!datosPmValidos || particulaAncha || pm25_alto);

  // Confirmación: exigir MUESTRAS_CONFIRMACION ciclos seguidos para bajar
  // falsos positivos por un pico aislado de 5s.
  contadorVape       = vapeCrudo       ? contadorVape + 1       : 0;
  contadorCigarrillo = cigarrilloCrudo ? contadorCigarrillo + 1 : 0;

  bool vape       = contadorVape       >= MUESTRAS_CONFIRMACION;
  bool cigarrillo = contadorCigarrillo >= MUESTRAS_CONFIRMACION;

  String tipo        = "Aire limpio";
  bool humoDetectado = false;

  if (!sensoresCalientes) {
    tipo = "Calentando sensores";
  } else if (vape && cigarrillo) {
    tipo = "Alta confianza (VOC+particula+humedad)"; humoDetectado = true;
  } else if (vape) {
    tipo = "Vape confirmado";   humoDetectado = true;
  } else if (cigarrillo) {
    tipo = "Cigarrillo confirmado"; humoDetectado = true;
  } else if (pm25_alto) {
    tipo = "PM2.5 Alto";        humoDetectado = true;
  } else if (picoGas || subidaVOC_leve) {
    tipo = "Posible humo (sin confirmar)"; humoDetectado = true;
  }

  // Invalidar PMS5003 si no responde en 10 segundos
  if (millis() - ultimoPMSRx > 10000) {
    pm1_0 = -1; pm2_5 = -1; pm10 = -1;
  }

  // 4. Empaquetar lectura
  Lectura lec;
  lec.ppm135        = ppm135;
  lec.ppm2          = ppm2;
  lec.humoDetectado = humoDetectado;
  lec.tipo          = tipo;
  lec.picoSubito    = picoGas;
  lec.temperatura   = temperatura;
  lec.humedad       = humedad;
  lec.pm1           = pm1_0;
  lec.pm25          = pm2_5;
  lec.pm10          = pm10;
  lec.co2           = co2ppm;
  lec.timestamp     = getTimestampISO();

  Serial.printf("[%s] MQ135:%.1f(Base:%.1f) | MQ2:%.1f | Hum:%.1f(Prom:%.1f) | PM1:%d PM2.5:%d PM10:%d (ratio:%.2f) | CO2:%d | %s\n",
                lec.timestamp.c_str(), ppm135, base135, ppm2, humedad, promHum, pm1_0, pm2_5, pm10, ratioPM1_25, co2ppm, tipo.c_str());

  // 5. Agregar a cola circular (sobrescribe el más viejo si está llena)
  colaOffline[colaTail] = lec;
  colaTail = (colaTail + 1) % QUEUE_SIZE;

  if (colaCount < QUEUE_SIZE) {
    colaCount++;
  } else {
    // Cola llena: avanzar head para descartar el dato más antiguo
    colaHead = (colaHead + 1) % QUEUE_SIZE;
  }
}

// ─── Envío de Cola al Servidor ────────────────────────────────────────────────
void procesarCola() {
  while (colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    Lectura lec = colaOffline[colaHead];
    bool ok = enviarDatos(lec);

    if (ok) {
      colaHead = (colaHead + 1) % QUEUE_SIZE;
      colaCount--;
    } else {
      // Fallo de red, dejamos de intentar hasta el próximo ciclo
      break;
    }
  }
}

bool enviarDatos(Lectura &lec) {
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000);

  // [CORRECCIÓN 3] Aumentado a 450 para no desbordar con todos los campos (incluye CO2)
  StaticJsonDocument<450> doc;
  doc["dispositivoId"] = DISPOSITIVO_ID;
  doc["ppm135"]        = round(lec.ppm135 * 100) / 100.0;
  doc["ppm2"]          = round(lec.ppm2 * 100) / 100.0;
  doc["humoDetectado"] = lec.humoDetectado;
  doc["tipo"]          = lec.tipo;
  doc["picoSubito"]    = lec.picoSubito;
  doc["temperatura"]   = round(lec.temperatura * 10) / 10.0;
  doc["humedad"]       = round(lec.humedad * 10) / 10.0;
  doc["pm1"]           = lec.pm1;
  doc["pm25"]          = lec.pm25;
  doc["pm10"]          = lec.pm10;
  doc["co2"]           = lec.co2;
  doc["timestamp"]     = lec.timestamp;

  String body;
  serializeJson(doc, body);

  int respuesta = http.POST(body);
  http.end();

  if (respuesta == 200 || respuesta == 201) {
    Serial.println("[HTTP] ✓ Enviado");
    return true;
  }

  Serial.printf("[HTTP] ✗ Fallo. Codigo: %d\n", respuesta);
  return false;
}

// ─── [CORRECCIÓN 4] PMS5003 con verificación de Checksum ─────────────────────
void leerPMS5003() {
  while (Serial2.available() >= 32) {
    // Buscar header del PMS5003 (0x42, 0x4D)
    if (Serial2.read() != 0x42) continue;
    if (Serial2.peek() != 0x4D) continue;
    Serial2.read(); // Consumir 0x4D

    uint8_t buf[30];
    if (Serial2.readBytes(buf, 30) != 30) continue;

    // Calcular checksum: suma de 0x42 + 0x4D + los primeros 28 bytes del buffer
    uint16_t checksum = 0x42 + 0x4D;
    for (int i = 0; i < 28; i++) {
      checksum += buf[i];
    }

    // Los últimos 2 bytes del buffer son el checksum esperado
    uint16_t checksumEsperado = (buf[28] << 8) | buf[29];

    if (checksum != checksumEsperado) {
      Serial.println("[PMS5003] Checksum incorrecto, dato descartado");
      continue;
    }

    // Checksum OK — extraer valores (atmospheric environment, bytes 4-9)
    pm1_0 = (buf[4] << 8) | buf[5];
    pm2_5 = (buf[6] << 8) | buf[7];
    pm10  = (buf[8] << 8) | buf[9];

    ultimoPMSRx = millis();
  }
}

// ─── Funciones Auxiliares ─────────────────────────────────────────────────────
float leerPPM(int pin, float RL, float RO, float A, float B) {
  long suma = 0;
  for (int i = 0; i < 20; i++) {
    suma += analogRead(pin);
  }
  float adc     = suma / 20.0;
  float voltaje = (adc / 4095.0) * 3.3;
  if (voltaje < 0.01) return 0.0;
  float RS    = ((3.3 - voltaje) / voltaje) * RL;
  float ratio = RS / RO;
  return A * pow(ratio, B);
}

bool detectarPico(float* hist, int size) {
  float minVal = hist[0], maxVal = hist[0];
  for (int i = 1; i < size; i++) {
    if (hist[i] < minVal) minVal = hist[i];
    if (hist[i] > maxVal) maxVal = hist[i];
  }
  return (maxVal - minVal) > 50.0;
}

float obtenerPromedioHumedad() {
  if (!bufferHumLleno && indiceHum == 0) return -1.0;
  int   num = bufferHumLleno ? NUM_MUESTRAS_HUM : indiceHum;
  float sum = 0;
  for (int i = 0; i < num; i++) sum += historialHumedad[i];
  return sum / num;
}

// Promedio genérico para arrays circulares (usado en el baseline de gases).
// Devuelve -1 si todavía no hay suficientes muestras para confiar en el valor.
float obtenerPromedio(float* hist, int size, bool lleno, int indiceActual) {
  int num = lleno ? size : indiceActual;
  if (num <= 0) return -1.0;
  float sum = 0;
  for (int i = 0; i < num; i++) sum += hist[i];
  return sum / num;
}

String getTimestampISO() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10)) {
    return "1970-01-01T00:00:00-06:00";
  }
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S-06:00", &timeinfo);
  return String(buf);
}
