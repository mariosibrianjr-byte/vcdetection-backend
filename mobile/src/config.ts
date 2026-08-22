// ─── Configuración de la App Móvil VCDetection ──────────────────────────────

// URL del backend — apuntando al servidor de producción en Render
// (Ya no dependemos de la IP local, funciona en cualquier red WiFi o datos móviles)
export const API_URL = 'https://vcdetection-backend.onrender.com';

// ─── Paleta Premium ──────────────────────────────────────────────────────────
export const COLORS = {
  // Backgrounds
  bg:          '#050a15',
  bgCard:      'rgba(15, 23, 42, 0.75)',
  bgGlass:     'rgba(15, 23, 42, 0.55)',
  bgInput:     'rgba(8, 15, 30, 0.9)',
  bgElevated:  '#0c1527',
  bgHeader:    '#0a1128',

  // Gradient layers (simulate gradient with overlapping Views)
  gradientTop:    '#06091a',
  gradientBottom: '#0a1a2e',

  // Borders
  border:      'rgba(30, 58, 95, 0.5)',
  borderLight: 'rgba(56, 97, 150, 0.35)',
  borderGlass: 'rgba(100, 150, 220, 0.15)',

  // Typography
  textPrimary:   '#f0f6ff',
  textSecondary: '#8ba3c7',
  textMuted:     '#4a6080',

  // Accent — Cyan
  cyan:       '#06b6d4',
  cyanGlow:   'rgba(6, 182, 212, 0.15)',
  cyanDim:    'rgba(6, 182, 212, 0.08)',

  // Accent — Purple
  purple:     '#8b5cf6',
  purpleGlow: 'rgba(139, 92, 246, 0.15)',
  purpleDim:  'rgba(139, 92, 246, 0.08)',

  // Accent — Emerald / Green
  green:      '#10b981',
  greenGlow:  'rgba(16, 185, 129, 0.15)',
  greenDim:   'rgba(16, 185, 129, 0.08)',

  // Accent — Amber
  amber:      '#f59e0b',
  amberGlow:  'rgba(245, 158, 11, 0.15)',
  amberDim:   'rgba(245, 158, 11, 0.08)',

  // Accent — Rose / Red
  rose:       '#f43f5e',
  roseGlow:   'rgba(244, 63, 94, 0.15)',
  roseDim:    'rgba(244, 63, 94, 0.08)',

  // Legacy aliases
  red:        '#f43f5e',
  redGlow:    'rgba(244, 63, 94, 0.15)',
  yellow:     '#f59e0b',
  yellowGlow: 'rgba(245, 158, 11, 0.15)',
  blue:       '#3b82f6',
  blueGlow:   'rgba(59, 130, 246, 0.15)',
  gray:       '#475569',

  // CO2 thresholds
  co2Normal:  '#10b981',
  co2Warning: '#f59e0b',
  co2Danger:  '#f43f5e',
};

// Tipografía
export const FONT = {
  regular: 'System',
  bold:    'System',
  mono:    'monospace',
};
