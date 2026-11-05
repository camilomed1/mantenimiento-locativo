import { Injectable } from '@nestjs/common';
import { Reloj } from '../domain/reloj';

@Injectable()
export class RelojSistema implements Reloj {
  ahora(): Date {
    return new Date();
  }
}
