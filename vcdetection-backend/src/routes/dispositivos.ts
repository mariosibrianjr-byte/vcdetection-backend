import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// Todas las rutas de dispositivos requieren autenticación
router.use(authMiddleware);

/**
 * GET /api/dispositivos
 * Listar todos los dispositivos con su estado online/offline.
 * El estado online se calcula en tiempo real (offline si > 30s sin datos).
 */
router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const dispositivos = await prisma.dispositivo.findMany({
      orderBy: { nombre: "asc" },
      include: {
        _count: {
          select: {
            lecturas: true,
            alertas: true,
          },
        },
      },
    });

    const ahora = new Date();
    const OFFLINE_THRESHOLD_MS = 30 * 1000; // 30 segundos

    // Calcular estado online en tiempo real y actualizar si cambió
    const dispositivosConEstado = dispositivos.map((d) => {
      const diffMs = ahora.getTime() - d.ultimaConexion.getTime();
      const estaOnline = diffMs <= OFFLINE_THRESHOLD_MS;

      return {
        id: d.id,
        nombre: d.nombre,
        salon: d.salon,
        online: estaOnline,
        ultimaConexion: d.ultimaConexion,
        totalLecturas: d._count.lecturas,
        totalAlertas: d._count.alertas,
      };
    });

    // Actualizar en DB los que cambiaron de estado (batch update)
    const cambios = dispositivos.filter((d) => {
      const diffMs = ahora.getTime() - d.ultimaConexion.getTime();
      const estaOnline = diffMs <= OFFLINE_THRESHOLD_MS;
      return d.online !== estaOnline;
    });

    if (cambios.length > 0) {
      await Promise.all(
        cambios.map((d) => {
          const diffMs = ahora.getTime() - d.ultimaConexion.getTime();
          const estaOnline = diffMs <= OFFLINE_THRESHOLD_MS;
          return prisma.dispositivo.update({
            where: { id: d.id },
            data: { online: estaOnline },
          });
        })
      );
    }

    res.json({
      ok: true,
      dispositivos: dispositivosConEstado,
      resumen: {
        total: dispositivosConEstado.length,
        online: dispositivosConEstado.filter((d) => d.online).length,
        offline: dispositivosConEstado.filter((d) => !d.online).length,
      },
    });
  } catch (error) {
    console.error("[DISPOSITIVOS] Error listando:", error);
    res.status(500).json({ error: "Error interno al listar dispositivos" });
  }
});

/**
 * GET /api/dispositivos/:id
 * Detalle de un dispositivo con sus últimas lecturas.
 */
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const dispositivo = await prisma.dispositivo.findUnique({
      where: { id },
      include: {
        lecturas: {
          orderBy: { fecha: "desc" },
          take: 50, // Últimas 50 lecturas
        },
        alertas: {
          orderBy: { fecha: "desc" },
          take: 10, // Últimas 10 alertas
        },
        _count: {
          select: {
            lecturas: true,
            alertas: true,
          },
        },
      },
    });

    if (!dispositivo) {
      res.status(404).json({ error: "Dispositivo no encontrado" });
      return;
    }

    // Calcular estado online
    const ahora = new Date();
    const diffMs = ahora.getTime() - dispositivo.ultimaConexion.getTime();
    const estaOnline = diffMs <= 30 * 1000;

    res.json({
      ok: true,
      dispositivo: {
        ...dispositivo,
        online: estaOnline,
      },
    });
  } catch (error) {
    console.error("[DISPOSITIVOS] Error obteniendo detalle:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

/**
 * PATCH /api/dispositivos/:id
 * Actualizar nombre/salón de un dispositivo.
 */
router.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { salon, nombre } = req.body;

    const dataUpdate: any = {};
    if (salon) dataUpdate.salon = salon;
    if (nombre) dataUpdate.nombre = nombre;

    if (Object.keys(dataUpdate).length === 0) {
      res.status(400).json({ error: "Debe enviar al menos salon o nombre" });
      return;
    }

    const dispositivo = await prisma.dispositivo.update({
      where: { id },
      data: dataUpdate,
    });

    res.json({ ok: true, dispositivo });
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Dispositivo no encontrado" });
      return;
    }
    console.error("[DISPOSITIVOS] Error actualizando:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
