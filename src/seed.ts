import { prisma } from "./db";
import bcrypt from "bcrypt";

async function main() {
  const email = "admin@vcdetection.com";
  const password = "admin123";
  const nombre = "Administrador Principal";

  const existente = await prisma.usuario.findUnique({
    where: { email },
  });

  if (existente) {
    console.log("El usuario administrador ya existe en la base de datos.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.usuario.create({
    data: {
      email,
      password: passwordHash,
      nombre,
      rol: "ADMIN",
    },
  });

  console.log("=========================================");
  console.log("✅ Usuario administrador creado con éxito!");
  console.log(`📧 Email: ${email}`);
  console.log(`🔑 Password: ${password}`);
  console.log("=========================================");
}

main()
  .catch((e) => {
    console.error("Error al sembrar la base de datos:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
