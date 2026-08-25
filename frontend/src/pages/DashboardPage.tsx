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
      <div className="toast-icon">{tipoAlertaIcono(toast.alerta.tipo)}</div>
      <div className="toast-content">
        <div className="toast-title">⚠️ {tipoAlertaLabel(toast.alerta.tipo)}</div>
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
  onDeleted
}: {
  dispositivo: Dispositivo;
  lectura?: Lectura;
  historial: Lectura[];
  esAdmin: boolean;
  onClose: () => void;
  onDeleted: () => void;
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2>{dispositivo.salon}</h2>
            <span
              className="modal-salon-badge"
              style={{ background: `${colores[estado]}22`, color: colores[estado] }}
            >
              {estado === 'offline' ? '● Offline' : lectura?.tipo || 'Sin datos'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {esAdmin && (
              <button
                className="btn-danger"
                title="Eliminar dispositivo y todos sus datos"
                disabled={eliminando}
                onClick={eliminarDispositivo}
              >
                🗑
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
      setOk(`✅ Usuario ${form.email} creado correctamente`);
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
          <h2>👥 Gestión de usuarios</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="login-error">{error}</div>}
          {ok && <div className="msg-ok">{ok}</div>}

          <form onSubmit={crear} className="usuario-form">
            <div className="form-row">
              <div className="form-group">
                <label>Nombre</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="María Pérez" required maxLength={60} />
              </div>
              <div className="form-group">
                <label>Rol</label>
                <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                  <option value="COORDINADOR">Coordinador</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Correo electrónico</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="usuario@colegio.edu" required />
              </div>
              <div className="form-group">
                <label>Contraseña</label>
                <input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Mínimo 8 caracteres" required minLength={8} />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={creando}>
              {creando ? 'Creando…' : '+ Crear usuario'}
            </button>
          </form>

          <div className="section-title" style={{ marginTop: 24, marginBottom: 10 }}>
            Cuentas existentes ({usuarios.length})
          </div>
          {cargando ? (
            <div className="chart-vacio">Cargando…</div>
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
                    🗑
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
  const tipo = lectura?.tipo || (dispositivo.online ? 'Sin datos' : 'Offline');

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
  const socketRef = useRef<Socket | null>(null);

  const sonarAlertar = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* silencioso si no hay contexto de audio */ }
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
      sonarAlertar();
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

  const online = dispositivos.filter(d => d.online).length;
  const offline = dispositivos.filter(d => !d.online).length;
  const enAlarma = dispositivos.filter(d => {
    const lec = lecturas[d.id];
    return d.online && lec && lec.humoDetectado;
  }).length;

  return (
    <div className="app-layout">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-left">
          <div className="navbar-logo">🔍</div>
          <div>
            <div className="navbar-title">VCDetection</div>
            <div className="navbar-subtitle">Panel de Control Encubierto</div>
          </div>
        </div>
        <div className="navbar-right">
          {alertasNoVistas > 0 && (
            <span className="navbar-badge">🔔 {alertasNoVistas}</span>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{usuario?.nombre}</span>
          {usuario?.rol === 'ADMIN' && (
            <button id="btn-usuarios" className="btn-nav" onClick={() => setShowUsuarios(true)}>
              👥 Usuarios
            </button>
          )}
          <button id="btn-logout" className="btn-logout" onClick={logout}>Salir</button>
        </div>
      </nav>

      {/* Contenido */}
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
            <div className="stat-label">Offline</div>
            <div className="stat-value gray">{offline}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">⚠️ En Alarma</div>
            <div className="stat-value red">{enAlarma}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Alertas sin ver</div>
            <div className="stat-value yellow">{alertasNoVistas}</div>
          </div>
        </div>

        {/* Grid de Salones */}
        <div className="section-header">
          <div className="section-title">Salones ({dispositivos.length})</div>
        </div>
        <div className="salones-grid">
          {dispositivos.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '32px 0' }}>
              Esperando dispositivos... Asegurate de que el ESP32 esté enviando datos.
            </div>
          )}
          {dispositivos.map(d => (
            <SalonCard
              key={d.id}
              dispositivo={d}
              lectura={lecturas[d.id]}
              onClick={() => setModalDisp(d)}
            />
          ))}
        </div>

        {/* Panel de Alertas */}
        <div className="section-header" style={{ marginTop: 8 }}>
          <div className="section-title">Alertas Recientes</div>
        </div>
        <div className="alertas-panel">
          <div className="alertas-header">
            <div className="alertas-title">
              Últimas alertas {alertasNoVistas > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>({alertasNoVistas} nuevas)</span>}
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
                ✅ Sin alertas — todo en orden
              </div>
            )}
            {alertas.map(alerta => (
              <div
                key={alerta.id}
                className={`alerta-item ${!alerta.vista ? 'no-vista' : ''}`}
                onClick={() => !alerta.vista && marcarVista(alerta.id)}
              >
                <div className={`alerta-icono ${tipoAlertaClase(alerta.tipo)}`}>
                  {tipoAlertaIcono(alerta.tipo)}
                </div>
                <div className="alerta-info">
                  <div className="alerta-salon">{alerta.dispositivo?.salon || alerta.dispositivoId}</div>
                  <div className="alerta-msg">{alerta.mensaje}</div>
                  <div className="alerta-time">{formatTiempoRelativo(alerta.fecha)}</div>
                </div>
                {!alerta.vista && <div className="alerta-dot-nueva" />}
              </div>
            ))}
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
    </div>
  );
}
