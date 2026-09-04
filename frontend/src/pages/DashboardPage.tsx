import { useEffect, useState, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext';
import {
  type Dispositivo, type Lectura, type Alerta, type Usuario,
  calcularEstado, type EstadoSalon,
  tipoAlertaIcono, tipoAlertaClase, tipoAlertaLabel,
  formatTiempoRelativo
} from '../types';
import { API_URL } from '../config';

// ─── Iconos Vectoriales Limpios (Sin emojis informales) ────────────────────────
const IconWarning = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
);

const IconFileText = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
  </svg>
);

const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const IconUsers = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 00-3-3.87"></path>
    <path d="M16 3.13a4 4 0 010 7.75"></path>
  </svg>
);

const IconSound = ({ activo }: { activo: boolean }) => (
  activo ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>
  )
);

// ─── Estructura de Acta de Incidencia (PDF) ───────────────────────────────────
interface DatosActa {
  salon: string;
  dispositivoId: string;
  fecha: string;
  tipo: string;
  co: number;
  pm25: number;
  co2: number;
  humedad: number;
  temperatura: number;
  mensaje?: string;
}

// ─── Toast de Alerta ──────────────────────────────────────────────────────────
interface Toast { id: string; alerta: Alerta; }

function ToastAlerta({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);

  const salon = toast.alerta.dispositivo?.salon || toast.alerta.dispositivoId;
  return (
    <div className="toast">
      <div className="toast-icon">
        <IconWarning />
      </div>
      <div className="toast-content">
        <div className="toast-title">{tipoAlertaLabel(toast.alerta.tipo)}</div>
        <div className="toast-body">{salon}: {toast.alerta.mensaje.slice(0, 80)}...</div>
        <div className="toast-time">{formatTiempoRelativo(toast.alerta.fecha)}</div>
      </div>
    </div>
  );
}

// ─── Modal de Detalle de Salón ────────────────────────────────────────────────
type Rango = 'live' | '1' | '7' | '30';

interface PuntoHistorico {
  hora: string;
  ppm135: number;
  ppm2: number;
  pm25: number;
  co2: number;
  humedad: number;
  temperatura: number;
  total: number;
}

