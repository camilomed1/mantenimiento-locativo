import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AsistenciaModule } from './modules/asistencia/asistencia.module';
import { AgendaModule } from './modules/agenda/agenda.controller';
import { EjecucionModule } from './modules/ejecucion/ejecucion.module';
import { MonitoreoModule } from './modules/monitoreo/monitoreo';
import { AuthModule } from './shared/auth/auth.module';
import { HealthController } from './shared/health/health.controller';
import { InfraestructuraModule } from './shared/infrastructure/infraestructura.module';
import { OutboxRelayService } from './shared/infrastructure/outbox/outbox-relay.service';

/**
 * Modular monolith: one deployable, independent business modules.
 * Modules never import each other; they talk through ports and domain events.
 */
@Module({
  imports: [
    // Loads backend/.env when running on the host; Docker passes real env vars.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    InfraestructuraModule,
    AuthModule,
    // Selected modules
    AsistenciaModule,
    EjecucionModule,
    // Support modules needed to demo them
    AgendaModule,
    MonitoreoModule,
  ],
  controllers: [HealthController],
  providers: [OutboxRelayService],
})
export class AppModule {}
