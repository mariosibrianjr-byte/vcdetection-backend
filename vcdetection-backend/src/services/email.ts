import { Resend } from "resend";
import { prisma } from "../db";

let resendClient: Resend | null = null;

/**
 * Inicializa el cliente de Resend para envío de emails.
 */
export function initEmail(): void {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[EMAIL] RESEND_API_KEY no configurada. Emails deshabilitados.");
    return;
  }
  resendClient = new Resend(apiKey);
  console.log("[EMAIL] Resend inicializado");
}

/**
 * Envía email de alerta a todos los usuarios registrados.
 */
export async function enviarEmailAlerta(data: {
  salon: string;
  tipo: string;
  mensaje: string;
  timestamp: string;
}): Promise<void> {
  if (!resendClient) {
    console.warn("[EMAIL] Resend no inicializado, email omitido");
    return;
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  try {
    // Obtener emails de todos los usuarios
    const usuarios = await prisma.usuario.findMany({
      select: { email: true, nombre: true },
    });

    if (usuarios.length === 0) {
      console.log("[EMAIL] No hay usuarios registrados para enviar email");
      return;
    }

    const emailsDestinatarios = usuarios.map((u) => u.email);

    // Mapear tipo de alerta a emoji y color
    const tipoConfig: Record<string, { emoji: string; color: string }> = {
      VAPE_CONFIRMADO: { emoji: "🌫️", color: "#e67e22" },
      CIGARRILLO: { emoji: "🚬", color: "#e74c3c" },
      ALTA_CONFIANZA: { emoji: "🚨", color: "#c0392b" },
      PM25_ALTO: { emoji: "💨", color: "#9b59b6" },
    };

    const config = tipoConfig[data.tipo] || { emoji: "⚠️", color: "#e74c3c" };
    const tipoLegible = data.tipo.replace(/_/g, " ");

    const htmlContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #eee; border-radius: 12px; overflow: hidden;">
        <div style="background: ${config.color}; padding: 24px 32px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px; color: white;">
            ${config.emoji} ALERTA VCDetection
          </h1>
        </div>
        <div style="padding: 32px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #333; color: #888;">Tipo</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #333; font-weight: bold; color: ${config.color};">${tipoLegible}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #333; color: #888;">Salón</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #333; font-weight: bold;">${data.salon}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #333; color: #888;">Mensaje</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #333;">${data.mensaje}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #888;">Hora</td>
              <td style="padding: 12px 0;">${data.timestamp}</td>
            </tr>
          </table>
          <p style="margin-top: 24px; padding: 16px; background: #16213e; border-radius: 8px; border-left: 4px solid ${config.color}; font-size: 14px;">
            Este es un mensaje automático del sistema VCDetection. 
            Por favor, tome las medidas necesarias.
          </p>
        </div>
        <div style="padding: 16px 32px; background: #0f0f23; text-align: center; font-size: 12px; color: #666;">
          VCDetection — Sistema de Detección Encubierta
        </div>
      </div>
    `;

    await resendClient.emails.send({
      from: fromEmail,
      to: emailsDestinatarios,
      subject: `${config.emoji} Alerta ${tipoLegible} — ${data.salon}`,
      html: htmlContent,
    });

    console.log(
      `[EMAIL] Alerta enviada a ${emailsDestinatarios.length} destinatario(s)`
    );
  } catch (error) {
    console.error("[EMAIL] Error enviando email:", error);
  }
}
