import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext';
import {
  type Dispositivo, type Lectura, type Alerta,
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
function SalonModal({
  dispositivo,
  lectura,
  historial,
  onClose
}: {
  dispositivo: Dispositivo;
  lectura?: Lectura;
  historial: Lectura[];
  onClose: () => void;
}) {
  const estado = calcularEstado(dispositivo, lectura);
  const colores: Record<EstadoSalon, string> = {
    verde: 'var(--green)', amarillo: 'var(--yellow)', rojo: 'var(--red)', offline: 'var(--gray)'
  };

  const chartData = historial.slice(-20).map((l, i) => ({
    i,
    mq135: parseFloat(l.ppm135.toFixed(1)),
    mq2: parseFloat(l.ppm2.toFixed(1)),
    hum: parseFloat(l.humedad.toFixed(1)),
    pm25: l.pm25 > 0 ? l.pm25 : 0,
    co2: l.co2 > 0 ? l.co2 : 0,
  }));

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
          <button className="btn-close" id="btn-close-modal" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Métricas actuales */}
          <div className="modal-metrics-grid">
            <div className="modal-metric-card">
              <div className="modal-metric-label">MQ135</div>
              <div className="modal-metric-val" style={{ color: 'var(--blue)' }}>
                {lectura ? lectura.ppm135.toFixed(1) : '--'}
              </div>
              <div className="modal-metric-unit">ppm</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">MQ2</div>
              <div className="modal-metric-val" style={{ color: 'var(--purple)' }}>
                {lectura ? lectura.ppm2.toFixed(1) : '--'}
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
              <div className="modal-metric-label">CO₂</div>
              <div className="modal-metric-val" style={{ color: lectura && lectura.co2 > 2000 ? 'var(--red)' : lectura && lectura.co2 >= 1000 ? 'var(--yellow)' : 'var(--green)' }}>
                {lectura && lectura.co2 >= 0 ? lectura.co2 : '--'}
              </div>
              <div className="modal-metric-unit">ppm</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">Temperatura</div>
              <div className="modal-metric-val" style={{ color: 'var(--yellow)' }}>
                {lectura ? lectura.temperatura.toFixed(1) : '--'}
              </div>
              <div className="modal-metric-unit">°C</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">Humedad</div>
              <div className="modal-metric-val" style={{ color: 'var(--blue)' }}>
                {lectura ? lectura.humedad.toFixed(1) : '--'}
              </div>
              <div className="modal-metric-unit">%</div>
            </div>
            <div className="modal-metric-card">
              <div className="modal-metric-label">Última señal</div>
              <div className="modal-metric-val" style={{ fontSize: 16, color: 'var(--text-secondary)' }}>
                {formatTiempoRelativo(dispositivo.ultimaConexion)}
              </div>
            </div>
          </div>

          {/* Gráfica de historial */}
          {chartData.length > 1 && (
            <>
              <div className="chart-title">Historial Gases (últimas {chartData.length} lecturas)</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: '#4d6380', fontSize: 11 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="monotone" dataKey="mq135" stroke="var(--blue)" strokeWidth={2} dot={false} name="MQ135 ppm" />
                  <Line type="monotone" dataKey="mq2" stroke="var(--purple)" strokeWidth={2} dot={false} name="MQ2 ppm" />
                  <Line type="monotone" dataKey="co2" stroke="var(--green)" strokeWidth={2} dot={false} name="CO2 ppm" yAxisId="right" />
                </LineChart>
              </ResponsiveContainer>

              <div className="chart-title" style={{ marginTop: 20 }}>Humedad (%)</div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={chartData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: '#4d6380', fontSize: 11 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="monotone" dataKey="hum" stroke="var(--purple)" strokeWidth={2} dot={false} name="Humedad %" />
                </LineChart>
              </ResponsiveContainer>
            </>
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
          <div className="metric-label">MQ135</div>
          <div className="metric-value">{lectura ? lectura.ppm135.toFixed(1) : '--'}<span className="metric-unit"> ppm</span></div>
        </div>
        <div className="metric">
          <div className="metric-label">MQ2</div>
          <div className="metric-value">{lectura ? lectura.ppm2.toFixed(1) : '--'}<span className="metric-unit"> ppm</span></div>
        </div>
        <div className="metric">
          <div className="metric-label">Humedad</div>
          <div className="metric-value">{lectura ? lectura.humedad.toFixed(0) : '--'}<span className="metric-unit"> %</span></div>
        </div>
        <div className="metric">
          <div className="metric-label">Temp</div>
          <div className="metric-value">{lectura ? lectura.temperatura.toFixed(1) : '--'}<span className="metric-unit"> °C</span></div>
        </div>
        <div className="metric">
          <div className="metric-label">PM2.5</div>
          <div className="metric-value" style={{ color: lectura && lectura.pm25 > 35 ? 'var(--red)' : undefined }}>
            {lectura && lectura.pm25 >= 0 ? lectura.pm25 : '--'}<span className="metric-unit"> µg</span>
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">CO2</div>
          <div className="metric-value" style={{ color: lectura && lectura.co2 > 1000 ? 'var(--red)' : undefined }}>
            {lectura && lectura.co2 >= 0 ? lectura.co2 : '--'}<span className="metric-unit"> ppm</span>
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

    const socket = io(API_URL, { transports: ['websocket'] });
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
          onClose={() => setModalDisp(null)}
        />
      )}

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
