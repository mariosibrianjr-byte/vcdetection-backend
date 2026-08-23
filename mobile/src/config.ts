// ─── Configuración de la App Móvil VCDetection ──────────────────────────────

// URL del backend — apuntando al servidor de producción en Render
export const API_URL = 'https://vcdetection-backend.onrender.com';

// ─── Paleta Blanco Pastel (idéntica al frontend de PC / index.css) ──────────
export const COLORS = {
  // Backgrounds
  bg:          '#f8f9fd',
  bgSecondary: '#f4f6fb',
  card:        '#ffffff',
  cardHover:   '#fafbff',

  // Borders
  border:      '#eef1f8',
  borderLight: '#dde3f0',

  // Typography
  textPrimary:   '#1e293b',
  textSecondary: '#64748b',
  textMuted:     '#94a3b8',

  // Acentos pastel
  green:      '#10b981',
  greenSoft:  '#ecfdf5',
  yellow:     '#d97706',
  yellowSoft: '#fffbeb',
  red:        '#f43f5e',
  redSoft:    '#fff1f2',
  gray:       '#94a3b8',
  graySoft:   '#f4f6fb',
  blue:       '#0ea5e9',
  blueSoft:   '#eff8ff',
  purple:     '#8b5cf6',
  purpleSoft: '#f5f3ff',
  indigo:     '#4f46e5',

  // Colores de los puntos de estado (como los dots de la PC)
  dotVerde:    '#34d399',
  dotAmarillo: '#fbbf24',
  dotRojo:     '#fb7185',
  dotOffline:  '#cbd5e1',

  // Degradado principal (logo, botones, avatares)
  gradPrimary: ['#a78bfa', '#60a5fa', '#34d399'] as const,
};

// Tipografía
export const FONT = {
  regular: 'System',
  bold:    'System',
  mono:    'monospace',
};
