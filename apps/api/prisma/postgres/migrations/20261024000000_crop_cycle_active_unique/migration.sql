-- Parity with the SQLite chain (20261024000000): one ACTIVE crop cycle per
-- plot, enforced by the database instead of a count-then-create race.
CREATE UNIQUE INDEX IF NOT EXISTS "CropCycle_plot_id_active_key" ON "CropCycle"("plotId") WHERE status = 'ACTIVE';
