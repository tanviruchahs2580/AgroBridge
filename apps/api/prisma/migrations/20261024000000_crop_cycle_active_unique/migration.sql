-- AUD-V3: one ACTIVE crop cycle per plot, enforced by the database. The
-- count-then-create race let two concurrent POST /crops both see zero ACTIVE
-- cycles and create two. Prisma cannot express partial unique indexes, so this
-- lives here only — the same pattern as Payment_user_purpose_pending_key.
CREATE UNIQUE INDEX IF NOT EXISTS "CropCycle_plot_id_active_key" ON "CropCycle"("plotId") WHERE status = 'ACTIVE';
