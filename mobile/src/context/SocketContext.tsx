import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL } from '../config';
import type { Lectura, Alerta, Dispositivo } from '../types';

interface SocketContextType {
  lecturas: Record<string, Lectura>;
  alertasNuevas: Alerta[];
  dispositivoUpdates: Record<string, Dispositivo>;
  limpiarAlertasNuevas: () => void;
}

const SocketContext = createContext<SocketContextType | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [lecturas, setLecturas] = useState<Record<string, Lectura>>({});
  const [alertasNuevas, setAlertasNuevas] = useState<Alerta[]>([]);
  const [dispositivoUpdates, setDispositivoUpdates] = useState<Record<string, Dispositivo>>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Conectar al servidor de WebSockets
    const socket = io(API_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Conectado al backend');
    });

    // Recibir lecturas en tiempo real
    socket.on('nueva-lectura', (lectura: Lectura) => {
      setLecturas(prev => ({ ...prev, [lectura.dispositivoId]: lectura }));
    });

    // Recibir alertas nuevas en tiempo real
    socket.on('nueva-alerta', (alerta: Alerta) => {
      setAlertasNuevas(prev => [alerta, ...prev]);
    });

    // Recibir actualizaciones de dispositivos (online/offline)
    socket.on('dispositivo-update', (disp: Dispositivo) => {
      setDispositivoUpdates(prev => ({ ...prev, [disp.id]: disp }));
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Desconectado');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const limpiarAlertasNuevas = useCallback(() => {
    setAlertasNuevas([]);
  }, []);

  return (
    <SocketContext.Provider value={{ lecturas, alertasNuevas, dispositivoUpdates, limpiarAlertasNuevas }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket debe usarse dentro de SocketProvider');
  return ctx;
}
