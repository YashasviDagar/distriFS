import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@distrifs.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN" },
    create: { email, passwordHash, role: "ADMIN" },
  });

  console.log(`Seeded admin user: ${admin.email} (role ${admin.role})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log("Using default admin password 'admin12345'. Set SEED_ADMIN_PASSWORD to override.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
