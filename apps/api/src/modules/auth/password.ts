import { bcryptCompare } from "./bcryptPool.js";

/**
 * Login timing equalisation (B-05), delegated to the bcrypt worker pool.
 *
 * The login handler must not reveal whether a phone number exists. Before this
 * helper an unknown phone skipped bcrypt entirely and returned 401 in
 * microseconds while a wrong password paid a full bcrypt comparison — a
 * measurable oracle for user enumeration. Both paths now run exactly one
 * comparison at the same cost: a real hash when there is one, the pool's dummy
 * hash when there is not.
 *
 * The work moved into the worker pool (F-02 from the 10k-concurrency audit):
 * 100 simultaneous logins used to pin the event loop at cost 12 for 77 seconds
 * while unrelated requests waited up to 74 s. The timing property is preserved
 * rather than weakened — both paths go through the same pool, and the pool
 * substitutes its own cost-matched dummy for a null hash, so the cost factor and
 * the single comparison are unchanged. The `hashSync(..., 12)` that used to run
 * here at module load is gone: it blocked every cold start (F-11), and the dummy
 * value it produced is now computed inside the workers.
 *
 * A null hash must be passed through as null (never substituted here): the pool
 * is the single place that knows the configured cost, and a locally-built dummy
 * would be compared at whatever cost this module happened to guess.
 */
export async function verifyPasswordAgainst(hash: string | null, password: string): Promise<boolean> {
  return bcryptCompare(password, hash);
}

/**
 * Whether a stored hash was written at a cheaper factor than the one configured
 * now — the trigger for the transparent upgrade on login (F-02 option c).
 *
 * Reads the cost field out of the hash itself rather than trusting the row, so a
 * mixed table (users who logged in since the change, users who have not) needs no
 * column and no migration. Only a LOWER cost triggers an upgrade: a hash stored at
 * a higher factor is stronger than today's configuration, and "upgrading" it would
 * weaken it. A malformed hash deliberately returns false — the login that follows
 * simply compares at the stored value and fails, instead of a parser bug rewriting
 * credential material.
 */
export function storedHashIsCheaper(hash: string, configuredCost: number): boolean {
  const cost = /^\$2[abxy]\$(\d{2})\$/.exec(hash)?.[1];
  return cost !== undefined && Number(cost) < configuredCost;
}
