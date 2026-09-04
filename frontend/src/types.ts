// ─── Tipos compartidos del sistema VCDetection ──────────────────────────────

export interface Dispositivo {
  id: string;
  nombre: string;
  salon: string;
  online: boolean;
  ultimaConexion: string;
  totalLecturas?: number;
  totalAlertas?: number;
}

export interface Lectura {
  id?: string;
  dispositivoId: string;
  ppm135: number;
  ppm2: number;
  humoDetectado: boolean;
  tipo: string;
  picoSubito: boolean;
  temperatura: number;
  humedad: number;
  pm1: number;
  pm25: number;
  pm10: number;
  co2: number;
  timestamp: string;
  fecha?: string;
}

export interface Alerta {
  id: string;
  dispositivoId: string;
  tipo: 'VAPE_CONFIRMADO' | 'CIGARRILLO' | 'ALTA_CONFIANZA' | 'PM25_ALTO';
  mensaje: string;
  vista: boolean;
  fecha: string;
  dispositivo?: { nombre: string; salon: string };
}

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: string;
}

// Estado de color del salón basado en la última lectura
export type EstadoSalon = 'verde' | 'amarillo' | 'rojo' | 'offline';

export function calcularEstado(dispositivo: Dispositivo, lectura?: Lectura): EstadoSalon {
  if (!dispositivo.online) return 'offline';
  if (!lectura) return 'verde';

  const tipo = lectura.tipo.toLowerCase();
  if (tipo.includes('alta confianza') || tipo.includes('cigarrillo')) return 'rojo';
  if (tipo.includes('vape') || tipo.includes('pm2.5 alto') || tipo.includes('posible')) return 'amarillo';
  return 'verde';
}

export function tipoAlertaLabel(tipo: string): string {
  const map: Record<string, string> = {
    VAPE_CONFIRMADO: 'Vape Confirmado',
    CIGARRILLO: 'Cigarrillo / Combustión',
    ALTA_CONFIANZA: 'Detección Alta Confianza',
    PM25_ALTO: 'Nivel PM2.5 Elevado',
  };
  return map[tipo] || tipo;
}

export function tipoAlertaIcono(tipo: string): string {
  const map: Record<string, string> = {
    VAPE_CONFIRMADO: 'VP',
    CIGARRILLO: 'CG',
    ALTA_CONFIANZA: 'AC',
    PM25_ALTO: 'PM',
  };
  return map[tipo] || 'AL';
}

export function tipoAlertaClase(tipo: string): string {
  const map: Record<string, string> = {
    VAPE_CONFIRMADO: 'icono-vape',
    CIGARRILLO: 'icono-cig',
    ALTA_CONFIANZA: 'icono-alta',
    PM25_ALTO: 'icono-pm',
  };
  return map[tipo] || 'icono-vape';
}

export function formatTiempoRelativo(fecha: string): string {
  const diff = Date.now() - new Date(fecha).getTime();
  const seg = Math.floor(diff / 1000);
  if (seg < 60) return `hace ${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  return `hace ${h}h`;
}
