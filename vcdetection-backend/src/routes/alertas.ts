import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// Todas las rutas de alertas requieren autenticación
router.use(authMiddleware);

/**
 * GET /api/alertas
 * Listar alertas con paginación y filtros opcionales.
 * Query params:
 *   - page (default: 1)
 *   - limit (default: 20, max: 100)
 *   - vista (true/false — filtrar por vistas/no vistas)
 *   - tipo (VAPE_CONFIRMADO, CIGARRILLO, ALTA_CONFIANZA, PM25_ALTO)
 *   - dispositivoId (filtrar por dispositivo)
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    // Construir filtros
    const where: any = {};

    if (req.query.vista !== undefined) {
      where.vista = req.query.vista === "true";
    }

    if (req.query.tipo) {
      where.tipo = req.query.tipo as string;
    }

    if (req.query.dispositivoId) {
      where.dispositivoId = req.query.dispositivoId as string;
    }

    // Consultar alertas con información del dispositivo
    const [alertas, total] = await Promise.all([
      prisma.alerta.findMany({
        where,
        include: {
          dispositivo: {
            select: {
              nombre: true,
              salon: true,
            },
          },
        },
        orderBy: { fecha: "desc" },
        skip,
        take: limit,
      }),
      prisma.alerta.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      ok: true,
      alertas,
      paginacion: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("[ALERTAS] Error listando alertas:", error);
    res.status(500).json({ error: "Error interno al listar alertas" });
  }
});

/**
 * GET /api/alertas/resumen
 * Resumen rápido: total no vistas, por tipo, últimas 24h.
 */
router.get("/resumen", async (_req: Request, res: Response): Promise<void> => {
  try {
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [noVistas, ultimas24h, porTipo] = await Promise.all([
      prisma.alerta.count({ where: { vista: false } }),
      prisma.alerta.count({ where: { fecha: { gte: hace24h } } }),
      prisma.alerta.groupBy({
        by: ["tipo"],
        _count: true,
        where: { fecha: { gte: hace24h } },
      }),
    ]);

    res.json({
      ok: true,
      resumen: {
        noVistas,
        ultimas24h,
        porTipo: porTipo.map((g) => ({
          tipo: g.tipo,
          cantidad: g._count,
        })),
      },
    });
  } catch (error) {
    console.error("[ALERTAS] Error en resumen:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

/**
 * PATCH /api/alertas/:id/vista
 * Marcar una alerta como vista.
 */
router.patch("/:id/vista", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const alerta = await prisma.alerta.update({
      where: { id },
      data: { vista: true },
    });

    res.json({ ok: true, alerta });
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Alerta no encontrada" });
      return;
    }
    console.error("[ALERTAS] Error marcando alerta como vista:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

/**
 * PATCH /api/alertas/marcar-todas
 * Marcar todas las alertas no vistas como vistas.
 */
router.patch("/marcar-todas", async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.alerta.updateMany({
      where: { vista: false },
      data: { vista: true },
    });

    res.json({
      ok: true,
      marcadas: result.count,
    });
  } catch (error) {
    console.error("[ALERTAS] Error marcando todas:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