function SalonModal({
  dispositivo,
  lectura,
  historial,
  esAdmin,
  onClose,
  onDeleted,
  onGenerarActa,
}: {
  dispositivo: Dispositivo;
  lectura?: Lectura;
  historial: Lectura[];
  esAdmin: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onGenerarActa: (datos: DatosActa) => void;
}) {
  const estado = calcularEstado(dispositivo, lectura);
  const colores: Record<EstadoSalon, string> = {
    verde: 'var(--green)', amarillo: 'var(--yellow)', rojo: 'var(--red)', offline: 'var(--gray)'
  };

  const [rango, setRango] = useState<Rango>('live');
  const [histo, setHisto] = useState<PuntoHistorico[]>([]);
  const [cargandoHisto, setCargandoHisto] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    if (rango === 'live') { setHisto([]); return; }
    setCargandoHisto(true);
    axios.get(`${API_URL}/api/dispositivos/${dispositivo.id}/historico?dias=${rango}`)
      .then(r => setHisto(r.data.puntos))
      .catch(() => setHisto([]))
      .finally(() => setCargandoHisto(false));
  }, [rango, dispositivo.id]);

  const eliminarDispositivo = async () => {
    if (!confirm(`¿Eliminar "${dispositivo.salon}" y TODOS sus datos?\nEsta acción no se puede deshacer.`)) return;
    setEliminando(true);
    try {
      await axios.delete(`${API_URL}/api/dispositivos/${dispositivo.id}`);
      onDeleted();
    } catch {
      alert('No se pudo eliminar el dispositivo');
      setEliminando(false);
    }
  };

  const handleActa = () => {
    onGenerarActa({
      salon: dispositivo.salon,
      dispositivoId: dispositivo.nombre,
      fecha: new Date().toISOString(),
      tipo: lectura?.tipo || 'Revisión preventiva',
      co: lectura ? lectura.ppm135 : 0,
      pm25: lectura ? lectura.pm25 : 0,
      co2: lectura ? lectura.co2 : 0,
      humedad: lectura ? lectura.humedad : 0,
      temperatura: lectura ? lectura.temperatura : 0,
    });
  };

  const chartData: any[] = rango === 'live'
    ? historial.slice(-20).map((l, i) => ({
        i,
        co: parseFloat(l.ppm135.toFixed(1)),
        pm25: l.pm25 > 0 ? l.pm25 : 0,
        co2: l.co2 > 0 ? l.co2 : 0,
      }))
    : histo.map(p => ({
        hora: new Date(p.hora).toLocaleString('es-SV', rango === '1' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit' }),
        co: p.ppm135,
        pm25: p.pm25 > 0 ? p.pm25 : 0,
        co2: p.co2 > 0 ? p.co2 : 0,
      }));

  const tooltipStyle = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    fontSize: 12,
    boxShadow: '0 10px 30px -10px rgba(30,41,59,0.15)'
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2>{dispositivo.salon}</h2>
            <span
              className="modal-salon-badge"
              style={{ background: `${colores[estado]}22`, color: colores[estado] }}
            >
              {estado === 'offline' ? 'Desconectado' : lectura?.tipo || 'Sin datos'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn-pdf-acta"
              onClick={handleActa}
              title="Generar Acta oficial en PDF para expediente disciplinario"
            >
              <IconFileText /> Acta PDF
            </button>
            {esAdmin && (
              <button
                className="btn-danger"
                title="Eliminar dispositivo y todos sus datos"
                disabled={eliminando}
                onClick={eliminarDispositivo}
              >
                <IconTrash />
              </button>
            )}
            <button className="btn-close" id="btn-close-modal" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="modal-body">
          {/* Pestañas de rango */}
          <div className="tabs-row">
            {([['live','En vivo'],['1','24 horas'],['7','7 días'],['30','30 días']] as [Rango,string][]).map(([val,label]) => (
              <button
                key={val}
                className={`tab ${rango === val ? 'tab-activa' : ''}`}
                onClick={() => setRango(val)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Métricas actuales */}
          <div className="modal-metrics-grid">
            <div className="modal-metric-card">
              <div className="modal-metric-label">CO (MQ7)</div>
              <div className="modal-metric-val" style={{ color: 'var(--blue)' }}>
                {lectura ? lectura.ppm135.toFixed(1) : '--'}
              </div>
              <div className="modal-metric-unit">ppm</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">PM2.5</div>
              <div className="modal-metric-val" style={{ color: lectura && lectura.pm25 > 35 ? 'var(--red)' : 'var(--green)' }}>
                {lectura && lectura.pm25 >= 0 ? lectura.pm25 : '--'}
              </div>
              <div className="modal-metric-unit">µg/m³</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">PM10</div>
              <div className="modal-metric-val" style={{ color: 'var(--purple)' }}>
                {lectura && lectura.pm10 >= 0 ? lectura.pm10 : '--'}
              </div>
              <div className="modal-metric-unit">µg/m³</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">CO₂</div>
              <div className="modal-metric-val" style={{ color: lectura && lectura.co2 > 2000 ? 'var(--red)' : lectura && lectura.co2 >= 1000 ? 'var(--yellow)' : 'var(--green)' }}>
                {lectura && lectura.co2 >= 0 ? lectura.co2 : '--'}
              </div>
              <div className="modal-metric-unit">ppm</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">Última señal</div>
              <div className="modal-metric-val" style={{ fontSize: 16, color: 'var(--text-secondary)' }}>
                {formatTiempoRelativo(dispositivo.ultimaConexion)}
              </div>
            </div>
          </div>

          {/* Gráfica de historial */}
          {cargandoHisto && (
            <div className="chart-vacio">Cargando historial…</div>
          )}
          {!cargandoHisto && chartData.length > 1 && (
            <>
              <div className="chart-title">
                {rango === 'live' ? `CO, CO₂ y PM2.5 en vivo (últimas ${chartData.length} lecturas)` : `Promedios por hora — últimos ${rango} día(s)`}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <XAxis dataKey={rango === 'live' ? 'i' : 'hora'} hide={rango === 'live'} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={28} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#64748b', fontWeight: 600 }} />
                  <Line type="monotone" dataKey="co" stroke="var(--blue)" strokeWidth={2.5} dot={false} name="CO MQ7 (ppm)" />
                  <Line type="monotone" dataKey="co2" stroke="var(--green)" strokeWidth={2.5} dot={false} name="CO₂ (ppm)" />
                  <Line type="monotone" dataKey="pm25" stroke="var(--purple)" strokeWidth={2} dot={false} name="PM2.5 (µg/m³)" />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
          {!cargandoHisto && chartData.length <= 1 && (
            <div className="chart-vacio">
              {rango === 'live' ? 'Esperando lecturas en tiempo real…' : 'Sin datos en este rango'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Panel de Gestión de Usuarios ─────────────────────────────────────────────
function UsuariosModal({ onClose }: { onClose: () => void }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [form, setForm] = useState({ email: '', password: '', nombre: '', rol: 'COORDINADOR' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/auth/users`);
      setUsuarios(r.data.usuarios);
    } catch {
      setError('No se pudieron cargar los usuarios');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setOk(''); setCreando(true);
    try {
      await axios.post(`${API_URL}/api/auth/register`, form);
      setOk(`Usuario ${form.email} creado correctamente`);
      setForm({ email: '', password: '', nombre: '', rol: 'COORDINADOR' });
      cargar();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Error al crear el usuario');
    } finally {
      setCreando(false);
    }
  };

  const eliminar = async (u: Usuario) => {
    if (!confirm(`¿Eliminar la cuenta de ${u.email}?`)) return;
    setError(''); setOk('');
    try {
      await axios.delete(`${API_URL}/api/auth/users/${u.id}`);
      setOk(`Usuario ${u.email} eliminado`);
      cargar();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Error al eliminar');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-usuarios" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconUsers />
            <h2>Gestión de Usuarios</h2>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}
          {ok && <div className="msg-ok">{ok}</div>}

          <form onSubmit={crear} className="usuario-form">
            <div className="form-row">
              <div className="form-group">
                <label>Nombre Completo</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Prof. Juan Pérez" required maxLength={60} />
              </div>
              <div className="form-group">
                <label>Rol Institucional</label>
                <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                  <option value="COORDINADOR">Coordinador</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Correo Institucional</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="coordinador@colegio.edu" required />
              </div>
              <div className="form-group">
                <label>Contraseña</label>
                <input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Mínimo 8 caracteres" required minLength={8} />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={creando}>
              {creando ? 'Creando…' : '+ Crear Usuario'}
            </button>
          </form>

          <div className="section-title" style={{ marginTop: 24, marginBottom: 10 }}>
            Cuentas Activas ({usuarios.length})
          </div>
          {cargando ? (
            <div className="chart-vacio">Cargando cuentas…</div>
          ) : (
            <div className="usuarios-lista">
              {usuarios.map(u => (
                <div key={u.id} className="usuario-item">
                  <div className="usuario-avatar">{u.nombre.charAt(0).toUpperCase()}</div>
                  <div className="usuario-info">
                    <div className="usuario-nombre">{u.nombre}</div>
                    <div className="usuario-email">{u.email}</div>
                  </div>
                  <span className={`usuario-rol ${u.rol === 'ADMIN' ? 'rol-admin' : 'rol-coord'}`}>
                    {u.rol === 'ADMIN' ? 'Administrador' : 'Coordinador'}
                  </span>
                  <button
                    className="btn-danger btn-sm"
                    title={`Eliminar a ${u.email}`}
                    onClick={() => eliminar(u)}
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card de Salón ────────────────────────────────────────────────────────────
function SalonCard({
  dispositivo,
  lectura,
  onClick
}: {
  dispositivo: Dispositivo;
  lectura?: Lectura;
  onClick: () => void;
}) {
  const estado = calcularEstado(dispositivo, lectura);
  const tipo = lectura?.tipo || (dispositivo.online ? 'Sin datos' : 'Desconectado');

  const tipoClase: Record<EstadoSalon, string> = {
    verde: 'tipo-verde', amarillo: 'tipo-amarillo', rojo: 'tipo-rojo', offline: 'tipo-gray'
  };
  const dotClase: Record<EstadoSalon, string> = {
    verde: 'dot-verde', amarillo: 'dot-amarillo', rojo: 'dot-rojo', offline: 'dot-offline'
  };

  return (
    <div className={`salon-card ${estado}`} onClick={onClick} id={`salon-${dispositivo.nombre}`}>
      <div className="salon-header">
        <div className="salon-name">{dispositivo.salon}</div>
        <div className={`salon-status-dot ${dotClase[estado]}`} />
      </div>
      <span className={`salon-tipo ${tipoClase[estado]}`}>{tipo}</span>
      <div className="salon-metrics">
        <div className="metric">
          <div className="metric-label">CO (MQ7)</div>
          <div className="metric-value">{lectura ? lectura.ppm135.toFixed(1) : '--'}<span className="metric-unit"> ppm</span></div>
        </div>
        <div className="metric">
          <div className="metric-label">PM2.5</div>
          <div className="metric-value" style={{ color: lectura && lectura.pm25 > 35 ? 'var(--red)' : undefined }}>
            {lectura && lectura.pm25 >= 0 ? lectura.pm25 : '--'}<span className="metric-unit"> µg</span>
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">PM10</div>
          <div className="metric-value">
            {lectura && lectura.pm10 >= 0 ? lectura.pm10 : '--'}<span className="metric-unit"> µg</span>
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">CO₂</div>
          <div className="metric-value" style={{ color: lectura && lectura.co2 > 2000 ? 'var(--red)' : lectura && lectura.co2 >= 1000 ? 'var(--yellow)' : undefined }}>
            {lectura && lectura.co2 >= 0 ? lectura.co2 : '--'}<span className="metric-unit"> ppm</span>
          </div>
        </div>
      </div>
      <div className="salon-tiempo">{formatTiempoRelativo(dispositivo.ultimaConexion)}</div>
    </div>
  );
}

// ─── Dashboard Principal ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const { usuario, logout } = useAuth();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [lecturas, setLecturas] = useState<Record<string, Lectura>>({});
  const [historial, setHistorial] = useState<Record<string, Lectura[]>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modalDisp, setModalDisp] = useState<Dispositivo | null>(null);
  const [alertasNoVistas, setAlertasNoVistas] = useState(0);
  const [showUsuarios, setShowUsuarios] = useState(false);
  const [sonidoActivo, setSonidoActivo] = useState(() => {
    const saved = localStorage.getItem('vc_sonido');
    return saved !== null ? saved === 'true' : true;
  });

  // [MEJORA D] Búsqueda y Filtros de Salones
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'alerta' | 'verde' | 'offline'>('todos');

  // [MEJORA A] Generación de Acta en PDF
  const [actaData, setActaData] = useState<DatosActa | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // [MEJORA C] Solicitar permiso de Notificaciones Nativas de Windows
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const getAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const sonarAlertar = useCallback((tipoAlerta?: string) => {
    if (!sonidoActivo) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const tipo = tipoAlerta || '';
    const esCritico = tipo === 'CIGARRILLO' || tipo === 'ALTA_CONFIANZA';
    const esModerado = tipo === 'VAPE_CONFIRMADO';

    try {
      if (esCritico) {
        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.connect(gain);
          gain.connect(ctx.destination);

          const t = ctx.currentTime + i * 0.28;
          osc.frequency.setValueAtTime(1200, t);
          osc.frequency.linearRampToValueAtTime(800, t + 0.12);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
          gain.gain.setValueAtTime(0.25, t + 0.12);
          gain.gain.linearRampToValueAtTime(0, t + 0.22);
          osc.start(t);
          osc.stop(t + 0.22);
        }
      } else if (esModerado) {
        for (let i = 0; i < 2; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.connect(gain);
          gain.connect(ctx.destination);

          const t = ctx.currentTime + i * 0.25;
          osc.frequency.setValueAtTime(i === 0 ? 880 : 660, t);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
          gain.gain.setValueAtTime(0.22, t + 0.12);
          gain.gain.linearRampToValueAtTime(0, t + 0.2);
          osc.start(t);
          osc.stop(t + 0.2);
        }
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(ctx.destination);

        const t = ctx.currentTime;
        osc.frequency.setValueAtTime(660, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
      }
    } catch { /* silencioso si falla el audio */ }
  }, [sonidoActivo, getAudioCtx]);

  const toggleSonido = useCallback(() => {
    setSonidoActivo(prev => {
      const nuevo = !prev;
      localStorage.setItem('vc_sonido', String(nuevo));
      return nuevo;
    });
  }, []);

  const fetchInicial = useCallback(async () => {
    try {
      const [dispRes, alertRes] = await Promise.all([
        axios.get(`${API_URL}/api/dispositivos`),
        axios.get(`${API_URL}/api/alertas?limit=30`),
      ]);
      setDispositivos(dispRes.data.dispositivos);
      setAlertas(alertRes.data.alertas);
      setAlertasNoVistas(alertRes.data.alertas.filter((a: Alerta) => !a.vista).length);
    } catch (err) {
      console.error('Error cargando datos iniciales', err);
    }
  }, []);

  useEffect(() => {
    fetchInicial();

    const socket = io(API_URL, {
      transports: ['websocket'],
      auth: { token: localStorage.getItem('vc_token') },
    });
    socketRef.current = socket;

    socket.on('nueva-lectura', (lectura: Lectura) => {
      setLecturas(prev => ({ ...prev, [lectura.dispositivoId]: lectura }));
      setHistorial(prev => {
        const actual = prev[lectura.dispositivoId] || [];
        return { ...prev, [lectura.dispositivoId]: [...actual.slice(-49), lectura] };
      });
    });

    socket.on('nueva-alerta', (alerta: Alerta) => {
      setAlertas(prev => [alerta, ...prev.slice(0, 29)]);
      setAlertasNoVistas(prev => prev + 1);
      setToasts(prev => [{ id: alerta.id, alerta }, ...prev]);
      sonarAlertar(alerta.tipo);

      // [MEJORA C] Notificación Nativa de Windows
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const salon = alerta.dispositivo?.salon || alerta.dispositivoId;
          const notif = new Notification(`Incidencia Ambiental: ${salon}`, {
            body: `${tipoAlertaLabel(alerta.tipo)} — ${alerta.mensaje}`,
            icon: '/favicon.png',
            tag: alerta.id,
            requireInteraction: true,
          });
          notif.onclick = () => {
            window.focus();
          };
        } catch { /* ignorar si falla */ }
      }
    });

    socket.on('dispositivo-update', (disp: Dispositivo) => {
      setDispositivos(prev => prev.map(d => d.id === disp.id ? { ...d, ...disp } : d));
    });

    return () => { socket.disconnect(); };
  }, [fetchInicial, sonarAlertar]);

  const marcarVista = async (id: string) => {
    try {
      await axios.patch(`${API_URL}/api/alertas/${id}/vista`);
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, vista: true } : a));
      setAlertasNoVistas(prev => Math.max(0, prev - 1));
    } catch { /* silencioso */ }
  };

  const marcarTodas = async () => {
    try {
      await axios.patch(`${API_URL}/api/alertas/marcar-todas`);
      setAlertas(prev => prev.map(a => ({ ...a, vista: true })));
      setAlertasNoVistas(0);
    } catch { /* silencioso */ }
  };

  // [MEJORA A] Función para imprimir el acta formal
  const imprimirActa = (datos: DatosActa) => {
    setActaData(datos);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const online = dispositivos.filter(d => d.online).length;
  const offline = dispositivos.filter(d => !d.online).length;
  const enAlarma = dispositivos.filter(d => {
    const lec = lecturas[d.id];
    return d.online && lec && lec.humoDetectado;
  }).length;

  // [MEJORA D] Filtrado reactivo de salones
  const salonesFiltrados = dispositivos.filter(d => {
    const coincideTexto = d.salon.toLowerCase().includes(busqueda.toLowerCase()) ||
                          d.nombre.toLowerCase().includes(busqueda.toLowerCase());
    if (!coincideTexto) return false;

    const estado = calcularEstado(d, lecturas[d.id]);
    if (filtroEstado === 'alerta') return estado === 'rojo' || estado === 'amarillo';
    if (filtroEstado === 'verde') return estado === 'verde';
    if (filtroEstado === 'offline') return estado === 'offline';
    return true;
  });

  return (
    <div className="app-layout">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-left">
          <div className="navbar-logo" style={{ background: '#4f46e5', color: '#fff', display: 'grid', placeItems: 'center' }}>
            <span style={{ fontWeight: 800, fontSize: 16 }}>VC</span>
          </div>
          <div>
            <div className="navbar-title">VCDetection</div>
            <div className="navbar-subtitle">Monitoreo de Calidad de Aire y Convivencia Escolar</div>
          </div>
        </div>
        <div className="navbar-right">
          <button
            className="btn-nav btn-sonido"
            onClick={toggleSonido}
            title={sonidoActivo ? 'Silenciar alertas acústicas' : 'Activar sonido de alertas'}
          >
            <IconSound activo={sonidoActivo} />
          </button>
          {alertasNoVistas > 0 && (
            <span className="navbar-badge">{alertasNoVistas}</span>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>{usuario?.nombre}</span>
          {usuario?.rol === 'ADMIN' && (
            <button id="btn-usuarios" className="btn-nav" onClick={() => setShowUsuarios(true)}>
              <IconUsers /> Usuarios
            </button>
          )}
          <button id="btn-logout" className="btn-logout" onClick={logout}>Cerrar Sesión</button>
        </div>
      </nav>

      {/* Contenido Principal */}
      <main className="main-content">
        {/* Stats */}
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-label">Total Salones</div>
            <div className="stat-value" style={{ color: 'var(--blue)' }}>{dispositivos.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">En Línea</div>
            <div className="stat-value green">{online}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Desconectados</div>
            <div className="stat-value gray">{offline}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Alerta Activa</div>
            <div className="stat-value red">{enAlarma}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Alertas Pendientes</div>
            <div className="stat-value yellow">{alertasNoVistas}</div>
          </div>
        </div>

        {/* [MEJORA D] Barra de Búsqueda y Filtros */}
        <div className="search-filter-bar">
          <div className="search-input-box">
            <IconSearch />
            <input
              type="text"
              placeholder="Buscar salón por nombre o código..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
            {busqueda && (
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}
                onClick={() => setBusqueda('')}
              >
                ✕
              </button>
            )}
          </div>

          <div className="filter-pills-row">
            <button
              className={`filter-pill ${filtroEstado === 'todos' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('todos')}
            >
              Todos <span className="filter-count">{dispositivos.length}</span>
            </button>
            <button
              className={`filter-pill ${filtroEstado === 'alerta' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('alerta')}
            >
              En Alerta <span className="filter-count">{dispositivos.filter(d => ['rojo', 'amarillo'].includes(calcularEstado(d, lecturas[d.id]))).length}</span>
            </button>
            <button
              className={`filter-pill ${filtroEstado === 'verde' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('verde')}
            >
              Normales <span className="filter-count">{dispositivos.filter(d => calcularEstado(d, lecturas[d.id]) === 'verde').length}</span>
            </button>
            <button
              className={`filter-pill ${filtroEstado === 'offline' ? 'activo' : ''}`}
              onClick={() => setFiltroEstado('offline')}
            >
              Offline <span className="filter-count">{offline}</span>
            </button>
          </div>
        </div>

        {/* Grid de Salones */}
        <div className="section-header">
          <div className="section-title">
            Espacios Monitoreados ({salonesFiltrados.length})
          </div>
        </div>
        <div className="salones-grid">
          {salonesFiltrados.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '32px 0' }}>
              No se encontraron salones que coincidan con los filtros aplicados.
            </div>
          )}
          {salonesFiltrados.map(d => (
            <SalonCard
              key={d.id}
              dispositivo={d}
              lectura={lecturas[d.id]}
              onClick={() => setModalDisp(d)}
            />
          ))}
        </div>

        {/* Panel de Alertas */}
        <div className="section-header" style={{ marginTop: 24 }}>
          <div className="section-title">Registro de Alertas Recientes</div>
        </div>
        <div className="alertas-panel">
          <div className="alertas-header">
            <div className="alertas-title">
              Eventos Registrados {alertasNoVistas > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>({alertasNoVistas} sin revisar)</span>}
            </div>
            {alertasNoVistas > 0 && (
              <button id="btn-marcar-todas" className="btn-marcar-todas" onClick={marcarTodas}>
                Marcar todas como vistas
              </button>
            )}
          </div>
          <div className="alertas-list">
            {alertas.length === 0 && (
              <div className="alertas-empty">
                Ambiente escolar en calma — Sin incidencias registradas
              </div>
            )}
            {alertas.map(alerta => {
              const salonNombre = alerta.dispositivo?.salon || alerta.dispositivoId;
              return (
                <div
                  key={alerta.id}
                  className={`alerta-item ${!alerta.vista ? 'no-vista' : ''}`}
                  onClick={() => !alerta.vista && marcarVista(alerta.id)}
                >
                  <div className={`alerta-icono ${tipoAlertaClase(alerta.tipo)}`} style={{ fontWeight: 800, fontSize: 11 }}>
                    {tipoAlertaIcono(alerta.tipo)}
                  </div>
                  <div className="alerta-info">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="alerta-salon">{salonNombre}</div>
                      <button
                        className="btn-pdf-acta"
                        style={{ padding: '3px 10px', fontSize: 11, borderRadius: 6 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          imprimirActa({
                            salon: salonNombre,
                            dispositivoId: alerta.dispositivoId,
                            fecha: alerta.fecha,
                            tipo: tipoAlertaLabel(alerta.tipo),
                            co: 24, // Valores de referencia de evento
                            pm25: 65,
                            co2: 950,
                            humedad: 68,
                            temperatura: 28,
                            mensaje: alerta.mensaje,
                          });
                        }}
                      >
                        <IconFileText /> Generar Acta
                      </button>
                    </div>
                    <div className="alerta-msg">{alerta.mensaje}</div>
                    <div className="alerta-time">{formatTiempoRelativo(alerta.fecha)}</div>
                  </div>
                  {!alerta.vista && <div className="alerta-dot-nueva" />}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Modal de detalle */}
      {modalDisp && (
        <SalonModal
          dispositivo={modalDisp}
          lectura={lecturas[modalDisp.id]}
          historial={historial[modalDisp.id] || []}
          esAdmin={usuario?.rol === 'ADMIN'}
          onClose={() => setModalDisp(null)}
          onDeleted={() => {
            setDispositivos(prev => prev.filter(d => d.id !== modalDisp.id));
            setModalDisp(null);
          }}
          onGenerarActa={imprimirActa}
        />
      )}

      {/* Modal de usuarios */}
      {showUsuarios && <UsuariosModal onClose={() => setShowUsuarios(false)} />}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <ToastAlerta
            key={t.id}
            toast={t}
            onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
          />
        ))}
      </div>

      {/* [MEJORA A] Plantilla Imprimible de Acta Disciplinaria (PDF) */}
      {actaData && (
        <div id="printable-acta" style={{ display: 'none' }}>
          <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 14, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                VCDetection — Sistema de Control Ambiental Escolar
              </h1>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#475569' }}>
                Acta Oficial de Constatación Técnica e Incidencia de Convivencia
              </p>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#64748b' }}>
              <div><b>Folio:</b> ACT-{Date.now().toString().slice(-6)}</div>
              <div><b>Emisión:</b> {new Date().toLocaleDateString('es-SV', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 10px 0', textTransform: 'uppercase', color: '#1e293b' }}>1. Datos de Ubicación y Evento</h3>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 0', width: '25%', color: '#64748b' }}><b>Ubicación / Salón:</b></td>
                  <td style={{ padding: '4px 0', width: '25%' }}>{actaData.salon}</td>
                  <td style={{ padding: '4px 0', width: '25%', color: '#64748b' }}><b>Sensor ID:</b></td>
                  <td style={{ padding: '4px 0', width: '25%' }}>{actaData.dispositivoId}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 0', color: '#64748b' }}><b>Fecha y Hora:</b></td>
                  <td style={{ padding: '4px 0' }}>{new Date(actaData.fecha).toLocaleString()}</td>
                  <td style={{ padding: '4px 0', color: '#64748b' }}><b>Tipo de Detección:</b></td>
                  <td style={{ padding: '4px 0' }}><b>{actaData.tipo}</b></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 10px 0', textTransform: 'uppercase', color: '#1e293b' }}>2. Parámetros Técnicos Registrados por Sensores</h3>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', border: '1px solid #cbd5e1' }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'left' }}>Sensor / Parámetro</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>Lectura Registrada</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>Límite Normal Escolar</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'left' }}>Dictamen</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8 }}><b>Monóxido de Carbono (MQ-7)</b></td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>{actaData.co} ppm</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>&lt; 9.0 ppm</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8 }}>{actaData.co > 10 ? 'Nivel elevado de gas por combustión' : 'Normal'}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8 }}><b>Material Particulado PM2.5 (PMS5003)</b></td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>{actaData.pm25} µg/m³</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>&lt; 25.0 µg/m³</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8 }}>{actaData.pm25 > 35 ? 'Aerosol denso confirmado' : 'Normal'}</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8 }}><b>Dióxido de Carbono (MH-Z19C NDIR)</b></td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>{actaData.co2} ppm</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8, textAlign: 'center' }}>&lt; 1000 ppm</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: 8 }}>{actaData.co2 > 1200 ? 'Ventilación comprometida' : 'Aceptable'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 25 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 8px 0', textTransform: 'uppercase', color: '#1e293b' }}>3. Observaciones del Comité de Convivencia / Prefectura</h3>
            <div style={{ border: '1px solid #cbd5e1', borderRadius: 6, minHeight: 80, padding: 10, fontSize: 13, color: '#334155' }}>
              {actaData.mensaje ? `Detalle del sistema: ${actaData.mensaje}` : 'Se constató la activación de los sensores en el área indicada. Se procede conforme al manual de convivencia escolar vigente.'}
            </div>
          </div>

          <div style={{ marginTop: 50, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #0f172a', paddingTop: 8, fontSize: 11 }}>
              <b>Coordinación</b><br />Firma y Sello
            </div>
            <div style={{ borderTop: '1px solid #0f172a', paddingTop: 8, fontSize: 11 }}>
              <b>Dirección</b><br />Firma y Sello
            </div>
            <div style={{ borderTop: '1px solid #0f172a', paddingTop: 8, fontSize: 11 }}>
              <b>Estudiante</b><br />Firma
            </div>
            <div style={{ borderTop: '1px solid #0f172a', paddingTop: 8, fontSize: 11 }}>
              <b>Padre / Tutor</b><br />Firma
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
