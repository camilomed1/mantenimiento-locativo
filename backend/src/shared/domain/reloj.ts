/** Output port for the server clock, so time-dependent rules are testable. */
export interface Reloj {
  ahora(): Date;
}

export const RELOJ = Symbol('Reloj');
