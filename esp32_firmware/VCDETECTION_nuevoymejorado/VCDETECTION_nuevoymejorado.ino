/*
 * ============================================================================
 * VCDETECTION — ESP32 Covert Sensor (VERSIÓN PROFESIONAL MEJORADA)
 * ============================================================================
 * 
 * Hardware:
 *   - ESP32 (Microcontrolador Principal)
 *   - MQ7     (GPIO 32)            — Detecta CO (monóxido de carbono)
 *   - DHT22   (GPIO 5)             — Temperatura y Humedad (R pull-up 10k)
 *   - PMS5003 (RX: GPIO16, TX: GPIO17) — Partículas PM1.0, PM2.5, PM10 (UART2)
 *
 * NUEVO v2.2:
 *   - Los sensores se leen SIEMPRE, con o sin WiFi.
 *   - Si no hay WiFi, los datos se imprimen por Serial (115200).
 *   - Menú Serial interactivo: [p]ortal, [r]econectar, [c]onfig, [h]elp.
 *   - Timestamp local HH:MM:SS basado en millis() cuando no hay NTP.
 * ============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include <time.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoOTA.h>

// ─── Almacenamiento Persistente en Flash (NVS) ────────────────────────────────
Preferences preferences;

// Valores por defecto
String dispositivoId = "SALON_01";
String wifiSSID      = "SBIT";
String wifiPassword  = "EaMjJd2020$";
String serverUrl     = "https://vcdetection-backend.onrender.com/api/sensor/lectura";
String deviceApiKey  = "QqDVPhcdVT3sVBEuB35M6GLHyR2Z7QpfLli637wSt4";
String otaPassword   = "vcadmin2026";

// ─── Modo Portal Cautivo ──────────────────────────────────────────────────────
bool modoPortalConfig = false;
WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;
const IPAddress apIP(192, 168, 4, 1);
const IPAddress netMsk(255, 255, 255, 0);

// ─── Pines de Hardware ────────────────────────────────────────────────────────
const int MQ7_PIN        = 32;   // Entrada analógica (divisor de tensión del MQ-7)
const int MQ7_HEATER_PIN = 33;   // *** NUEVO *** Salida PWM que controla el heater vía transistor/MOSFET
const int MQ3_PIN = 35;   // *** NUEVO *** Entrada analógica del MQ-3 (alcohol/VOC, buena proxy para vape).
                            // OJO: el AOUT del módulo puede acercarse a 5V. Usa un divisor resistivo
                            // (ej. 10kΩ en serie + 20kΩ a GND) antes de meterlo a este GPIO,
                            // o puedes dañar el ADC del ESP32 (máximo seguro: 3.3V).
const int ALARMA_EXTERNA_PIN = 34; // Salida digital (DO) de un módulo sensor de sonido (ej. KY-038)
                                     // escuchando la alarma de humo doméstica como respaldo/confirmación
const int DHT_PIN   = 5;
#define DHT_TYPE DHT22

const bool DHT_CONECTADO = true;

// ─── *** NUEVO *** Ciclo de calentamiento del MQ-7 (datasheet: 60s@5V / 90s@1.4V) ─
const unsigned long HEATER_HIGH_MS = 60000UL;  // Fase de "quemado" a ~5V
const unsigned long HEATER_LOW_MS  = 90000UL;  // Fase de medición de CO a ~1.4V
const unsigned long MARGEN_ESTABILIZACION_MS = 20000UL; // Tras pasar a 1.4V, esperar a que Rs se asiente
const int HEATER_PWM_FREQ = 1000; // Hz (mucho mayor que la constante térmica del heater -> promedia bien)
const int HEATER_PWM_RES  = 8;    // bits (0-255)
const int HEATER_DUTY_HIGH = 255;                         // 100% duty ≈ 5V
const int HEATER_DUTY_LOW  = (int)(255.0 * 1.4 / 5.0);    // ≈28% duty ≈ 1.4V promedio

// *** MODO DEMO ***: si lo pones en 1, el heater se queda SIEMPRE en la fase
// de ~1.4V (sin el "quemado" de 60s a 5V) y el CO se lee todo el tiempo, sin
// huecos. Es útil para una presentación/demo urgente. Para uso real y de
// largo plazo, vuelve a ponerlo en 0: el ciclo completo (60s/90s) ayuda a
// mantener el sensor limpio y estable con el tiempo.
#define MODO_DEMO_SIN_CICLO_HEATER 1

enum EstadoCalentador { HEATER_ALTA, HEATER_BAJA };
EstadoCalentador estadoCalentador   = HEATER_ALTA;
unsigned long    tCambioCalentador  = 0;
bool             ventanaMedicionValida = false; // true solo en la parte final y estable de la fase de 1.4V

// ─── *** NUEVO *** R0 calibrado (persistente en NVS, NO se recalcula solo) ───
float r0MQ7 = -1.0; // kΩ. Se carga de NVS en setup(); -1 = sin calibrar
const float RO_CLEAN_AIR_FACTOR = 27.5; // Rs/Ro en aire limpio (dato del datasheet MQ-7, NO es R0)

// ─── MODO DE OPERACIÓN SIN WIFI ──────────────────────────────────────────────
// true  = si no hay WiFi, levanta el portal cautivo (modo configuración)
// false = si no hay WiFi, sigue leyendo sensores y los imprime por Serial
const bool ACTIVAR_PORTAL_CAUTIVO = false;

// *** ATENCIÓN ***: el encabezado del archivo dice "PMS5003 (RX: GPIO16, TX: GPIO17)"
// pero aquí se usan 26/27. Uno de los dos está mal. Confirma tu cableado físico
// y deja SOLO el par correcto; un pin equivocado es la causa más probable de
// que pm2_5 quede en -1 permanentemente (nunca llegan bytes válidos por Serial2).
#define PMS_RX 26
#define PMS_TX 27

// *** NUEVO *** Desactiva el PMS5003 por completo mientras no lo revises/repares.
// En 0: nunca se llama a leerPMS5003(), pm2_5/pm1_0/pm10 quedan fijos en -1,
// y toda la lógica que depende de PM2.5 (particulaFina/Ancha, subidaPM) se
// desactiva sola (ya está preparada para -1 = "sin datos"). Cuando lo arregles,
// vuelve a poner esto en 1.
#define PMS_HABILITADO 0

// ─── Tiempos y Watchdog ───────────────────────────────────────────────────────
const unsigned long INTERVALO_MUESTREO = 5000;
const int           WDT_TIMEOUT        = 25;
const unsigned long TIMEOUT_WIFI_BOOT  = 20000;

// ─── NTP (UTC-6) ──────────────────────────────────────────────────────────────
const char* ntpServer          = "pool.ntp.org";
const long  gmtOffset_sec      = -21600;
const int   daylightOffset_sec = 0;

// ─── Sensores ─────────────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long ultimoMuestreo = 0;

// Historial de CO
float historialCO[5] = {0};
int   indiceGases    = 0;

// ─── Baseline Dinámico ───────────────────────────────────────────────────────
const int NUM_MUESTRAS_BASELINE = 60;
float historialBase7[NUM_MUESTRAS_BASELINE]    = {0};
float historialBasePM25[NUM_MUESTRAS_BASELINE] = {0};
float historialBase3[NUM_MUESTRAS_BASELINE]    = {0}; // *** NUEVO *** baseline del MQ-3
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

// Confirmación consecutiva
int contadorHumo = 0;
const int MUESTRAS_CONFIRMACION = 2;

// Precalentamiento (3 min)
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

// ─── Cola Offline ────────────────────────────────────────────────────────────
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
  String timestamp;
};

Lectura colaOffline[QUEUE_SIZE];
int colaHead  = 0;
int colaTail  = 0;
int colaCount = 0;

// ─── Prototipos ───────────────────────────────────────────────────────────────
void  cargarConfiguracion();
void  guardarConfiguracion(String id, String ssid, String pass, String srv, String key, String otaPass);
void  iniciarPortalConfiguracion();
void  configurarRutasPortal();
void  iniciarArduinoOTA();
void  leerSensoresYProcesar();
void  leerPMS5003();
void  procesarCola();
bool  enviarDatos(Lectura &lec);
void  gestionarWiFi();
String getTimestampISO();
float leerPPM(int pin, float RL, float A, float B);
float leerRS_MQ7(int pin, float RL);
float leerVozMQ3(int pin);
float compensarHumedadTemp(float ppmBruto, float temperatura, float humedad);
void  actualizarCalentadorMQ7();
void  cargarR0();
void  calibrarR0MQ7();
bool  detectarPico(float* hist, int size, float umbral);
float obtenerPromedioHumedad();
float obtenerPromedio(float* hist, int size, bool lleno, int indiceActual);
void  procesarMenuSerial();
void  imprimirAyudaSerial();

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n╔══════════════════════════════════════════════════╗");
  Serial.println("║   VCDETECTION — ESP32 Sensor v2.2 (Serial OK)    ║");
  Serial.println("╚══════════════════════════════════════════════════╝");

  cargarConfiguracion();

#if PMS_HABILITADO
  Serial2.begin(9600, SERIAL_8N1, PMS_RX, PMS_TX);
#else
  Serial.println("[PMS5003] Desactivado por ahora (PMS_HABILITADO 0). PM2.5 quedará en -1.");
#endif

  if (DHT_CONECTADO) {
    dht.begin();
  }

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // *** NUEVO *** Entrada del sensor de sonido que escucha la alarma de humo.
  // INPUT_PULLDOWN: si aún no lo conectas, queda en LOW y no afecta nada.
  pinMode(ALARMA_EXTERNA_PIN, INPUT_PULLDOWN);

  // *** NUEVO *** PWM del heater del MQ-7 (API ledc de ESP32 core >= 3.0).
  // Si tu core es 2.x, reemplaza esta línea por:
  //   ledcSetup(0, HEATER_PWM_FREQ, HEATER_PWM_RES); ledcAttachPin(MQ7_HEATER_PIN, 0);
  // y usa ledcWrite(0, duty) en vez de ledcWrite(MQ7_HEATER_PIN, duty) más abajo.
  ledcAttach(MQ7_HEATER_PIN, HEATER_PWM_FREQ, HEATER_PWM_RES);
  tCambioCalentador = millis();
  estadoCalentador   = HEATER_ALTA;

  // *** NUEVO *** Carga el R0 calibrado y guardado en Flash (si existe)
  cargarR0();

  esp_task_wdt_config_t wdt_config = {
    .timeout_ms    = WDT_TIMEOUT * 1000,
    .idle_core_mask = (1 << 0),
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdt_config);
  esp_task_wdt_add(NULL);

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
    Serial.printf("[WiFi] ✓ Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    iniciarArduinoOTA();
  } else {
    Serial.println("[WiFi] ⚠️ No se pudo conectar a la red guardada.");
    if (ACTIVAR_PORTAL_CAUTIVO) {
      Serial.println("[PORTAL] Activando modo de configuración por Portal Cautivo...");
      iniciarPortalConfiguracion();
    } else {
      Serial.println("[MODO] Continuando SIN WiFi. Datos se imprimirán por Serial.");
      Serial.println("[MODO] Reintentos de WiFi en segundo plano.");
    }
  }

  inicioSistema = millis();
  Serial.println("[SISTEMA] Listo. Calentando sensores (~3 minutos)...");
  imprimirAyudaSerial();
}

// ============================================================================
// LOOP PRINCIPAL
// ============================================================================
void loop() {
  esp_task_wdt_reset();

  // Procesar comandos del Monitor Serie
  procesarMenuSerial();

  // Portal cautivo (sin bloquear sensores)
  if (modoPortalConfig) {
    dnsServer.processNextRequest();
    server.handleClient();
  } else {
    ArduinoOTA.handle();
    gestionarWiFi();
  }

  unsigned long ahora = millis();

  // *** NUEVO *** Ciclo del heater del MQ-7 (no bloqueante, corre siempre)
  actualizarCalentadorMQ7();

#if PMS_HABILITADO
  // PMS5003 siempre
  leerPMS5003();
#endif

  // Muestreo siempre
  if (ahora - ultimoMuestreo >= INTERVALO_MUESTREO) {
    ultimoMuestreo = ahora;
    leerSensoresYProcesar();
  }

  // Envío HTTP solo si hay WiFi y no estamos en portal
  if (!modoPortalConfig && colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    procesarCola();
  }
}

// ============================================================================
// MENÚ SERIAL
// ============================================================================
void imprimirAyudaSerial() {
  Serial.println("\n┌─────────── MENÚ SERIAL ───────────┐");
  Serial.println("│  p  →  Forzar Portal Cautivo      │");
  Serial.println("│  r  →  Reconectar WiFi ahora      │");
  Serial.println("│  c  →  Mostrar configuración      │");
  Serial.println("│  b  →  Borrar config (¡reset!)    │");
  Serial.println("│  s  →  Mostrar estado             │");
  Serial.println("│  k  →  Calibrar R0 (en AIRE LIMPIO)│");
  Serial.println("│  h  →  Este menú                  │");
  Serial.println("└───────────────────────────────────┘\n");
}

void procesarMenuSerial() {
  if (!Serial.available()) return;
  char c = Serial.read();
  Serial.printf("[SERIAL] Byte recibido: '%c' (0x%02X)\n", c, (uint8_t)c); // *** DEBUG *** quita esta línea cuando confirmes que funciona
  while (Serial.available()) Serial.read(); // limpiar buffer

  switch (c) {
    case 'p': case 'P':
      Serial.println("[MENU] Forzando Portal Cautivo...");
      iniciarPortalConfiguracion();
      break;

    case 'r': case 'R':
      Serial.println("[MENU] Forzando reconexión WiFi...");
      WiFi.disconnect(true);
      delay(100);
      WiFi.mode(WIFI_STA);
      WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
      ultimoIntentoWiFi = millis();
      backoffWiFi       = 5000;
      wifiConectando    = true;
      break;

    case 'c': case 'C':
      Serial.println("\n[CONFIG] Configuración actual:");
      Serial.printf("  ID        : %s\n", dispositivoId.c_str());
      Serial.printf("  SSID      : %s\n", wifiSSID.c_str());
      Serial.printf("  Password  : %s\n", wifiPassword.length() > 0 ? "(oculta)" : "(vacía)");
      Serial.printf("  Servidor  : %s\n", serverUrl.c_str());
      Serial.printf("  API Key   : %s\n", deviceApiKey.length() > 0 ? "(presente)" : "(vacía)");
      Serial.printf("  OTA Pass  : %s\n", otaPassword.length() > 0 ? "(oculta)" : "(vacía)");
      Serial.println();
      break;

    case 'b': case 'B':
      Serial.println("[MENU] Borrando configuración NVS...");
      preferences.begin("vcdetection", false);
      preferences.clear();
      preferences.end();
      Serial.println("[MENU] Configuración borrada. Reiniciando...");
      delay(1000);
      ESP.restart();
      break;

    case 's': case 'S':
      Serial.println("\n[ESTADO]");
      Serial.printf("  Uptime       : %lu s\n", millis() / 1000);
      Serial.printf("  WiFi         : %s\n",
                    WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO");
      if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("  IP           : %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("  RSSI         : %d dBm\n", WiFi.RSSI());
      }
      Serial.printf("  Cola offline : %d/%d\n", colaCount, QUEUE_SIZE);
      Serial.printf("  Portal       : %s\n", modoPortalConfig ? "ACTIVO" : "inactivo");
      Serial.printf("  Calentando   : %s\n",
                    (millis() - inicioSistema) < TIEMPO_CALENTAMIENTO_MS ? "sí" : "no");
      Serial.printf("  Heater MQ-7  : %s (ventana de medición %s)\n",
                    estadoCalentador == HEATER_ALTA ? "FASE ALTA (~5V)" : "FASE BAJA (~1.4V)",
                    ventanaMedicionValida ? "VÁLIDA" : "no válida aún");
      Serial.printf("  R0 MQ-7      : %s\n",
                    r0MQ7 > 0 ? (String(r0MQ7, 2) + " kΩ").c_str() : "SIN CALIBRAR (usa 'k')");
      Serial.println();
      break;

    case 'k': case 'K':
      calibrarR0MQ7();
      break;

    case 'h': case 'H': case '?':
      imprimirAyudaSerial();
      break;

    default:
      break;
  }
}

// ============================================================================
// SENSORES Y DETECCIÓN
// ============================================================================
void leerSensoresYProcesar() {
  esp_task_wdt_reset();

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

  esp_task_wdt_reset();

  // *** NUEVO *** Solo se considera una lectura de CO válida durante la fase
  // de 1.4V del heater, ya estabilizada, y solo si el sensor tiene R0 calibrado.
  float ppmCO = -1.0;
  if (ventanaMedicionValida && r0MQ7 > 0) {
    float ppmBruto = leerPPM(MQ7_PIN, 10.0, 99.042, -1.518);
    if (ppmBruto >= 0) {
      ppmCO = compensarHumedadTemp(ppmBruto, temperatura, humedad);
    }
  }

  bool co_valido      = (ppmCO >= 0);
  bool datosPmValidos = (pm1_0 != -1 && pm2_5 != -1 && pm10 != -1);

  if (co_valido) {
    historialCO[indiceGases % 5] = ppmCO;
  }
  indiceGases++;

  // *** NUEVO *** MQ-3: no necesita R0/calibración de ppm, solo comparar contra
  // su propia base reciente (igual filosofía que ya usas para picoGas).
  float vozMQ3 = leerVozMQ3(MQ3_PIN);
  bool  mq3_valido = (vozMQ3 >= 0);

  float basePrev7   = obtenerPromedio(historialBase7,    NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float basePrevPM  = obtenerPromedio(historialBasePM25, NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float basePrev3   = obtenerPromedio(historialBase3,    NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);

  bool muestraNormal7   = !co_valido      || (basePrev7   <= 0) || (ppmCO  <= basePrev7  * 1.5);
  bool muestraNormalPM  = !datosPmValidos || (basePrevPM  <= 0) || (pm2_5  <= basePrevPM * 1.6);
  bool muestraNormal3   = !mq3_valido     || (basePrev3   <= 0) || (vozMQ3 <= basePrev3  * 1.5);

  if (muestraNormal7 && muestraNormalPM && muestraNormal3) {
    if (co_valido)      historialBase7[indiceBase]    = ppmCO;
    if (datosPmValidos) historialBasePM25[indiceBase] = pm2_5;
    if (mq3_valido)      historialBase3[indiceBase]    = vozMQ3;
    indiceBase = (indiceBase + 1) % NUM_MUESTRAS_BASELINE;
    if (indiceBase == 0) bufferBaseLleno = true;
  }

  float base7   = basePrev7;
  float basePM  = basePrevPM;
  float base3   = basePrev3;

  // *** NUEVO *** Pico de alcohol/VOC (vape) relativo a su propia base
  bool subidaMQ3 = mq3_valido && (base3 > 0.05) && (vozMQ3 > base3 * 1.6);

  bool sensoresCalientes = (millis() - inicioSistema) > TIEMPO_CALENTAMIENTO_MS;

    // *** CORREGIDO *** Umbral relativo: con R0 bien calibrado el CO en aire
  // limpio ronda unas pocas/decenas de ppm, así que un umbral fijo de 50 ppm
  // (pensado para la escala vieja, inflada, de 200-1800 ppm) ya no tiene sentido.
  float umbralPico = base7 > 0 ? max(5.0f, base7 * 0.5f) : 5.0f;
  bool  picoGas     = detectarPico(historialCO, 5, umbralPico);
  float promHum     = obtenerPromedioHumedad();

  bool subidaHum = DHT_CONECTADO && (promHum > 0) && (humedad > promHum + 10.0);
  int  idxViejo  = (indiceHumRapido) % NUM_MUESTRAS_HUM_RAPIDO;
  float humRapidaVieja = historialHumedadRapida[idxViejo];
  bool saltoHumRapido  = DHT_CONECTADO && (humRapidaVieja > 0) && (humedad - humRapidaVieja > 6.0);
  // *** CORREGIDO *** La humedad ambiental por sí sola YA NO dispara "humo":
  // el MQ-7 es sensible a la humedad y un cambio normal del ambiente (ej. 71%→73%)
  // no es evidencia de gas. Se conserva solo como pista secundaria para "vape".
  bool humedadDisparo  = subidaHum || saltoHumRapido;

  bool subidaCO  = co_valido && (base7 > 1.0) && (ppmCO > base7 * 1.6);

  float ratioPM1_25      = (datosPmValidos && pm2_5 > 0) ? (float)pm1_0 / pm2_5 : -1;
  bool  subidaPM         = datosPmValidos && (basePM > 3.0) && (pm2_5 > basePM * 1.6);
  bool  pmMuySaturado    = datosPmValidos && (pm2_5 > 150);
  bool  particulaFina    = datosPmValidos && (ratioPM1_25 > 0.85);
  bool  particulaAncha   = datosPmValidos && (pm10 > pm2_5 * 1.3) && (pm2_5 > 15);
  bool  particulaDisparo = subidaPM || pmMuySaturado;

  // *** NUEVO *** Respaldo: alarma de humo doméstica detectada por sonido.
  bool alarmaExterna = (digitalRead(ALARMA_EXTERNA_PIN) == HIGH);

  bool humoCrudo = sensoresCalientes &&
                   (subidaCO || particulaDisparo || picoGas || alarmaExterna || subidaMQ3);

  contadorHumo = humoCrudo ? contadorHumo + 1 : 0;
  bool humoConfirmado = contadorHumo >= MUESTRAS_CONFIRMACION;

  // *** NUEVO *** El MQ-3 es la señal más directa que tienes para vape (PG/VG
  // reacciona fuerte con sensores de alcohol), así que pesa fuerte en el score.
  int evidenciaCigarrillo = (subidaCO ? 2 : 0) + (particulaAncha ? 1 : 0)
                             + ((alarmaExterna && subidaCO)  ? 1 : 0);
  int evidenciaVape       = (particulaFina ? 2 : 0) + (humedadDisparo ? 2 : 0)
                             + (subidaMQ3 ? 3 : 0)
                             + ((alarmaExterna && !subidaCO) ? 1 : 0);

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
  } else if (r0MQ7 <= 0) {
    tipo = "MQ-7 sin calibrar (usa 'k' en aire limpio)";
  } else if (!ventanaMedicionValida) {
    tipo = "Ciclo heater: fase alta / estabilizando (sin lectura CO)";
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
  lec.timestamp     = getTimestampISO();

  Serial.printf("[%s] MQ7:%.1f (Base:%.1f) | MQ3:%.2fV (Base:%.2fV%s) | T:%.1f°C H:%.1f%% | PM2.5:%d (Base:%.1f, r:%.2f) | Alarma:%s | %s\n",
                lec.timestamp.c_str(), ppmCO, base7, vozMQ3, base3, subidaMQ3 ? " ↑PICO" : "",
                temperatura, humedad,
                pm2_5, basePM, ratioPM1_25, alarmaExterna ? "SÍ" : "no", tipo.c_str());

  colaOffline[colaTail] = lec;
  colaTail = (colaTail + 1) % QUEUE_SIZE;
  if (colaCount < QUEUE_SIZE) {
    colaCount++;
  } else {
    colaHead = (colaHead + 1) % QUEUE_SIZE;
  }
}

// ─── *** NUEVO *** Ciclo del heater del MQ-7 (no bloqueante) ─────────────────
void actualizarCalentadorMQ7() {
#if MODO_DEMO_SIN_CICLO_HEATER
  // Modo demo: se queda fijo en la fase de medición (~1.4V), sin fase de
  // quemado de 60s. Lectura continua, pero sin el mantenimiento que da el
  // ciclo completo del datasheet.
  ledcWrite(MQ7_HEATER_PIN, HEATER_DUTY_LOW);
  ventanaMedicionValida = (millis() - tCambioCalentador >= MARGEN_ESTABILIZACION_MS);
  return;
#endif
  unsigned long ahora        = millis();
  unsigned long transcurrido = ahora - tCambioCalentador;

  if (estadoCalentador == HEATER_ALTA) {
    ledcWrite(MQ7_HEATER_PIN, HEATER_DUTY_HIGH);   // ~5V: fase de "quemado"
    ventanaMedicionValida = false;
    if (transcurrido >= HEATER_HIGH_MS) {
      estadoCalentador  = HEATER_BAJA;
      tCambioCalentador = ahora;
    }
  } else {
    ledcWrite(MQ7_HEATER_PIN, HEATER_DUTY_LOW);    // ~1.4V: fase de medición de CO
    ventanaMedicionValida = (transcurrido >= MARGEN_ESTABILIZACION_MS);
    if (transcurrido >= HEATER_LOW_MS) {
      estadoCalentador  = HEATER_ALTA;
      tCambioCalentador = ahora;
    }
  }
}

// ─── *** NUEVO *** Rs del MQ7 con filtro de mediana recortada (sin R0 aún) ───
// ─── *** NUEVO *** MQ-3: solo necesitamos un valor relativo, no ppm exacto ───
// (más voltaje = menos resistencia del sensor = más alcohol/VOC detectado,
// asumiendo el cableado típico: VCC -> sensor -> nodo AOUT -> RL -> GND)
float leerVozMQ3(int pin) {
  const int NUM_MUESTRAS = 25;
  int lecturas[NUM_MUESTRAS];

  for (int i = 0; i < NUM_MUESTRAS; i++) {
    lecturas[i] = analogRead(pin);
    delayMicroseconds(200);
  }

  for (int i = 0; i < NUM_MUESTRAS - 1; i++) {
    for (int j = 0; j < NUM_MUESTRAS - i - 1; j++) {
      if (lecturas[j] > lecturas[j + 1]) {
        int temp = lecturas[j];
        lecturas[j] = lecturas[j + 1];
        lecturas[j + 1] = temp;
      }
    }
  }

  long suma = 0;
  for (int i = 5; i < NUM_MUESTRAS - 5; i++) {
    suma += lecturas[i];
  }
  float adc = (float)suma / (NUM_MUESTRAS - 10);
  float voltaje = (adc / 4095.0) * 3.3;

  if (voltaje < 0.02) return -1.0; // sensor no conectado / sin alimentación
  return voltaje;
}

float leerRS_MQ7(int pin, float RL) {
  const int NUM_MUESTRAS = 25;
  int lecturas[NUM_MUESTRAS];

  for (int i = 0; i < NUM_MUESTRAS; i++) {
    lecturas[i] = analogRead(pin);
    delayMicroseconds(200);
  }

  for (int i = 0; i < NUM_MUESTRAS - 1; i++) {
    for (int j = 0; j < NUM_MUESTRAS - i - 1; j++) {
      if (lecturas[j] > lecturas[j + 1]) {
        int temp = lecturas[j];
        lecturas[j] = lecturas[j + 1];
        lecturas[j + 1] = temp;
      }
    }
  }

  long suma = 0;
  for (int i = 5; i < NUM_MUESTRAS - 5; i++) {
    suma += lecturas[i];
  }
  float adc = (float)suma / (NUM_MUESTRAS - 10);
  float voltaje = (adc / 4095.0) * 3.3;

  if (voltaje < 0.05 || voltaje > 3.20) return -1.0;

  return ((3.3 - voltaje) / voltaje) * RL; // Rs, en las mismas unidades que RL (kΩ si RL=10.0)
}

// ─── *** NUEVO *** Conversión Rs/R0 → ppm usando el R0 YA calibrado ──────────
float leerPPM(int pin, float RL, float A, float B) {
  float RS = leerRS_MQ7(pin, RL);
  if (RS <= 0) return -1.0;
  if (r0MQ7 <= 0) return -1.0; // sin calibrar: no inventamos un ppm

  float ratio = RS / r0MQ7;
  if (ratio <= 0.001) return -1.0;

  float ppm = A * pow(ratio, B);
  if (!isfinite(ppm) || ppm > 5000.0) return -1.0;

  return ppm;
}

// ─── *** NUEVO *** Carga de R0 desde NVS (Flash) ─────────────────────────────
void cargarR0() {
  preferences.begin("vcdetection", false);
  r0MQ7 = preferences.getFloat("r0_mq7", -1.0);
  preferences.end();

  if (r0MQ7 <= 0) {
    Serial.println("[MQ7] ⚠️  No hay R0 calibrado en Flash. El CO no se reportará");
    Serial.println("[MQ7]     hasta que ejecutes 'k' con el sensor en AIRE LIMPIO.");
  } else {
    Serial.printf("[MQ7] R0 cargado desde NVS: %.2f kΩ (fijo, no se recalcula solo)\n", r0MQ7);
  }
}

// ─── *** NUEVO *** Calibración de R0 (una sola vez, manual, en aire limpio) ──
// IMPORTANTE: 27.5 es el ratio Rs/Ro EN AIRE LIMPIO que da el datasheet del
// MQ-7, no es R0. R0 se calcula así: R0 = Rs_medido_en_aire_limpio / 27.5.
// Antes el código usaba 27.5 directamente como si fuera R0, lo que inflaba
// los ppm reportados muy por encima de lo real.
void calibrarR0MQ7() {
  Serial.println("[MQ7] Calibrando R0... asegúrate de estar en AIRE LIMPIO (sin humo, gas, alcohol, etc).");
  Serial.println("[MQ7] Esperando a que el heater entre en la ventana de medición (1.4V estable)...");

  unsigned long inicioEspera = millis();
  while (!ventanaMedicionValida) {
    actualizarCalentadorMQ7();
    esp_task_wdt_reset();
    delay(200);
    if (millis() - inicioEspera > 3UL * 60UL * 1000UL) {
      Serial.println("[MQ7] ✗ Tiempo de espera agotado. Intenta de nuevo más tarde.");
      return;
    }
  }

  const int muestras = 50;
  float sumaRS = 0;
  int   validas = 0;
  for (int i = 0; i < muestras; i++) {
    esp_task_wdt_reset();
    float rs = leerRS_MQ7(MQ7_PIN, 10.0);
    if (rs > 0) { sumaRS += rs; validas++; }
    delay(300);
  }

  if (validas < muestras / 2) {
    Serial.println("[MQ7] ✗ Calibración fallida: demasiadas lecturas inválidas. Revisa el cableado.");
    return;
  }

  float rsPromedio = sumaRS / validas;
  r0MQ7 = rsPromedio / RO_CLEAN_AIR_FACTOR;

  preferences.begin("vcdetection", false);
  preferences.putFloat("r0_mq7", r0MQ7);
  preferences.end();

  Serial.printf("[MQ7] ✓ Calibración completa. Rs(aire)=%.2f kΩ  →  R0=%.2f kΩ (guardado en Flash)\n",
                rsPromedio, r0MQ7);
}

// ─── *** NUEVO *** Compensación aproximada por humedad/temperatura ───────────
// El datasheet del MQ-7 solo publica curvas gráficas de corrección (no una
// fórmula oficial). Esta es una aproximación lineal práctica, centrada en
// 20°C / 65% HR (referencia habitual del datasheet). NO sustituye una
// calibración con gas patrón si necesitas precisión certificable.
float compensarHumedadTemp(float ppmBruto, float temperatura, float humedad) {
  if (ppmBruto < 0 || isnan(temperatura) || isnan(humedad) || humedad < 0 || temperatura < -40) {
    return ppmBruto;
  }
  float factorHumedad = 1.0 - 0.006 * (humedad - 65.0);      // ≈ -0.6% de ppm por cada %HR de más
  float factorTemp    = 1.0 - 0.003 * (temperatura - 20.0);  // ≈ -0.3% de ppm por cada °C de más
  float factor = factorHumedad * factorTemp;
  if (factor < 0.5) factor = 0.5;
  if (factor > 1.5) factor = 1.5;
  return ppmBruto * factor;
}

// ─── PMS5003 con Checksum ─────────────────────────────────────────────────────
void leerPMS5003() {
  while (Serial2.available() >= 32) {
    if (Serial2.read() != 0x42) continue;
    if (Serial2.peek() != 0x4D) continue;
    Serial2.read();

    uint8_t buf[30];
    if (Serial2.readBytes(buf, 30) != 30) continue;

    uint16_t checksum = 0x42 + 0x4D;
    for (int i = 0; i < 28; i++) {
      checksum += buf[i];
    }

    uint16_t checksumEsperado = (buf[28] << 8) | buf[29];
    if (checksum != checksumEsperado) continue;

    pm1_0 = (buf[8]  << 8) | buf[9];
    pm2_5 = (buf[10] << 8) | buf[11];
    pm10  = (buf[12] << 8) | buf[13];

    ultimoPMSRx = millis();
  }
}

// ============================================================================
// CONFIGURACIÓN DINÁMICA (PORTAL CAUTIVO + NVS)
// ============================================================================
void cargarConfiguracion() {
  preferences.begin("vcdetection", false);
  dispositivoId = preferences.getString("dev_id", dispositivoId);
  wifiSSID      = preferences.getString("wifi_ssid", wifiSSID);
  wifiPassword  = preferences.getString("wifi_pass", wifiPassword);
  serverUrl     = preferences.getString("srv_url", serverUrl);
  deviceApiKey  = preferences.getString("dev_key", deviceApiKey);
  otaPassword   = preferences.getString("ota_pass", otaPassword);
  preferences.end();

  Serial.println("[NVS] Configuración cargada desde Flash:");
  Serial.printf("      ID: %s | SSID: %s | Servidor: %s\n",
                dispositivoId.c_str(), wifiSSID.c_str(), serverUrl.c_str());
}

void guardarConfiguracion(String id, String ssid, String pass, String srv, String key, String otaPass) {
  preferences.begin("vcdetection", false);
  preferences.putString("dev_id", id);
  preferences.putString("wifi_ssid", ssid);
  if (pass.length() > 0) preferences.putString("wifi_pass", pass);
  preferences.putString("srv_url", srv);
  preferences.putString("dev_key", key);
  if (otaPass.length() > 0) preferences.putString("ota_pass", otaPass);
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
  Serial.println("║  WiFi: VCDetection-Config  |  Clave: 12345678      ║");
  Serial.println("║  Abre: http://192.168.4.1                          ║");
  Serial.println("║  (Sensores siguen midiendo por Serial)             ║");
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
                  "<label>Contraseña de actualización OTA:</label>"
                  "<input type='password' name='otapass' placeholder='Dejar en blanco para mantener la actual'>"
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
    String otaPass = server.arg("otapass");

    if (id.length() > 0 && ssid.length() > 0) {
      guardarConfiguracion(id, ssid, pass, srv, key, otaPass);
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
// ArduinoOTA
// ============================================================================
void iniciarArduinoOTA() {
  String otaHost = "vcdetection-" + dispositivoId;
  otaHost.toLowerCase();
  otaHost.replace("_", "-");

  ArduinoOTA.setHostname(otaHost.c_str());
  ArduinoOTA.setPort(3232);
  ArduinoOTA.setPassword(otaPassword.c_str());

  ArduinoOTA.onStart([]() {
    String type = (ArduinoOTA.getCommand() == U_FLASH) ? "firmware" : "filesystem";
    Serial.println("\n[OTA] Iniciando actualización de " + type);
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] ✓ Actualización completada. Reiniciando...");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] Progreso: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] ✗ Error [%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.printf("[OTA] Listo. Host: %s puerto 3232\n", otaHost.c_str());
}

// ============================================================================
// ENVÍO HTTP Y COLA
// ============================================================================
void procesarCola() {
  while (colaCount > 0 && WiFi.status() == WL_CONNECTED) {
    esp_task_wdt_reset();
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
      Serial.printf("[WiFi] ✓ Reconectado! IP: %s\n", WiFi.localIP().toString().c_str());
      wifiConectando = false;
      backoffWiFi    = 5000;
    }
    return;
  }

  if (ahora - ultimoIntentoWiFi > backoffWiFi) {
    Serial.printf("[WiFi] Reintentando... (backoff: %lums)\n", backoffWiFi);
    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    wifiConectando    = true;
    ultimoIntentoWiFi = ahora;
    backoffWiFi       = min(backoffWiFi * 2, (unsigned long)60000);
  }
}

// ============================================================================
// AUXILIARES
// ============================================================================
bool detectarPico(float* hist, int size, float umbral) {
  float minVal = hist[0], maxVal = hist[0];
  for (int i = 1; i < size; i++) {
    if (hist[i] < minVal) minVal = hist[i];
    if (hist[i] > maxVal) maxVal = hist[i];
  }
  return (maxVal - minVal) > umbral;
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

// ─── Timestamp ISO con fallback a millis() ────────────────────────────────────
String getTimestampISO() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10)) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S-06:00", &timeinfo);
    return String(buf);
  }

  // Fallback: usar millis() como HH:MM:SS desde el arranque
  unsigned long totalSeg = millis() / 1000;
  int h = (totalSeg / 3600) % 100;
  int m = (totalSeg / 60) % 60;
  int s = totalSeg % 60;
  char buf[32];
  snprintf(buf, sizeof(buf), "T+%02d:%02d:%02d (sin NTP)", h, m, s);
  return String(buf);
}
