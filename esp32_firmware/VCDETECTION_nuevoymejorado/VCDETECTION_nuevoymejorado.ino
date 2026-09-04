/*
 * ============================================================================
 * VCDETECTION — ESP32 Covert Sensor (VERSIÓN PROFESIONAL MEJORADA)
 * ============================================================================
 * 
 * Hardware:
 *   - ESP32 (Microcontrolador Principal)
 *   - MQ7     (GPIO 32)            — Detecta CO (monóxido de carbono) — firma de combustión
 *   - DHT22   (GPIO 5)             — Temperatura y Humedad (opcional con R pull-up 10k)
 *   - PMS5003 (RX: GPIO16, TX: GPIO17) — Partículas láser PM1.0, PM2.5, PM10 (UART2)
 *   - MH-Z19C (RX: GPIO26, TX: GPIO27) — CO2 NDIR en ppm (UART1)
 * 
 * Mejoras aplicadas:
 *   [1] SENSORES:
 *       - MH-Z19C: Auto-calibración (ABC) DESACTIVADA para evitar falsos baselines en
 *         aulas cerradas. Validación de rangos (350 - 5000 ppm).
 *       - MQ-7: Filtro por sobremuestreo y mediana recortada (Trimmed Median Filter)
 *         en ADC para eliminar ruido de alta frecuencia inducido por el WiFi del ESP32.
 *       - PMS5003: Checksum estricto, gestión de buffer no bloqueante y temporización.
 *   [2] CONFIGURACIÓN DINÁMICA (PORTAL CAUTIVO + FLASH NVS):
 *       - Almacenamiento en memoria Flash con Preferences.h.
 *       - Si el WiFi escolar no conecta o no hay configuración previa, genera una red AP
 *         "VCDetection-Setup" con portal cautivo (192.168.4.1) para configurar el
 *         ID de salón, WiFi, Servidor y API Key desde cualquier teléfono o PC sin recompilar.
 *   [3] ACTUALIZACIONES REMOTAS (ArduinoOTA):
 *       - Soporte para flashear por WiFi con Arduino IDE usando contraseña de seguridad.
 * ============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include <time.h>
#include <MHZ19.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoOTA.h>

// ─── Almacenamiento Persistente en Flash (NVS) ────────────────────────────────
Preferences preferences;

// Valores por defecto (se sobreescriben con los guardados en Flash)
String dispositivoId = "SALON_01";
String wifiSSID      = "737MUVIECABLE";
String wifiPassword  = "5F7UHI650JCI89P";
String serverUrl     = "https://vcdetection-backend.onrender.com/api/sensor/lectura";
String deviceApiKey  = "QqDVPhcdVT3sVBEuB35M6GLHyR2Z7QpfLli637wSt4";

// ─── Modo Portal Cautivo ──────────────────────────────────────────────────────
bool modoPortalConfig = false;
WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;
const IPAddress apIP(192, 168, 4, 1);
const IPAddress netMsk(255, 255, 255, 0);

// ─── Pines de Hardware ────────────────────────────────────────────────────────
const int MQ7_PIN   = 32;   // CO — monóxido de carbono
const int DHT_PIN   = 5;    // DHT22 Datos (requiere R 10k pull-up a 3.3V)
#define DHT_TYPE DHT22

// Flag para DHT22: poner en true si tienes DHT22 conectado y con resistencia pull-up
const bool DHT_CONECTADO = false;

#define PMS_RX 16           // Serial2 RX -> PMS5003 TX
#define PMS_TX 17           // Serial2 TX -> PMS5003 RX
#define CO2_RX 26           // MH-Z19C: cable verde (TXD del sensor) -> pin 26
#define CO2_TX 27           // MH-Z19C: cable azul  (RXD del sensor) -> pin 27

// ─── Tiempos y Watchdog ───────────────────────────────────────────────────────
const unsigned long INTERVALO_MUESTREO = 5000;    // 5 segundos entre lecturas
const int           WDT_TIMEOUT        = 25;      // Watchdog: reinicia si se cuelga 25s
const unsigned long TIMEOUT_WIFI_BOOT  = 20000;   // 20 seg para conectar al arrancar antes de abrir portal

// ─── NTP (UTC-6) ──────────────────────────────────────────────────────────────
const char* ntpServer          = "pool.ntp.org";
const long  gmtOffset_sec      = -21600;
const int   daylightOffset_sec = 0;

// ─── Sensores ─────────────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long ultimoMuestreo = 0;

// MH-Z19C (CO2) por UART1
HardwareSerial mhzSerial(1);
MHZ19 myMHZ19;
int   co2ppm = -1;   // -1 = sin lectura válida todavía

// Historial de CO para picos súbitos
float historialCO[5] = {0};
int   indiceGases    = 0;

// ─── Baseline Dinámico Relativo ──────────────────────────────────────────────
const int NUM_MUESTRAS_BASELINE = 60;
float historialBase7[NUM_MUESTRAS_BASELINE]    = {0};   // CO (MQ7)
float historialBasePM25[NUM_MUESTRAS_BASELINE] = {0};   // PM2.5 (PMS5003)
float historialBaseCO2[NUM_MUESTRAS_BASELINE]  = {0};   // CO2 (MH-Z19C)
int   indiceBase      = 0;
bool  bufferBaseLleno = false;

// Historial de humedad
const int NUM_MUESTRAS_HUM = 12;
float historialHumedad[NUM_MUESTRAS_HUM] = {0};
int   indiceHum      = 0;
bool  bufferHumLleno = false;

const int NUM_MUESTRAS_HUM_RAPIDO = 4;
float historialHumedadRapida[NUM_MUESTRAS_HUM_RAPIDO] = {0};
int   indiceHumRapido = 0;

// Confirmación consecutiva para evitar falsos positivos
int contadorHumo = 0;
const int MUESTRAS_CONFIRMACION = 2;

// Período de precalentamiento (3 minutos para MQ7 y cámara NDIR)
const unsigned long TIEMPO_CALENTAMIENTO_MS = 3UL * 60UL * 1000UL;
unsigned long inicioSistema = 0;

// Variables PMS5003
int pm1_0 = -1;
int pm2_5 = -1;
int pm10  = -1;
unsigned long ultimoPMSRx = 0;

// Gestión WiFi no bloqueante
unsigned long ultimoIntentoWiFi = 0;
unsigned long backoffWiFi       = 5000;
bool          wifiConectando    = false;

// ─── Cola Offline en RAM (15 lecturas) ───────────────────────────────────────
#define QUEUE_SIZE 15
struct Lectura {
  float  ppmCO;
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
void  cargarConfiguracion();
void  guardarConfiguracion();
void  iniciarPortalConfiguracion();
void  configurarRutasPortal();
void  iniciarArduinoOTA();
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

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n╔══════════════════════════════════════════════════╗");
  Serial.println("║    VCDETECTION — ESP32 Sensor v2.1 Profesional   ║");
  Serial.println("╚══════════════════════════════════════════════════╝");

  // 1. Cargar configuración desde Flash NVS
  cargarConfiguracion();

  // 2. Iniciar puertos serie para sensores
  Serial2.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);
  mhzSerial.begin(9600, SERIAL_8N1, CO2_RX, CO2_TX);

  // 3. Iniciar MH-Z19C
  myMHZ19.begin(mhzSerial);
  // [MEJORA CRÍTICA 1] DESACTIVAR ABC (Auto-calibración).
  // Evita que el sensor se descalibre en salones cerrados.
  myMHZ19.autoCalibration(false);
  Serial.println("[MH-Z19C] Calibración automática (ABC) DESACTIVADA.");

  // 4. Iniciar DHT22 si está activado
  if (DHT_CONECTADO) {
    dht.begin();
  }

  // 5. Configurar ADC para MQ7
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // 6. Configurar Watchdog Timer
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms    = WDT_TIMEOUT * 1000,
    .idle_core_mask = (1 << 0),
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdt_config);
  esp_task_wdt_add(NULL);

  // 7. Intentar conexión WiFi inicial
  WiFi.mode(WIFI_STA);
  Serial.printf("[WiFi] Conectando a red: %s\n", wifiSSID.c_str());
  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

  unsigned long tInicio = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - tInicio < TIMEOUT_WIFI_BOOT)) {
    delay(400);
    Serial.print(".");
    esp_task_wdt_reset();
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] ✓ Conectado con éxito! IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    iniciarArduinoOTA();
  } else {
    Serial.println("[WiFi] ⚠️ No se pudo conectar a la red guardada.");
    Serial.println("[PORTAL] Activando modo de configuración por Portal Cautivo...");
    iniciarPortalConfiguracion();
  }

  inicioSistema = millis();
  Serial.println("[SISTEMA] Listo. Calentando sensores (~3 minutos)...");
}

// ============================================================================
// LOOP PRINCIPAL
// ============================================================================
void loop() {
  esp_task_wdt_reset();

  // Si estamos en modo portal cautivo, atender peticiones de configuración
  if (modoPortalConfig) {
    dnsServer.processNextRequest();
    server.handleClient();
    delay(10);
    return;
  }

  // Manejar actualizaciones OTA
  ArduinoOTA.handle();

  unsigned long ahora = millis();

  // 1. Gestión no bloqueante de WiFi
  gestionarWiFi();

  // 2. Leer PMS5003 del buffer serie
  leerPMS5003();

  // 3. Muestreo periódico de sensores
  if (ahora - ultimoMuestreo >= INTERVALO_MUESTREO) {
    ultimoMuestreo = ahora;
    leerSensoresYProcesar();
  }

  // 4. Enviar cola si hay WiFi
  if (colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    procesarCola();
  }
}

// ============================================================================
// [FASE 1] SENSORES Y DETECCIÓN
// ============================================================================
void leerSensoresYProcesar() {
  // 1. DHT22
  float humedad = -1, temperatura = -1;
  if (DHT_CONECTADO) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    if (!isnan(h) && !isnan(t)) {
      humedad     = h;
      temperatura = t;
      historialHumedad[indiceHum] = humedad;
      indiceHum = (indiceHum + 1) % NUM_MUESTRAS_HUM;
      if (indiceHum == 0) bufferHumLleno = true;

      historialHumedadRapida[indiceHumRapido] = humedad;
      indiceHumRapido = (indiceHumRapido + 1) % NUM_MUESTRAS_HUM_RAPIDO;
    }
  }

  // 2. MQ7 con sobremuestreo y mediana recortada
  float ppmCO = leerPPM(MQ7_PIN, 10.0, 27.5, 99.042, -1.518);

  // 3. MH-Z19C (CO2) con validación de rango estricta
  int lecturaCO2 = myMHZ19.getCO2();
  if (myMHZ19.errorCode == RESULT_OK && lecturaCO2 >= 350 && lecturaCO2 <= 6000) {
    co2ppm = lecturaCO2;
  } else if (myMHZ19.errorCode != RESULT_OK) {
    Serial.printf("[MH-Z19C] Código de estado: %d\n", myMHZ19.errorCode);
  }

  bool co_valido      = (ppmCO >= 0);
  bool datosPmValidos = (pm1_0 != -1 && pm2_5 != -1 && pm10 != -1);
  bool co2_valido     = (co2ppm > 0);

  if (co_valido) {
    historialCO[indiceGases % 5] = ppmCO;
  }
  indiceGases++;

  // Baseline dinámico
  float basePrev7   = obtenerPromedio(historialBase7,    NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float basePrevPM  = obtenerPromedio(historialBasePM25, NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float basePrevCO2 = obtenerPromedio(historialBaseCO2,  NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);

  bool muestraNormal7   = !co_valido      || (basePrev7   <= 0) || (ppmCO  <= basePrev7  * 1.5);
  bool muestraNormalPM  = !datosPmValidos || (basePrevPM  <= 0) || (pm2_5  <= basePrevPM * 1.6);
  bool muestraNormalCO2 = !co2_valido     || (basePrevCO2 <= 0) || (co2ppm <= basePrevCO2 * 1.15);

  if (muestraNormal7 && muestraNormalPM && muestraNormalCO2) {
    if (co_valido)      historialBase7[indiceBase]    = ppmCO;
    if (datosPmValidos) historialBasePM25[indiceBase] = pm2_5;
    if (co2_valido)     historialBaseCO2[indiceBase]  = co2ppm;
    indiceBase = (indiceBase + 1) % NUM_MUESTRAS_BASELINE;
    if (indiceBase == 0) bufferBaseLleno = true;
  }

  float base7   = basePrev7;
  float basePM  = basePrevPM;
  float baseCO2 = basePrevCO2;

  bool sensoresCalientes = (millis() - inicioSistema) > TIEMPO_CALENTAMIENTO_MS;

  // Lógica de detección de picos y firmas
  bool  picoGas     = detectarPico(historialCO, 5);
  float promHum     = obtenerPromedioHumedad();

  bool subidaHum = DHT_CONECTADO && (promHum > 0) && (humedad > promHum + 10.0);
  int  idxViejo  = (indiceHumRapido) % NUM_MUESTRAS_HUM_RAPIDO;
  float humRapidaVieja = historialHumedadRapida[idxViejo];
  bool saltoHumRapido  = DHT_CONECTADO && (humRapidaVieja > 0) && (humedad - humRapidaVieja > 6.0);
  bool humedadDisparo  = subidaHum || saltoHumRapido;

  bool subidaCO  = co_valido && (base7 > 1.0) && (ppmCO > base7 * 1.6);
  bool subidaCO2 = co2_valido && (baseCO2 > 50.0) && (co2ppm > baseCO2 * 1.15);

  float ratioPM1_25      = (datosPmValidos && pm2_5 > 0) ? (float)pm1_0 / pm2_5 : -1;
  bool  subidaPM         = datosPmValidos && (basePM > 3.0) && (pm2_5 > basePM * 1.6);
  bool  pmMuySaturado    = datosPmValidos && (pm2_5 > 150);
  bool  particulaFina    = datosPmValidos && (ratioPM1_25 > 0.85);
  bool  particulaAncha   = datosPmValidos && (pm10 > pm2_5 * 1.3) && (pm2_5 > 15);
  bool  particulaDisparo = subidaPM || pmMuySaturado;

  bool humoCrudo = sensoresCalientes &&
                   (subidaCO || subidaCO2 || humedadDisparo || particulaDisparo || picoGas);

  contadorHumo = humoCrudo ? contadorHumo + 1 : 0;
  bool humoConfirmado = contadorHumo >= MUESTRAS_CONFIRMACION;

  int evidenciaCigarrillo = (subidaCO ? 2 : 0) + (particulaAncha ? 1 : 0) + (subidaCO2 ? 1 : 0);
  int evidenciaVape       = (particulaFina ? 2 : 0) + (humedadDisparo ? 2 : 0);

  String posibleCausa = "";
  if (evidenciaCigarrillo >= 2 && evidenciaCigarrillo > evidenciaVape) {
    posibleCausa = (evidenciaCigarrillo >= 3) ? "Cigarrillo, alta confianza" : "posible Cigarrillo";
  } else if (evidenciaVape >= 2 && evidenciaVape > evidenciaCigarrillo) {
    posibleCausa = (evidenciaVape >= 4) ? "Vape, alta confianza" : "posible Vape";
  }

  String tipo        = "Aire limpio";
  bool humoDetectado = false;

  if (!sensoresCalientes) {
    tipo = "Calentando sensores";
  } else if (humoConfirmado) {
    tipo = (posibleCausa != "") ? ("Humo detectado (" + posibleCausa + ")") : "Humo detectado";
    humoDetectado = true;
  } else if (humoCrudo) {
    tipo = "Posible humo (sin confirmar)";
    humoDetectado = true;
  }

  if (millis() - ultimoPMSRx > 10000) {
    pm1_0 = -1; pm2_5 = -1; pm10 = -1;
  }

  // Empaquetar lectura
  Lectura lec;
  lec.ppmCO         = ppmCO;
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

  Serial.printf("[%s] MQ7:%.1f (Base:%.1f) | PM2.5:%d (Base:%.1f, ratio:%.2f) | CO2:%d | %s\n",
                lec.timestamp.c_str(), ppmCO, base7, pm2_5, basePM, ratioPM1_25, co2ppm, tipo.c_str());

  // Agregar a cola circular
  colaOffline[colaTail] = lec;
  colaTail = (colaTail + 1) % QUEUE_SIZE;
  if (colaCount < QUEUE_SIZE) {
    colaCount++;
  } else {
    colaHead = (colaHead + 1) % QUEUE_SIZE;
  }
}

// ─── [MEJORA CRÍTICA 2] MQ7 con Filtro de Mediana Recortada ──────────────────
float leerPPM(int pin, float RL, float RO, float A, float B) {
  const int NUM_MUESTRAS = 25;
  int lecturas[NUM_MUESTRAS];

  for (int i = 0; i < NUM_MUESTRAS; i++) {
    lecturas[i] = analogRead(pin);
    delayMicroseconds(200);
  }

  // Ordenar lecturas (Bubble sort simple para 25 valores)
  for (int i = 0; i < NUM_MUESTRAS - 1; i++) {
    for (int j = 0; j < NUM_MUESTRAS - i - 1; j++) {
      if (lecturas[j] > lecturas[j + 1]) {
        int temp = lecturas[j];
        lecturas[j] = lecturas[j + 1];
        lecturas[j + 1] = temp;
      }
    }
  }

  // Descartar las 5 más bajas y las 5 más altas (elimina picos por RF del WiFi)
  long suma = 0;
  for (int i = 5; i < NUM_MUESTRAS - 5; i++) {
    suma += lecturas[i];
  }
  float adc = (float)suma / (NUM_MUESTRAS - 10);
  float voltaje = (adc / 4095.0) * 3.3;

  if (voltaje < 0.05 || voltaje > 3.20) return -1.0;

  float RS = ((3.3 - voltaje) / voltaje) * RL;
  float ratio = RS / RO;
  if (ratio <= 0.001) return -1.0;

  float ppm = A * pow(ratio, B);
  if (!isfinite(ppm) || ppm > 5000.0) return -1.0;

  return ppm;
}

// ─── [MEJORA CRÍTICA 3] PMS5003 con Checksum ────────────────────────────────
void leerPMS5003() {
  while (Serial2.available() >= 32) {
    if (Serial2.read() != 0x42) continue;
    if (Serial2.peek() != 0x4D) continue;
    Serial2.read(); // Consumir 0x4D

    uint8_t buf[30];
    if (Serial2.readBytes(buf, 30) != 30) continue;

    uint16_t checksum = 0x42 + 0x4D;
    for (int i = 0; i < 28; i++) {
      checksum += buf[i];
    }

    uint16_t checksumEsperado = (buf[28] << 8) | buf[29];
    if (checksum != checksumEsperado) {
      continue;
    }

    pm1_0 = (buf[8]  << 8) | buf[9];
    pm2_5 = (buf[10] << 8) | buf[11];
    pm10  = (buf[12] << 8) | buf[13];

    ultimoPMSRx = millis();
  }
}

// ============================================================================
// [FASE 2] CONFIGURACIÓN DINÁMICA CON PORTAL CAUTIVO Y NVS FLASH
// ============================================================================
void cargarConfiguracion() {
  preferences.begin("vcdetection", false);
  dispositivoId = preferences.getString("dev_id", dispositivoId);
  wifiSSID      = preferences.getString("wifi_ssid", wifiSSID);
  wifiPassword  = preferences.getString("wifi_pass", wifiPassword);
  serverUrl     = preferences.getString("srv_url", serverUrl);
  deviceApiKey  = preferences.getString("dev_key", deviceApiKey);
  preferences.end();

  Serial.println("[NVS] Configuración cargada desde Flash:");
  Serial.printf("      ID: %s | SSID: %s | Servidor: %s\n",
                dispositivoId.c_str(), wifiSSID.c_str(), serverUrl.c_str());
}

void guardarConfiguracion(String id, String ssid, String pass, String srv, String key) {
  preferences.begin("vcdetection", false);
  preferences.putString("dev_id", id);
  preferences.putString("wifi_ssid", ssid);
  if (pass.length() > 0) preferences.putString("wifi_pass", pass);
  preferences.putString("srv_url", srv);
  preferences.putString("dev_key", key);
  preferences.end();
  Serial.println("[NVS] ✓ Configuración guardada en Flash");
}

void iniciarPortalConfiguracion() {
  modoPortalConfig = true;

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(apIP, apIP, netMsk);
  WiFi.softAP("VCDetection-Config", "12345678");

  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", apIP);

  configurarRutasPortal();
  server.begin();

  Serial.println("\n╔════════════════════════════════════════════════════╗");
  Serial.println("║  PORTAL CAUTIVO ACTIVO                             ║");
  Serial.println("║  Conéctate al WiFi: VCDetection-Config             ║");
  Serial.println("║  Clave WiFi: 12345678                              ║");
  Serial.println("║  Abre en tu navegador: http://192.168.4.1          ║");
  Serial.println("╚════════════════════════════════════════════════════╝\n");
}

void configurarRutasPortal() {
  server.on("/", HTTP_GET, []() {
    String html = "<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'>"
                  "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                  "<title>VCDetection Config</title>"
                  "<style>"
                  "body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:20px;margin:0;}"
                  ".card{max-width:440px;margin:30px auto;background:#fff;padding:26px;border-radius:18px;box-shadow:0 10px 25px rgba(0,0,0,0.08);}"
                  "h2{margin-top:0;color:#4f46e5;font-size:22px;text-align:center;}"
                  "p{color:#64748b;font-size:14px;text-align:center;margin-bottom:20px;}"
                  "label{display:block;font-size:13px;font-weight:600;margin-top:12px;margin-bottom:4px;}"
                  "input{width:100%;box-sizing:border-box;padding:11px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:14px;}"
                  "input:focus{outline:none;border-color:#6366f1;}"
                  "button{width:100%;background:#4f46e5;color:#fff;border:none;padding:14px;border-radius:12px;font-weight:600;font-size:15px;margin-top:22px;cursor:pointer;}"
                  "button:hover{background:#4338ca;}"
                  "</style></head><body><div class='card'>"
                  "<h2>⚙️ Configuración VCDetection</h2>"
                  "<p>Asigna el salón y las credenciales Wi-Fi del sensor.</p>"
                  "<form action='/guardar' method='POST'>"
                  "<label>ID / Nombre del Salón:</label>"
                  "<input type='text' name='id' value='" + dispositivoId + "' required>"
                  "<label>Nombre Wi-Fi (SSID):</label>"
                  "<input type='text' name='ssid' value='" + wifiSSID + "' required>"
                  "<label>Contraseña Wi-Fi:</label>"
                  "<input type='password' name='pass' placeholder='Dejar en blanco para mantener la actual'>"
                  "<label>URL del Servidor Backend:</label>"
                  "<input type='text' name='srv' value='" + serverUrl + "' required>"
                  "<label>API Key del Dispositivo:</label>"
                  "<input type='text' name='key' value='" + deviceApiKey + "' required>"
                  "<button type='submit'>Guardar y Reiniciar Sensor</button>"
                  "</form></div></body></html>";
    server.send(200, "text/html", html);
  });

  server.on("/guardar", HTTP_POST, []() {
    String id   = server.arg("id");
    String ssid = server.arg("ssid");
    String pass = server.arg("pass");
    String srv  = server.arg("srv");
    String key  = server.arg("key");

    if (id.length() > 0 && ssid.length() > 0) {
      guardarConfiguracion(id, ssid, pass, srv, key);
      String res = "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                   "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                   "<style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f8fafc;}"
                   ".box{max-width:380px;margin:auto;background:#fff;padding:30px;border-radius:16px;box-shadow:0 8px 20px rgba(0,0,0,0.06);}"
                   "h3{color:#10b981;}p{color:#64748b;font-size:14px;}</style></head><body>"
                   "<div class='box'><h3>✓ Configuración Guardada</h3>"
                   "<p>El sensor se está reiniciando para conectarse a <b>" + ssid + "</b>.</p>"
                   "<p>Ya puedes desconectarte de esta red.</p></div></body></html>";
      server.send(200, "text/html", res);
      delay(1500);
      ESP.restart();
    } else {
      server.send(400, "text/plain", "Datos incompletos");
    }
  });

  // Redirecciones estándar de portal cautivo para celulares Android e iOS
  server.on("/generate_204", HTTP_GET, []() {
    server.sendHeader("Location", "/", true);
    server.send(302, "text/plain", "");
  });
  server.on("/hotspot-detect.html", HTTP_GET, []() {
    server.sendHeader("Location", "/", true);
    server.send(302, "text/plain", "");
  });
}

// ============================================================================
// [FASE 3] ACTUALIZACIONES INALÁMBRICAS (ArduinoOTA)
// ============================================================================
void iniciarArduinoOTA() {
  String otaHost = "vcdetection-" + dispositivoId;
  otaHost.toLowerCase();
  otaHost.replace("_", "-");

  ArduinoOTA.setHostname(otaHost.c_str());
  ArduinoOTA.setPort(3232);
  ArduinoOTA.setPassword("vcadmin2026"); // Contraseña de seguridad para flashear

  ArduinoOTA.onStart([]() {
    String type = (ArduinoOTA.getCommand() == U_FLASH) ? "firmware" : "filesystem";
    Serial.println("\n[OTA] Iniciando actualización de " + type);
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] ✓ Actualización completada con éxito. Reiniciando...");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] Progreso: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] ✗ Error [%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.printf("[OTA] Listo. Host: %s en puerto 3232 (Protegido con contraseña)\n", otaHost.c_str());
}

// ============================================================================
// ENVÍO HTTP Y GESTIÓN DE COLA
// ============================================================================
void procesarCola() {
  while (colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    Lectura lec = colaOffline[colaHead];
    bool ok = enviarDatos(lec);

    if (ok) {
      colaHead = (colaHead + 1) % QUEUE_SIZE;
      colaCount--;
    } else {
      break;
    }
  }
}

bool enviarDatos(Lectura &lec) {
  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", deviceApiKey);
  http.setTimeout(3000);

  StaticJsonDocument<450> doc;
  doc["dispositivoId"] = dispositivoId;
  doc["ppmCO"]         = round(lec.ppmCO * 100) / 100.0;
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

  Serial.printf("[HTTP] ✗ Fallo de envío. Código: %d\n", respuesta);
  return false;
}

void gestionarWiFi() {
  unsigned long ahora = millis();

  if (WiFi.status() == WL_CONNECTED) {
    if (wifiConectando) {
      Serial.printf("[WiFi] Reconectado! IP: %s\n", WiFi.localIP().toString().c_str());
      wifiConectando = false;
      backoffWiFi    = 5000;
    }
    return;
  }

  if (ahora - ultimoIntentoWiFi > backoffWiFi) {
    Serial.printf("[WiFi] Intentando reconectar... (backoff: %lums)\n", backoffWiFi);
    WiFi.disconnect(true);
    delay(100);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    wifiConectando    = true;
    ultimoIntentoWiFi = ahora;
    backoffWiFi       = min(backoffWiFi * 2, (unsigned long)60000);
  }
}

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================
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
