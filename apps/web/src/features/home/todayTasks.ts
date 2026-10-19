// "Today's tasks" on Home are REAL suggestions derived from the user's active
// crop cycles (stage + planting date), using the same care logic MyFarm shows.
// Nothing here is persisted, pre-seeded or checked off — the API has no task
// completion write (see), so the UI must not pretend one exists. With no
// active crop the list is empty and Home renders an honest empty state.
import type { FarmListItem } from "../../lib/api-types";
import type { Lang } from "../../lib/i18n";
import { farmCareSuggestion } from "../../lib/labels";
import type { CareSuggestion } from "../../lib/labels";

export interface TodayTask {
  id: string;
  cropName: string;
  stage: string;
  plantedAt: string;
  farmName: string;
  plotName: string;
  care: CareSuggestion;
}

/** Up to `limit` care suggestions from the user's ACTIVE crop cycles, in farm order. */
export function deriveTodayTasks(farms: FarmListItem[], lang: Lang, limit = 3): TodayTask[] {
  const tasks: TodayTask[] = [];
  for (const farm of farms) {
    for (const plot of farm.plots) {
      for (const cycle of plot.cropCycles) {
        if (cycle.status !== "ACTIVE") continue;
        tasks.push({
          id: cycle.id,
          cropName: cycle.cropName,
          stage: cycle.stage,
          plantedAt: cycle.plantedAt,
          farmName: farm.name,
          plotName: plot.name,
          care: farmCareSuggestion(cycle, lang),
        });
        if (tasks.length >= limit) return tasks;
      }
    }
  }
  return tasks;
}
