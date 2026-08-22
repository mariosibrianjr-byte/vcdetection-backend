/*
 * VCDETECTION — ESP32 Covert Sensor
 * 
 * Hardware:
 *   - ESP32 (Microcontrolador Principal)
 *   - MQ135 (GPIO 35) — Detecta VOCs, humo general
 *   - MQ2   (GPIO 34) — Detecta Gas/Humo
 *   - DHT11 (GPIO 4)  — Temperatura y Humedad
 *   - PMS5003 (RX: GPIO16, TX: GPIO17) — Partículas PM1.0, PM2.5, PM10
 * 
 * Características:
 *   - Totalmente encubierto (sin LEDs ni delay() bloqueantes)
 *   - Reconexión WiFi automática con backoff exponencial
 *   - Cola circular en memoria RAM (guarda hasta 10 lecturas si no hay WiFi)
 *   - Watchdog Timer (WDT) de 15 segundos para auto-reinicio si se cuelga
 *   - NTP local (UTC-6 El Salvador) para timestamps precisos
 *   - PMS5003 leído por Serial2 de forma asíncrona
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include <time.h>

// ─── Configuración de Red e ID ────────────────────────────────────────────────
const char* DISPOSITIVO_ID = "SALON_01";
const char* WIFI_SSID      = "TU_NOMBRE_DE_WIFI";
const char* WIFI_PASSWORD  = "TU_CONTRASEÑA_WIFI";

// Reemplaza IP_DEL_BACKEND por la IP de tu PC en la red local o la URL de Render
const char* SERVER_URL     = "http://192.168.1.100:3000/api/sensor/lectura";

// ─── Pines ────────────────────────────────────────────────────────────────────
const int MQ135_PIN = 35;
const int MQ2_PIN   = 34;
const int DHT_PIN   = 4;
#define DHT_TYPE DHT11

// PMS5003 (Serial2 por defecto usa RX=16, TX=17)
#define PMS_RX 16
#define PMS_TX 17

// ─── Tiempos y Watchdog ───────────────────────────────────────────────────────
const unsigned long INTERVALO_MUESTREO = 5000;  // 5 segundos
const int WDT_TIMEOUT = 15;                     // 15 segundos para el Watchdog

// ─── NTP y Tiempo ──────────────────────────────────────────────────────────────
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -21600;             // UTC-6 (El Salvador)
const int   daylightOffset_sec = 0;

// ─── Variables de Estado y Sensores ───────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long ultimoMuestreo = 0;

// Historial para pico súbito de gas (5 muestras)
float historial135[5] = {0};
float historial2[5]   = {0};
int indiceGases = 0;

// Historial para promedio de humedad (12 muestras = 1 minuto a 5s por muestra)
const int NUM_MUESTRAS_HUM = 12;
float historialHumedad[NUM_MUESTRAS_HUM] = {0};
int indiceHum = 0;
bool bufferHumLleno = false;

// Variables PMS5003
int pm1_0 = -1;
int pm2_5 = -1;
int pm10  = -1;
unsigned long ultimoPMSRx = 0;

// ─── Cola Offline ─────────────────────────────────────────────────────────────
#define QUEUE_SIZE 10
struct Lectura {
  float ppm135;
  float ppm2;
  bool humoDetectado;
  String tipo;
  bool picoSubito;
  float temperatura;
  float humedad;
  int pm1;
  int pm25;
  int pm10;
  String timestamp;
};

Lectura colaOffline[QUEUE_SIZE];
int colaHead  = 0;
int colaTail  = 0;
int colaCount = 0;

// ─── Prototipos ───────────────────────────────────────────────────────────────
void leerSensoresYProcesar();
void leerPMS5003();
void procesarCola();
bool enviarDatos(Lectura &lec);
String getTimestampISO();
float leerPPM(int pin, float RL, float RO, float A, float B);
bool detectarPico(float* hist, int size);
float obtenerPromedioHumedad();

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  
  // Iniciar Serial2 para el PMS5003
  Serial2.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);
  
  dht.begin();
  
  // Configuración de ADC para MQ135 y MQ2
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // Iniciar Watchdog por hardware
  esp_task_wdt_init(WDT_TIMEOUT, true);
  esp_task_wdt_add(NULL);

  WiFi.mode(WIFI_STA);
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  Serial.println("\n=== VCDETECTION ENCUBIERTO (Iniciando) ===");
}

// ─── Loop Principal (No Bloqueante) ───────────────────────────────────────────
unsigned long ultimoIntentoWiFi = 0;
int backoffWiFi = 5000;

void loop() {
  // "Alimentar" al perro guardián en cada ciclo para evitar el reinicio
  esp_task_wdt_reset(); 

  unsigned long ahora = millis();

  // 1. Gestión de WiFi con reconexión y Backoff
  if (WiFi.status() != WL_CONNECTED) {
    if (ahora - ultimoIntentoWiFi > backoffWiFi) {
      Serial.println("[WiFi] Intentando conectar...");
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      ultimoIntentoWiFi = ahora;
      // Incrementar el tiempo de espera si falla (hasta 60 segundos)
      backoffWiFi = min(backoffWiFi * 2, 60000); 
    }
  } else {
    // Si estamos conectados, resetear backoff a 5s
    if (backoffWiFi > 5000) {
      Serial.printf("[WiFi] Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
      backoffWiFi = 5000; 
    }
    // Si hay conexión, intentar enviar los datos que se guardaron offline
    procesarCola(); 
  }

  // 2. Leer sensor PMS5003 (Debe leerse continuamente del buffer UART)
  leerPMS5003();

  // 3. Temporizador no bloqueante para muestreo (cada 5 segundos)
  if (ahora - ultimoMuestreo >= INTERVALO_MUESTREO) {
    ultimoMuestreo = ahora;
    leerSensoresYProcesar();
  }
}

// ─── Lógica de Lectura y Detección ────────────────────────────────────────────
void leerSensoresYProcesar() {
  // 1. Leer DHT11
  float humedad = dht.readHumidity();
  float temperatura = dht.readTemperature();
  
  if (isnan(humedad) || isnan(temperatura)) {
    humedad = -1;
    temperatura = -1;
  } else {
    // Actualizar historial de humedad para promedios
    historialHumedad[indiceHum] = humedad;
    indiceHum = (indiceHum + 1) % NUM_MUESTRAS_HUM;
    if (indiceHum == 0) bufferHumLleno = true;
  }

  // 2. Leer Gases (Aproximación de lectura rápida)
  float ppm135 = leerPPM(MQ135_PIN, 10.0, 6.0, 110.47, -2.862);
  float ppm2   = leerPPM(MQ2_PIN,   10.0, 9.83, 574.25, -2.222);

  historial135[indiceGases % 5] = ppm135;
  historial2[indiceGases % 5]   = ppm2;
  indiceGases++;

  // 3. Evaluar Lógica de Negocio
  bool picoGas = detectarPico(historial135, 5) || detectarPico(historial2, 5);
  float promHum = obtenerPromedioHumedad();
  
  bool subidaHumedad = (promHum > 0) && (humedad > promHum + 10.0);
  bool humedadNormal = (promHum > 0) && (humedad <= promHum + 5.0);

  bool vape       = (ppm135 > 500.0) && subidaHumedad;
  bool cigarrillo = (ppm135 > 800.0) && humedadNormal;
  bool pm25_alto  = (pm2_5 > 35 && pm2_5 != -1);

  String tipo = "Aire limpio";
  bool humoDetectado = false;

  if (vape && cigarrillo && pm25_alto) {
    tipo = "Alta confianza";
    humoDetectado = true;
  } else if (vape) {
    tipo = "Vape confirmado";
    humoDetectado = true;
  } else if (cigarrillo) {
    tipo = "Cigarrillo";
    humoDetectado = true;
  } else if (pm25_alto) {
    tipo = "PM2.5 Alto";
    humoDetectado = true;
  } else if (picoGas || ppm135 > 400 || ppm2 > 300) {
    tipo = "Posible humo";
    humoDetectado = true;
  }

  // Si el PMS5003 no responde por más de 10s, invalidar sus valores
  if (millis() - ultimoPMSRx > 10000) {
    pm1_0 = -1; pm2_5 = -1; pm10 = -1;
  }

  // 4. Empaquetar la Lectura
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
  lec.timestamp     = getTimestampISO();

  // Log para monitoreo (solo visible si se conecta por USB)
  Serial.printf("[%s] MQ135:%.1f | Hum:%.1f (Prom:%.1f) | PM2.5:%d | Tipo: %s\n", 
                lec.timestamp.c_str(), ppm135, humedad, promHum, pm2_5, tipo.c_str());

  // 5. Agregar a cola offline
  if (colaCount < QUEUE_SIZE) {
    colaOffline[colaTail] = lec;
    colaTail = (colaTail + 1) % QUEUE_SIZE;
    colaCount++;
  } else {
    // Si la cola está llena, sobrescribimos el dato más viejo
    colaOffline[colaTail] = lec;
    colaTail = (colaTail + 1) % QUEUE_SIZE;
    colaHead = (colaHead + 1) % QUEUE_SIZE; // Avanzar el head
  }
}

// ─── Gestión de Red y POST ────────────────────────────────────────────────────
void procesarCola() {
  // Enviar lecturas guardadas mientras haya WiFi y datos pendientes
  while (colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    Lectura lec = colaOffline[colaHead];
    
    bool ok = enviarDatos(lec);
    
    if (ok) {
      // Si se envió con éxito, sacar de la cola
      colaHead = (colaHead + 1) % QUEUE_SIZE;
      colaCount--;
    } else {
      // Si falló el envío (problema de red temporal), dejamos de intentar
      // para que el próximo ciclo loop() retome
      break; 
    }
  }
}

bool enviarDatos(Lectura &lec) {
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000); // Timeout corto para evitar bloqueos largos (3s)

  StaticJsonDocument<300> doc;
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
  doc["timestamp"]     = lec.timestamp;

  String body;
  serializeJson(doc, body);

  int respuesta = http.POST(body);
  http.end();

  if (respuesta == 200 || respuesta == 201) {
    return true;
  } else {
    Serial.printf("[HTTP] Fallo POST. Codigo: %d\n", respuesta);
    return false;
  }
}

// ─── Lectura Asíncrona de PMS5003 ─────────────────────────────────────────────
void leerPMS5003() {
  // Extraer datos del buffer Serial2 sin bloquear el procesador
  while (Serial2.available() >= 32) {
    if (Serial2.read() == 0x42 && Serial2.peek() == 0x4D) { // Header estándar de PMS
      Serial2.read(); // Consumir 0x4D
      uint8_t buf[30];
      Serial2.readBytes(buf, 30);
      
      pm1_0 = (buf[2] << 8) | buf[3];
      pm2_5 = (buf[4] << 8) | buf[5];
      pm10  = (buf[6] << 8) | buf[7];
      
      ultimoPMSRx = millis();
    }
  }
}

// ─── Funciones Auxiliares ─────────────────────────────────────────────────────
float leerPPM(int pin, float RL, float RO, float A, float B) {
  // Tomamos 20 lecturas muy rápidas sin delay para promediar el ruido eléctrico.
  // Es tan rápido (microsegundos) que no bloquea la ejecución.
  long suma = 0;
  for (int i = 0; i < 20; i++) {
    suma += analogRead(pin);
  }
  float adc = suma / 20.0;
  float voltaje = (adc / 4095.0) * 3.3;
  
  if (voltaje < 0.01) return 0.0; // Evitar división por cero
  
  float RS = ((3.3 - voltaje) / voltaje) * RL;
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
  int num = bufferHumLleno ? NUM_MUESTRAS_HUM : indiceHum;
  float sum = 0;
  for (int i = 0; i < num; i++) {
    sum += historialHumedad[i];
  }
  return sum / num;
}

String getTimestampISO() {
  struct tm timeinfo;
  // Si NTP aún no ha sincronizado, se usa fecha base.
  // 10ms de espera es casi instantáneo, no bloquea.
  if (!getLocalTime(&timeinfo, 10)) {
    return "1970-01-01T00:00:00-06:00"; 
  }
  char buf[30];
  // Formatear en ISO8601 forzando el timezone -06:00
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S-06:00", &timeinfo);
  return String(buf);
}
