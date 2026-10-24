import type { FastifyReply } from 'fastify';
import { z } from 'zod';

/** Waliduje dane wejściowe; przy błędzie wysyła 400 i zwraca null. */
export function parse<T extends z.ZodType>(schema: T, data: unknown, reply: FastifyReply): z.infer<T> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.code(400).send({ error: 'Niepoprawne dane', details: z.flattenError(result.error).fieldErrors });
    return null;
  }
  return result.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const PAST_DUE_ERROR = 'Termin nie może być w przeszłości';

/** Termin w przeszłości (z 5-minutowym marginesem na czas wypełniania formularza). */
export const isPastDue = (d: Date) => d.getTime() < Date.now() - 5 * 60_000;

/** Pusty string z formularza traktujemy jak brak wartości. */
export const optionalText = (max = 10_000) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
