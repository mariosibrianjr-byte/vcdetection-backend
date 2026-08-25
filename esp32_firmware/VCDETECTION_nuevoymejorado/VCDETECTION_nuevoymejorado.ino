/*
 * VCDETECTION — ESP32 Covert Sensor (VERSIÓN CORREGIDA)
 * 
 * Hardware:
 *   - ESP32 (Microcontrolador Principal)
 *   - MQ7   (GPIO 32) — Detecta CO (monóxido de carbono) — firma de combustión real
 *   - DHT22 (GPIO 5)  — Temperatura y Humedad
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
 *   [7] MQ135 y MQ2 (dañados) sacados del circuito — detección ahora se
 *       apoya en MQ7 (CO) + PMS5003 (partícula) + DHT22 (humedad)
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
const char* DEVICE_API_KEY = "QqDVPhcdVT3sVBEuB35M6GLHyR2Z7QpfLli637wSt4";

// ─── Pines ────────────────────────────────────────────────────────────────────
const int MQ7_PIN   = 32;   // CO — diferenciador de combustión (cigarrillo)
const int DHT_PIN   = 5;
#define DHT_TYPE DHT22

// ─── DHT22 desconectado — no responde pese a cableado/pines verificados ────
// Cuando consigas uno que funcione, poné esto en "true" y listo, no hay que
// tocar nada más — el resto del código ya se adapta solo.
const bool DHT_CONECTADO = false;
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

// Historial de CO (últimas 5 muestras para detectar pico)
float historialCO[5]  = {0};
int   indiceGases     = 0;

// ─── Baseline dinámico de CO (ventana larga, ~5 min = 60 muestras de 5s) ────
// En vez de comparar contra un número fijo (que varía por sala/instalación),
// comparamos contra el promedio "normal" reciente de ESA sala.
const int NUM_MUESTRAS_BASELINE = 60;
float historialBase7[NUM_MUESTRAS_BASELINE]     = {0};   // CO (MQ7)
float historialBasePM25[NUM_MUESTRAS_BASELINE]  = {0};   // PM2.5 (PMS5003)
float historialBaseCO2[NUM_MUESTRAS_BASELINE]   = {0};   // CO2 (MH-Z19C)
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
int contadorHumo = 0;   // ciclos consecutivos con alguna señal de humo
const int MUESTRAS_CONFIRMACION = 2;   // 2 lecturas seguidas (10s) para confirmar

// ─── Tiempo de calentamiento de sensores MQ ──────────────────────────────────
// El MQ7 da lecturas erráticas los primeros minutos tras encender.
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

  // Configuración ADC para MQ7
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
  // 1. DHT22
  float humedad, temperatura;
  if (DHT_CONECTADO) {
    humedad     = dht.readHumidity();
    temperatura = dht.readTemperature();
  } else {
    humedad = NAN; temperatura = NAN;
  }

  if (isnan(humedad) || isnan(temperatura)) {
    humedad     = -1;
    temperatura = -1;
    if (DHT_CONECTADO) Serial.println("[DHT22] Error de lectura");
  } else {
    historialHumedad[indiceHum] = humedad;
    indiceHum = (indiceHum + 1) % NUM_MUESTRAS_HUM;
    if (indiceHum == 0) bufferHumLleno = true;

    historialHumedadRapida[indiceHumRapido] = humedad;
    indiceHumRapido = (indiceHumRapido + 1) % NUM_MUESTRAS_HUM_RAPIDO;
  }

  // 2. MQ7 (CO): constantes de curva estándar del datasheet Plantower/Winsen para MQ7.
  // OJO: el "RO" (10.0 acá) es un valor genérico de ejemplo, no calibrado a tu
  // sensor puntual — igual sirve bien para el baseline dinámico relativo que
  // usamos, que no depende de un ppm absoluto exacto.
  float ppmCO  = leerPPM(MQ7_PIN,   10.0, 27.5, 99.042, -1.518);

  // 2.b MH-Z19C (CO2)
  int lecturaCO2 = myMHZ19.getCO2();
  if (myMHZ19.errorCode == RESULT_OK) {
    co2ppm = lecturaCO2;
  } else {
    Serial.printf("[MH-Z19C] Error de lectura, status: %d\n", myMHZ19.errorCode);
    // Se mantiene el último valor válido de co2ppm en vez de sobreescribir con error
  }

  bool  co_valido = ppmCO >= 0;
  bool  datosPmValidos = (pm1_0 != -1 && pm2_5 != -1 && pm10 != -1);
  bool  co2_valido = (co2ppm > 0);

  if (co_valido) {
    historialCO[indiceGases % 5] = ppmCO;
  }
  indiceGases++;

  // ── Baseline dinámico de CO, PM2.5 y CO2 (promedio "normal" de esta sala) ──
  // Calculamos cada baseline usando SOLO lo acumulado HASTA ANTES de esta
  // muestra, y decidimos si la muestra actual "parece normal" comparándola
  // contra ese baseline previo. Si alguno de los tres parece un pico, NINGUNO
  // de los tres se suma al histórico ese ciclo — así el promedio no se
  // "envenena" con el propio evento que estamos tratando de detectar.
  float basePrev7    = obtenerPromedio(historialBase7,    NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float basePrevPM   = obtenerPromedio(historialBasePM25, NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);
  float basePrevCO2  = obtenerPromedio(historialBaseCO2,  NUM_MUESTRAS_BASELINE, bufferBaseLleno, indiceBase);

  bool muestraNormal7   = !co_valido    || (basePrev7   <= 0) || (ppmCO  <= basePrev7  * 1.5);
  bool muestraNormalPM  = !datosPmValidos || (basePrevPM  <= 0) || (pm2_5  <= basePrevPM * 1.6);
  bool muestraNormalCO2 = !co2_valido  || (basePrevCO2 <= 0) || (co2ppm <= basePrevCO2 * 1.15);

  if (muestraNormal7 && muestraNormalPM && muestraNormalCO2) {
    if (co_valido)       historialBase7[indiceBase]    = ppmCO;
    if (datosPmValidos)  historialBasePM25[indiceBase] = pm2_5;
    if (co2_valido)      historialBaseCO2[indiceBase]  = co2ppm;
    indiceBase = (indiceBase + 1) % NUM_MUESTRAS_BASELINE;
    if (indiceBase == 0) bufferBaseLleno = true;
  }
  // Si alguna de las tres fue anómala, el índice/buffer de baseline no
  // avanza: seguimos comparando contra el último baseline "limpio" conocido.

  float base7   = basePrev7;
  float basePM  = basePrevPM;
  float baseCO2 = basePrevCO2;

  bool sensoresCalientes = (millis() - inicioSistema) > TIEMPO_CALENTAMIENTO_MS;

  // 3. Lógica de detección — evidencia combinada de varios sensores.
  // Primero decide "¿hay humo?" (cualquier señal alcanza), y después arma
  // un puntaje de evidencia para sugerir cuál podría ser — nunca 100%
  // seguro, es la mejor pista disponible con el hardware actual.
  bool  picoGas     = detectarPico(historialCO, 5);
  float promHum     = obtenerPromedioHumedad();

  // Salto de humedad — firma típica de vapor (DHT22, hoy desconectado)
  bool subidaHum = DHT_CONECTADO && (promHum > 0) && (humedad > promHum + 10.0);

  int idxViejo = (indiceHumRapido) % NUM_MUESTRAS_HUM_RAPIDO;
  float humRapidaVieja = historialHumedadRapida[idxViejo];
  bool  saltoHumRapido = DHT_CONECTADO && (humRapidaVieja > 0) && (humedad - humRapidaVieja > 6.0);
  bool  humedadDisparo  = subidaHum || saltoHumRapido;

  // CO (MQ7) — combustión real. La firma más específica que tenemos.
  bool subidaCO = co_valido && (base7 > 1.0) && (ppmCO > base7 * 1.6);

  // CO2 (MH-Z19C) — la combustión también consume O2 y suelta CO2, aunque
  // de forma más leve que el CO. Sirve como refuerzo, no como prueba sola
  // (el CO2 también sube solo por gente respirando en un cuarto cerrado).
  bool subidaCO2 = co2_valido && (baseCO2 > 50.0) && (co2ppm > baseCO2 * 1.15);

  // Partícula (PMS5003) — ahora usamos el PERFIL, no solo el nivel:
  //  - Nivel general: pm2_5 relativo a SU baseline de esta sala (evita
  //    falsos positivos/negativos en salas más o menos polvorientas).
  //  - Ratio PM1.0/PM2.5: aerosol fino y líquido (vape) da un ratio alto
  //    (~0.85+, las partículas evaporadas son casi todas del mismo tamaño
  //    chico). Humo de combustión (cigarrillo) da partículas de tamaños más
  //    variados, con PM10 despegándose más de PM2.5.
  float ratioPM1_25     = (datosPmValidos && pm2_5 > 0) ? (float)pm1_0 / pm2_5 : -1;
  bool  subidaPM         = datosPmValidos && (basePM > 3.0) && (pm2_5 > basePM * 1.6);
  bool  pmMuySaturado     = datosPmValidos && (pm2_5 > 150);      // humo denso encima del sensor
  bool  particulaFina    = datosPmValidos && (ratioPM1_25 > 0.85);
  bool  particulaAncha   = datosPmValidos && (pm10 > pm2_5 * 1.3) && (pm2_5 > 15);
  bool  particulaDisparo = subidaPM || pmMuySaturado;

  // ── ¿Hay humo? Cualquiera de estas señales ya cuenta como "hay algo" ────
  bool humoCrudo = sensoresCalientes &&
                   (subidaCO || subidaCO2 || humedadDisparo || particulaDisparo || picoGas);

  contadorHumo = humoCrudo ? contadorHumo + 1 : 0;
  bool humoConfirmado = contadorHumo >= MUESTRAS_CONFIRMACION;

  // ── ¿Cuál podría ser? Puntaje de evidencia, no una certeza ──────────────
  // Cada señal suma puntos a "combustión" (cigarrillo) o a "vapor" (vape).
  // El CO pesa más porque es la firma más específica que existe; el resto
  // son pistas de apoyo más débiles individualmente.
  int evidenciaCigarrillo = (subidaCO ? 2 : 0) + (particulaAncha ? 1 : 0) + (subidaCO2 ? 1 : 0);
  int evidenciaVape       = (particulaFina ? 2 : 0) + (humedadDisparo ? 2 : 0);

  String posibleCausa = "";
  if (evidenciaCigarrillo >= 2 && evidenciaCigarrillo > evidenciaVape) {
    posibleCausa = (evidenciaCigarrillo >= 3) ? "Cigarrillo, alta confianza" : "posible Cigarrillo";
  } else if (evidenciaVape >= 2 && evidenciaVape > evidenciaCigarrillo) {
    posibleCausa = (evidenciaVape >= 4) ? "Vape, alta confianza" : "posible Vape";
  }
  // Si ninguno de los dos junta suficiente evidencia clara, queda "" y el
  // mensaje final es un genérico "Humo detectado" — más honesto que forzar
  // una etiqueta sin sustento.

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

  // Invalidar PMS5003 si no responde en 10 segundos
  if (millis() - ultimoPMSRx > 10000) {
    pm1_0 = -1; pm2_5 = -1; pm10 = -1;
  }

  // 4. Empaquetar lectura
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

  Serial.printf("[%s] MQ7-CO:%.1f(Base:%.1f) | Hum:%.1f(Prom:%.1f) | PM1:%d PM2.5:%d(Base:%.1f) PM10:%d (ratio:%.2f) | CO2:%d(Base:%.1f) | EvidCig:%d EvidVape:%d | %s\n",
                lec.timestamp.c_str(), ppmCO, base7, humedad, promHum, pm1_0, pm2_5, basePM, pm10, ratioPM1_25, co2ppm, baseCO2, evidenciaCigarrillo, evidenciaVape, tipo.c_str());


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
  http.addHeader("x-device-key", DEVICE_API_KEY);
  http.setTimeout(3000);

  // [CORRECCIÓN 3] Aumentado a 450 para no desbordar con todos los campos (incluye CO2)
  StaticJsonDocument<450> doc;
  doc["dispositivoId"] = DISPOSITIVO_ID;
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
    pm1_0 = (buf[8]  << 8) | buf[9];
    pm2_5 = (buf[10] << 8) | buf[11];
    pm10  = (buf[12] << 8) | buf[13];

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

  // Guardas de cordura: si el voltaje está pegado a 0V o pegado a 3.3V,
  // no es una lectura real de gas — es un pin flotante/desconectado o un
  // cable en corto. Devolvemos -1 (inválido) en vez de dejar que la fórmula
  // explote matemáticamente (RS/RO cerca de 0 eleva A*ratio^B a números
  // absurdos tipo 3.6 cuatrillones, que rompen toda la lógica de detección).
  if (voltaje < 0.05 || voltaje > 3.20) return -1.0;

  float RS    = ((3.3 - voltaje) / voltaje) * RL;
  float ratio = RS / RO;
  float ppm   = A * pow(ratio, B);

  // Piso de seguridad extra: si por algún motivo igual da un número
  // desquiciado, lo recortamos en vez de propagarlo al resto del sistema.
  if (!isfinite(ppm) || ppm > 5000.0) return -1.0;

  return ppm;
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
