/**
 * Demo data for local development. It wipes and recreates the tables it uses.
 *
 * Test accounts (local only). All of them share the password in
 * SEED_PASSWORD, or "Mantenimiento2026*" when it is not set:
 *   admin@empresa.test        ADMINISTRADOR
 *   supervisor@empresa.test   SUPERVISOR
 *   operario1@empresa.test    OPERARIO
 *   operario2@empresa.test    OPERARIO
 */
import { PrismaClient, TipoServicio } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? 'Mantenimiento2026*';
const ZONA = process.env.ZONA_HORARIA ?? 'America/Bogota';

const dia = (fecha: Date) => new Date(`${fecha.toISOString().slice(0, 10)}T00:00:00.000Z`);

/** Monday of the current week, in the company's time zone. */
function lunesDeEstaSemana(): Date {
  const hoyLocal = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
  const hoy = new Date(`${hoyLocal}T00:00:00.000Z`);
  const diaSemana = (hoy.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(hoy.getTime() - diaSemana * 86_400_000);
}

async function main(): Promise<void> {
  // Children first (FK RESTRICT).
  await prisma.outboxEvento.deleteMany();
  await prisma.evidencia.deleteMany();
  await prisma.ejecucion.deleteMany();
  await prisma.asistencia.deleteMany();
  await prisma.programacion.deleteMany();
  await prisma.operario.deleteMany();
  await prisma.conjunto.deleteMany();
  await prisma.usuario.deleteMany();

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const admin = await prisma.usuario.create({
    data: { email: 'admin@empresa.test', nombre: 'Administrador General', rol: 'ADMINISTRADOR', passwordHash },
  });
  const supervisor = await prisma.usuario.create({
    data: { email: 'supervisor@empresa.test', nombre: 'Laura Supervisor', rol: 'SUPERVISOR', passwordHash },
  });

  const operarios = [];
  for (const [n, nombres, apellidos, documento] of [
    [1, 'Carlos', 'Ramirez', '1075000001'],
    [2, 'Diana', 'Torres', '1075000002'],
  ] as const) {
    const usuario = await prisma.usuario.create({
      data: { email: `operario${n}@empresa.test`, nombre: `${nombres} ${apellidos}`, rol: 'OPERARIO', passwordHash },
    });
    operarios.push(
      await prisma.operario.create({
        data: { usuarioId: usuario.id, documento, nombres, apellidos, telefono: `310000000${n}`, fechaIngreso: dia(new Date('2025-02-01')) },
      }),
    );
  }

  const almendros = await prisma.conjunto.create({
    data: {
      nombre: 'Conjunto Residencial Los Almendros',
      direccion: 'Calle 8 # 30-15',
      ciudad: 'Neiva',
      latitud: 2.936,
      longitud: -75.281,
      radioGeocercaMetros: 150,
    },
  });
  const ceibas = await prisma.conjunto.create({
    data: {
      nombre: 'Conjunto Las Ceibas',
      direccion: 'Carrera 52 # 20-40',
      ciudad: 'Neiva',
      latitud: 2.9505,
      longitud: -75.2905,
      radioGeocercaMetros: 120,
    },
  });

  const actividades: Array<[TipoServicio, string]> = [
    ['PISCINA', 'Limpieza y medicion de pH de la piscina'],
    ['JARDINERIA', 'Poda de setos de la entrada principal'],
    ['PINTURA', 'Pintura de muros del salon comunal'],
    ['JARDINERIA', 'Corte de cesped zonas verdes'],
    ['OTRO', 'Revision de luminarias de parqueadero'],
  ];

  const lunes = lunesDeEstaSemana();
  let total = 0;
  for (let d = 0; d < 5; d++) {
    const fecha = new Date(lunes.getTime() + d * 86_400_000);
    for (const [i, operario] of operarios.entries()) {
      const conjunto = i === 0 ? almendros : ceibas;
      for (const k of [0, 1]) {
        const [tipoServicio, actividad] = actividades[(d + i + k) % actividades.length];
        await prisma.programacion.create({
          data: {
            operarioId: operario.id,
            conjuntoId: conjunto.id,
            supervisorId: supervisor.id,
            creadoPorId: admin.id,
            semanaInicio: lunes,
            fecha,
            tipoServicio,
            actividad,
            estado: 'PUBLICADA',
            publicadaEn: new Date(),
          },
        });
        total++;
      }
    }
  }

  console.log(`Seed done: 4 users, 2 operators, 2 sites, ${total} scheduled activities (week of ${lunes.toISOString().slice(0, 10)}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
