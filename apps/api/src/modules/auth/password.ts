import bcrypt from "bcryptjs";
import { isTest } from "../../config/env.js";

/**
 * Login timing equalisation.
 *
 * The login handler must not reveal whether a phone number exists. Before this
 * helper an unknown phone skipped bcrypt entirely and returned 401 in
 * microseconds while a wrong password paid a full bcrypt comparison — a
 * measurable oracle for user enumeration. The unknown-phone path now runs one
 * bcrypt comparison too, against a module-level dummy hash computed once at
 * module load, so both paths spend the same work before the identical 401.
 *
 * The dummy hash uses the same bcrypt cost as the real hashes in this
 * environment (12 in production/staging; the test profile hashes at cost 4 for
 * speed) so the comparison is indistinguishable from a real one *wherever*
 * this code runs.
 */
const DUMMY_PASSWORD_SOURCE = "agrobridge-dummy-password-timing-equalizer";
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(DUMMY_PASSWORD_SOURCE, isTest ? 4 : 12);

/**
 * Verifies `password` against `hash`, or against the dummy hash when `hash` is
 * null (unknown user). Always performs exactly one bcrypt comparison — no
 * early return before it — and returns false for the null-hash case even if
 * the dummy comparison happens to succeed.
 */
export async function verifyPasswordAgainst(hash: string | null, password: string): Promise<boolean> {
  const candidate = hash ?? DUMMY_PASSWORD_HASH;
  const matches = await bcrypt.compare(password, candidate);
  return hash !== null && matches;
}
