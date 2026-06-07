import type {
  RunningSummary,
  StravaActivity,
  StravaActivityPreview,
  TrainingContext,
  WeeklyRunningLoadRow,
} from "./database.js";
import { toPreview } from "./database.js";

function isValidDateString(value: string | null): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function getDate(value: string): Date {
  return new Date(value);
}

function getIsoWeekLabel(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function sortByDateDesc(left: StravaActivity, right: StravaActivity): number {
  const leftTime = left.start_date_local ? getDate(left.start_date_local).getTime() : Number.NEGATIVE_INFINITY;
  const rightTime = right.start_date_local ? getDate(right.start_date_local).getTime() : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

function validRuns(rows: StravaActivity[]): StravaActivity[] {
  return rows.filter((row) => isValidDateString(row.start_date_local));
}

function invalidDateNotes(rows: StravaActivity[]): string[] {
  const invalidCount = rows.length - validRuns(rows).length;
  return invalidCount > 0 ? [`Skipped ${invalidCount} result(s) with invalid start_date_local values.`] : [];
}

export function previewActivity(activity: StravaActivity): StravaActivityPreview {
  return toPreview(activity);
}

export function summarizeRunningRows(rows: StravaActivity[]): RunningSummary {
  const valid = validRuns(rows).sort(sortByDateDesc);
  const notes = invalidDateNotes(rows);

  if (valid.length === 0) {
    if (rows.length === 0) {
      notes.push("No runs were found in the requested period.");
    }

    return {
      date_range: { start: null, end: null },
      run_count: 0,
      total_miles: 0,
      total_moving_time_hours: 0,
      average_pace_min_per_mi: null,
      average_heart_rate: null,
      max_heart_rate: null,
      total_elevation_gain_ft: 0,
      average_distance_mi: null,
      longest_run: null,
      notes,
    };
  }

  const totalMiles = valid.reduce((sum, row) => sum + (row.distance_mi ?? 0), 0);
  const totalMovingTimeSec = valid.reduce((sum, row) => sum + (row.moving_time_sec ?? 0), 0);
  const heartrateValues = valid
    .map((row) => row.average_heartrate)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const maxHeartrateValues = valid
    .map((row) => row.max_heartrate)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const totalElevation = valid.reduce((sum, row) => sum + (row.elevation_gain_ft ?? 0), 0);
  const longestRun = valid.reduce<StravaActivity | null>((current, row) => {
    if (!current) {
      return row;
    }

    const currentDistance = current.distance_mi ?? Number.NEGATIVE_INFINITY;
    const nextDistance = row.distance_mi ?? Number.NEGATIVE_INFINITY;
    return nextDistance > currentDistance ? row : current;
  }, null);

  return {
    date_range: {
      start: valid[valid.length - 1]?.start_date_local ?? null,
      end: valid[0]?.start_date_local ?? null,
    },
    run_count: valid.length,
    total_miles: totalMiles,
    total_moving_time_hours: totalMovingTimeSec / 3600,
    average_pace_min_per_mi: totalMiles > 0 ? (totalMovingTimeSec / 60) / totalMiles : null,
    average_heart_rate: heartrateValues.length > 0 ? heartrateValues.reduce((sum, value) => sum + value, 0) / heartrateValues.length : null,
    max_heart_rate: maxHeartrateValues.length > 0 ? Math.max(...maxHeartrateValues) : null,
    total_elevation_gain_ft: totalElevation,
    average_distance_mi: valid.length > 0 ? totalMiles / valid.length : null,
    longest_run: longestRun ? previewActivity(longestRun) : null,
    notes,
  };
}

export function groupWeeklyRunningLoad(rows: StravaActivity[]): WeeklyRunningLoadRow[] {
  const valid = validRuns(rows);
  const buckets = new Map<string, StravaActivity[]>();

  for (const row of valid) {
    const week = getIsoWeekLabel(new Date(row.start_date_local!));
    const existing = buckets.get(week) ?? [];
    existing.push(row);
    buckets.set(week, existing);
  }

  return Array.from(buckets.entries())
    .map(([week, weekRows]) => {
      const totalMiles = weekRows.reduce((sum, row) => sum + (row.distance_mi ?? 0), 0);
      const totalMovingTimeSec = weekRows.reduce((sum, row) => sum + (row.moving_time_sec ?? 0), 0);
      const heartrateValues = weekRows
        .map((row) => row.average_heartrate)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

      return {
        week,
        run_count: weekRows.length,
        total_miles: totalMiles,
        total_hours: totalMovingTimeSec / 3600,
        avg_pace_min_per_mi: totalMiles > 0 ? (totalMovingTimeSec / 60) / totalMiles : null,
        avg_heart_rate: heartrateValues.length > 0 ? heartrateValues.reduce((sum, value) => sum + value, 0) / heartrateValues.length : null,
        total_elevation_ft: weekRows.reduce((sum, row) => sum + (row.elevation_gain_ft ?? 0), 0),
      };
    })
    .sort((left, right) => right.week.localeCompare(left.week));
}

function dateWindowCutoff(days: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

function mileageForWindow(rows: StravaActivity[], days: number): number {
  const cutoff = dateWindowCutoff(days);

  return rows.reduce((sum, row) => {
    if (!isValidDateString(row.start_date_local)) {
      return sum;
    }

    const runDate = new Date(row.start_date_local);
    return runDate >= cutoff ? sum + (row.distance_mi ?? 0) : sum;
  }, 0);
}

export function buildTrainingContext(rows: StravaActivity[], days: number): TrainingContext {
  const valid = validRuns(rows).sort(sortByDateDesc);
  const summary = summarizeRunningRows(rows);
  const weeklyRunningLoad = groupWeeklyRunningLoad(rows);
  const missingHeartrate = valid.filter((row) => row.average_heartrate == null).length;
  const missingCalories = valid.filter((row) => row.calories == null).length;
  const notes = [...summary.notes];

  if (missingHeartrate > 0) {
    notes.push(`${missingHeartrate} run(s) in the period are missing average_heartrate.`);
  }

  if (missingCalories > 0) {
    notes.push(`${missingCalories} run(s) in the period are missing calories.`);
  }

  return {
    days,
    recent_runs: valid.slice(0, 10).map(previewActivity),
    weekly_running_load: weeklyRunningLoad,
    current_mileage: {
      "7_day_miles": mileageForWindow(valid, 7),
      "14_day_miles": mileageForWindow(valid, 14),
      "30_day_miles": mileageForWindow(valid, 30),
    },
    long_run: summary.longest_run,
    average_pace_min_per_mi: summary.average_pace_min_per_mi,
    average_heart_rate: summary.average_heart_rate,
    notes,
  };
}

export function dateNotesForActivities(rows: Array<{ start_date_local: string | null }>): string[] {
  const invalidCount = rows.filter((row) => !isValidDateString(row.start_date_local)).length;
  return invalidCount > 0 ? [`Skipped ${invalidCount} result(s) with invalid start_date_local values.`] : [];
}

