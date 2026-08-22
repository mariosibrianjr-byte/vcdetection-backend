import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { authMiddleware } from "../middleware/auth";

const router = Router();

/**
 * POST /api/auth/register
 * Crear un nuevo usuario administrador.
 *
 * Seguridad:
 * - Si NO existe ningún usuario en la BD, el registro queda abierto
 *   una sola vez para crear el primer admin (bootstrap).
 * - Después, solo un usuario con rol ADMIN autenticado puede crear cuentas.
 */
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, nombre, rol } = req.body;

    if (!email || !password || !nombre) {
      res.status(400).json({ error: "email, password y nombre son requeridos" });
      return;
    }

    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
      return;
    }

    const totalUsuarios = await prisma.usuario.count();
    const esBootstrap = totalUsuarios === 0;

    if (!esBootstrap) {
      // Ya existen usuarios: exigir token de ADMIN válido
      authMiddleware(req, res, async () => {
        if (!req.user || req.user.rol !== "ADMIN") {
          res.status(403).json({
            error: "Solo un administrador puede crear nuevas cuentas",
          });
          return;
        }
        await crearUsuario(req.body, res);
      });
      return;
    }

    await crearUsuario(req.body, res);
  } catch (error) {
    console.error("[AUTH] Error en registro:", error);
    res.status(500).json({ error: "Error interno al registrar usuario" });
  }
});

/**
 * Lógica compartida de creación de usuario + emisión de JWT.
 */
async function crearUsuario(
  body: { email?: string; password?: string; nombre?: string; rol?: string },
  res: Response
): Promise<void> {
  try {
    const email = body.email!.toLowerCase().trim();
    const nombre = body.nombre!.trim();

    // Verificar que el email no exista
    const existente = await prisma.usuario.findUnique({
      where: { email },
    });

    if (existente) {
      res.status(409).json({ error: "Ya existe un usuario con ese email" });
      return;
    }

    // Hash del password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(body.password!, saltRounds);

    // Crear usuario
    const usuario = await prisma.usuario.create({
      data: {
        email,
        password: passwordHash,
        nombre,
        rol: body.rol === "COORDINADOR" ? "COORDINADOR" : "ADMIN",
      },
    });

    // Generar JWT
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: "JWT_SECRET no configurado" });
      return;
    }

    const token = jwt.sign(
      { userId: usuario.id, email: usuario.email, rol: usuario.rol },
      secret,
      { expiresIn: "7d" }
    );

    console.log(`[AUTH] Usuario creado: ${usuario.email} (${usuario.rol})`);

    res.status(201).json({
      ok: true,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
      },
      token,
    });
  } catch (error) {
    console.error("[AUTH] Error creando usuario:", error);
    res.status(500).json({ error: "Error interno al registrar usuario" });
  }
}

/**
 * POST /api/auth/login
 * Login con email y password, retorna JWT.
 */
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "email y password son requeridos" });
      return;
    }

    // Buscar usuario
    const usuario = await prisma.usuario.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!usuario) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    // Verificar password
    const passwordValido = await bcrypt.compare(password, usuario.password);
    if (!passwordValido) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    // Generar JWT
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: "JWT_SECRET no configurado" });
      return;
    }

    const token = jwt.sign(
      { userId: usuario.id, email: usuario.email, rol: usuario.rol },
      secret,
      { expiresIn: "7d" }
    );

    res.json({
      ok: true,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
      },
      token,
    });
  } catch (error) {
    console.error("[AUTH] Error en login:", error);
    res.status(500).json({ error: "Error interno al iniciar sesión" });
  }
});

/**
 * PATCH /api/auth/fcm-token
 * Actualizar token FCM del usuario autenticado.
 */
router.patch(
  "/fcm-token",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { tokenFCM } = req.body;

      if (!tokenFCM) {
        res.status(400).json({ error: "tokenFCM es requerido" });
        return;
      }

      await prisma.usuario.update({
        where: { id: req.user!.userId },
        data: { tokenFCM },
      });

      res.json({ ok: true, mensaje: "Token FCM actualizado" });
    } catch (error) {
      console.error("[AUTH] Error actualizando token FCM:", error);
      res.status(500).json({ error: "Error interno al actualizar token FCM" });
    }
  }
);

/**
 * GET /api/auth/me
 * Obtener datos del usuario autenticado.
 */
router.get(
  "/me",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const usuario = await prisma.usuario.findUnique({
        where: { id: req.user!.userId },
        select: {
          id: true,
          email: true,
          nombre: true,
          rol: true,
          createdAt: true,
        },
      });

      if (!usuario) {
        res.status(404).json({ error: "Usuario no encontrado" });
        return;
      }

      res.json({ ok: true, usuario });
    } catch (error) {
      console.error("[AUTH] Error en /me:", error);
      res.status(500).json({ error: "Error interno" });
    }
  }
);

export default router;
