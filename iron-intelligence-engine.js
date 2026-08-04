/*!
 * Iron Intelligence Engine (IIE)
 * ------------------------------------------------------------------------
 * A deterministic, evidence-based training analytics engine for Iron Log.
 *
 * This file contains NO calls to any external AI / LLM API. Every number
 * it produces comes from arithmetic over the workout logs you pass in,
 * checked against fixed, documented thresholds drawn from mainstream
 * resistance-training literature (ACSM / NSCA / ISSN position stands and
 * commonly cited hypertrophy-volume meta-analyses, e.g. Schoenfeld et al.).
 * Every recommendation can be traced back to the rule that produced it
 * (see each recommendation's `rule` field).
 *
 * USAGE
 * -----
 *   <script src="iron-intelligence-engine.js"></script>
 *   <script>
 *     const report = IronIntelligenceEngine.generateReport(logs, {
 *       asOf: new Date(),      // optional, defaults to now
 *       lookbackDays: 7,       // weekly-volume window
 *       daysPerWeekTarget: 4   // used for consistency/adherence scoring
 *     });
 *     console.log(report.coach.summary);
 *   </script>
 *
 * DATA CONTRACT
 * -------------
 * `logs` is the same object Iron Log already keeps in memory / Firestore:
 *
 *   logs["YYYY-MM-DD"] = {
 *     groups: [...] | null,
 *     warmup: { ... },
 *     exercises: {
 *       "<group>|<name>": {
 *         group: "chest" | "back" | ... | "cardio",
 *         name: "Bench Press",
 *         sets: [
 *           { weight: <kg or null>, reps: <int or null> },   // strength exercises
 *           { minutes: <int or null> }                        // cardio exercises
 *         ]
 *       }
 *     },
 *     finisherType, finishers: {...},
 *     completedAt: <ISO string> | undefined
 *   }
 *
 * All weights are expected in kilograms (Iron Log's internal storage unit).
 * Nothing in this file talks to the network, localStorage, or Firestore —
 * it is a pure function of the `logs` object you hand it, so it works
 * identically offline, in a Node test harness, or inside the browser.
 * ------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const VERSION = '1.1.0';

  /* =====================================================================
   * 1. MUSCLE INTELLIGENCE DATABASE
   * ===================================================================== */

  // Weekly *working set* targets are deliberately conservative ranges that
  // sit inside the commonly-cited 10-20 sets/muscle/week hypertrophy zone,
  // narrowed per muscle group by typical recoverable capacity.
  const MUSCLE_DB = {
    chest:     { label: 'Chest',     movement: 'push', priority: 'high',   minWeekly: 8,  optimalMin: 12, optimalMax: 20, maxRecoverable: 24, recoveryHours: 48 },
    back:      { label: 'Back',      movement: 'pull', priority: 'high',   minWeekly: 8,  optimalMin: 14, optimalMax: 22, maxRecoverable: 26, recoveryHours: 48 },
    shoulders: { label: 'Shoulders', movement: 'push', priority: 'medium', minWeekly: 6,  optimalMin: 10, optimalMax: 16, maxRecoverable: 20, recoveryHours: 48 },
    biceps:    { label: 'Biceps',    movement: 'pull', priority: 'medium', minWeekly: 4,  optimalMin: 8,  optimalMax: 14, maxRecoverable: 16, recoveryHours: 48 },
    triceps:   { label: 'Triceps',   movement: 'push', priority: 'medium', minWeekly: 4,  optimalMin: 8,  optimalMax: 14, maxRecoverable: 16, recoveryHours: 48 },
    forearms:  { label: 'Forearms',  movement: 'pull', priority: 'low',    minWeekly: 0,  optimalMin: 4,  optimalMax: 8,  maxRecoverable: 10, recoveryHours: 24 },
    legs:      { label: 'Legs',      movement: 'legs', priority: 'high',   minWeekly: 8,  optimalMin: 12, optimalMax: 18, maxRecoverable: 22, recoveryHours: 72 },
    glutes:    { label: 'Glutes',    movement: 'legs', priority: 'medium', minWeekly: 6,  optimalMin: 10, optimalMax: 16, maxRecoverable: 18, recoveryHours: 72 },
    calves:    { label: 'Calves',    movement: 'legs', priority: 'low',    minWeekly: 6,  optimalMin: 8,  optimalMax: 16, maxRecoverable: 20, recoveryHours: 48 },
    abs:       { label: 'Abs',       movement: 'core', priority: 'low',   minWeekly: 0,  optimalMin: 6,  optimalMax: 12, maxRecoverable: 16, recoveryHours: 24 }
    // 'cardio' is intentionally excluded — it is tracked in minutes, not sets,
    // and handled separately (see CARDIO_TARGET below).
  };

  const CARDIO_TARGET = { minWeeklyMinutes: 75, optimalWeeklyMinutes: 150 }; // aligns with common ACSM/WHO moderate-activity guidance

  // Antagonist / complementary pairs used for muscle-balance detection.
  // `ratioTolerance` = how far the smaller can fall below the larger
  // (as a fraction) before it's flagged as lagging.
  const BALANCE_PAIRS = [
    { a: 'chest', b: 'back', ratioTolerance: 0.35 },
    { a: 'biceps', b: 'triceps', ratioTolerance: 0.4 },
    { a: 'legs', b: 'glutes', ratioTolerance: 0.45 }
  ];

  // Push / Pull / Legs / Core grouping for movement-balance analysis.
  const PPL_GROUPS = {
    push: ['chest', 'shoulders', 'triceps'],
    pull: ['back', 'biceps', 'forearms'],
    legs: ['legs', 'glutes', 'calves'],
    core: ['abs']
  };

  // Loose keyword match used to approximate compound-vs-isolation for the
  // Workout Quality Score. This is a heuristic, not an exhaustive exercise
  // database — it only needs to be directionally correct.
  const COMPOUND_KEYWORDS = [
    'squat', 'deadlift', 'bench press', 'press', 'row', 'pull-up', 'pull up',
    'chin up', 'chin-up', 'lunge', 'thrust', 'clean', 'snatch', 'dip'
  ];

  /* =====================================================================
   * 2. SMALL PURE HELPERS
   * ===================================================================== */

  function toLocalDate(key) {
    // "YYYY-MM-DD" -> local Date at midnight. Matches Iron Log's own
    // timezone-safe dateKey() convention (local components, no UTC shift).
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function keyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysBetween(a, b) {
    const MS_DAY = 86400000;
    return Math.round((toLocalDate(keyFromDate(a)) - toLocalDate(keyFromDate(b))) / MS_DAY);
  }

  function isStrengthSet(s) {
    return !!(s && s.weight != null && s.reps != null && s.weight > 0 && s.reps > 0);
  }

  function isCardioSet(s) {
    return !!(s && s.minutes != null && s.minutes > 0);
  }

  // Epley formula — simple, well-known estimated-1RM calculation.
  function estimateOneRepMax(weightKg, reps) {
    if (!weightKg || !reps) return 0;
    return weightKg * (1 + reps / 30);
  }

  function isDayLogged(entry) {
    if (!entry) return false;
    if (entry.completedAt) return true;
    const warmupDone = entry.warmup && Object.values(entry.warmup).some(w => w && w.done);
    const finisherDone = entry.finishers &&
      Object.values(entry.finishers).some(bucket => bucket && Object.values(bucket).some(v => v && (v.done || v.value)));
    const hasExercise = entry.exercises && Object.values(entry.exercises).some(ex =>
      (ex.sets || []).some(s => isStrengthSet(s) || isCardioSet(s))
    );
    return !!(warmupDone || finisherDone || hasExercise);
  }

  function sortedKeysInRange(logs, fromDate, toDate) {
    const keys = [];
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      keys.push(keyFromDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }

  /* =====================================================================
   * 3. WORKOUT ANALYTICS ENGINE (single-day metrics)
   * ===================================================================== */

  function analyzeDay(entry) {
    const result = {
      totalSets: 0,
      totalVolume: 0,       // sum(weight * reps) in kg
      cardioMinutes: 0,
      groupsTrained: new Set(),
      compoundSets: 0,
      isolationSets: 0,
      setsInHypertrophyRange: 0 // reps between 6 and 15
    };
    if (!entry || !entry.exercises) return result;

    Object.values(entry.exercises).forEach(ex => {
      const isCompound = COMPOUND_KEYWORDS.some(k => (ex.name || '').toLowerCase().includes(k));
      (ex.sets || []).forEach(s => {
        if (isCardioSet(s)) {
          result.cardioMinutes += s.minutes;
          result.groupsTrained.add(ex.group);
          return;
        }
        if (!isStrengthSet(s)) return;
        result.totalSets += 1;
        result.totalVolume += s.weight * s.reps;
        result.groupsTrained.add(ex.group);
        if (isCompound) result.compoundSets += 1; else result.isolationSets += 1;
        if (s.reps >= 6 && s.reps <= 15) result.setsInHypertrophyRange += 1;
      });
    });
    return result;
  }

  /* =====================================================================
   * 4. WEEKLY VOLUME ANALYSIS
   * ===================================================================== */

  function computeWeeklyVolume(logs, asOf, lookbackDays) {
    lookbackDays = lookbackDays || 7;
    const to = new Date(asOf);
    const from = new Date(asOf);
    from.setDate(from.getDate() - (lookbackDays - 1));

    const setsByGroup = {};
    Object.keys(MUSCLE_DB).forEach(g => { setsByGroup[g] = 0; });
    let cardioMinutes = 0;

    sortedKeysInRange(logs, from, to).forEach(key => {
      const entry = logs[key];
      if (!entry || !entry.exercises) return;
      Object.values(entry.exercises).forEach(ex => {
        (ex.sets || []).forEach(s => {
          if (isCardioSet(s)) { cardioMinutes += s.minutes; return; }
          if (isStrengthSet(s) && setsByGroup.hasOwnProperty(ex.group)) {
            setsByGroup[ex.group] += 1;
          }
        });
      });
    });

    return { window: { from: keyFromDate(from), to: keyFromDate(to), days: lookbackDays }, setsByGroup, cardioMinutes };
  }

  function classifyVolumeStatus(group, weeklySets) {
    const db = MUSCLE_DB[group];
    if (!db) return 'unknown';
    if (weeklySets < db.minWeekly) return 'undertrained';
    if (weeklySets < db.optimalMin) return 'below-optimal';
    if (weeklySets <= db.optimalMax) return 'optimal';
    if (weeklySets <= db.maxRecoverable) return 'high';
    return 'overtrained';
  }

  function buildVolumeReport(weeklyVolume) {
    const report = {};
    Object.keys(MUSCLE_DB).forEach(group => {
      const sets = weeklyVolume.setsByGroup[group] || 0;
      report[group] = {
        label: MUSCLE_DB[group].label,
        weeklySets: sets,
        status: classifyVolumeStatus(group, sets),
        optimalMin: MUSCLE_DB[group].optimalMin,
        optimalMax: MUSCLE_DB[group].optimalMax
      };
    });
    const cardioStatus = weeklyVolume.cardioMinutes < CARDIO_TARGET.minWeeklyMinutes ? 'below-target'
      : weeklyVolume.cardioMinutes <= CARDIO_TARGET.optimalWeeklyMinutes ? 'on-target' : 'above-target';
    report.cardio = { label: 'Cardio', weeklyMinutes: weeklyVolume.cardioMinutes, status: cardioStatus, ...CARDIO_TARGET };
    return report;
  }

  /* =====================================================================
   * 5. PUSH / PULL / LEGS BALANCE ANALYSIS
   * ===================================================================== */

  function computePPLBalance(weeklyVolume) {
    const totals = { push: 0, pull: 0, legs: 0, core: 0 };
    Object.keys(PPL_GROUPS).forEach(cat => {
      totals[cat] = PPL_GROUPS[cat].reduce((sum, g) => sum + (weeklyVolume.setsByGroup[g] || 0), 0);
    });
    const grandTotal = totals.push + totals.pull + totals.legs + totals.core;
    const pct = {};
    Object.keys(totals).forEach(cat => {
      pct[cat] = grandTotal ? Math.round((totals[cat] / grandTotal) * 1000) / 10 : 0;
    });
    return { sets: totals, percent: pct, totalSets: grandTotal };
  }

  /* =====================================================================
   * 6. MUSCLE BALANCE DETECTION (antagonist pairs)
   * ===================================================================== */

  function detectMuscleImbalances(weeklyVolume) {
    const imbalances = [];
    BALANCE_PAIRS.forEach(pair => {
      const setsA = weeklyVolume.setsByGroup[pair.a] || 0;
      const setsB = weeklyVolume.setsByGroup[pair.b] || 0;
      if (setsA === 0 && setsB === 0) return;
      const larger = Math.max(setsA, setsB);
      const smaller = Math.min(setsA, setsB);
      if (larger === 0) return;
      const deficitRatio = 1 - (smaller / larger);
      if (deficitRatio >= pair.ratioTolerance) {
        const laggingGroup = setsA < setsB ? pair.a : pair.b;
        const leadingGroup = setsA < setsB ? pair.b : pair.a;
        imbalances.push({
          pair: [pair.a, pair.b],
          lagging: laggingGroup,
          leading: leadingGroup,
          laggingSets: Math.min(setsA, setsB),
          leadingSets: larger,
          deficitPercent: Math.round(deficitRatio * 100)
        });
      }
    });
    return imbalances;
  }

  /* =====================================================================
   * 7. RECOVERY INTELLIGENCE
   * ===================================================================== */

  function computeRecoveryStatus(logs, asOf) {
    const status = {};
    const lookbackStart = new Date(asOf);
    lookbackStart.setDate(lookbackStart.getDate() - 14); // 14 days is plenty to find "last trained"

    const lastTrained = {};
    sortedKeysInRange(logs, lookbackStart, asOf).forEach(key => {
      const entry = logs[key];
      if (!entry || !entry.exercises) return;
      const d = toLocalDate(key);
      Object.values(entry.exercises).forEach(ex => {
        const hasWork = (ex.sets || []).some(s => isStrengthSet(s) || isCardioSet(s));
        if (hasWork) lastTrained[ex.group] = d; // sortedKeysInRange is chronological, so later overwrites earlier
      });
    });

    Object.keys(MUSCLE_DB).forEach(group => {
      const db = MUSCLE_DB[group];
      const last = lastTrained[group];
      if (!last) {
        status[group] = { label: db.label, status: 'Fully Recovered', hoursSinceTrained: null, lastTrained: null };
        return;
      }
      const hoursSince = Math.round((asOf - last) / 3600000);
      let s;
      if (hoursSince < db.recoveryHours * 0.6) s = 'Recovering';
      else if (hoursSince < db.recoveryHours) s = 'Ready Soon';
      else s = 'Fully Recovered';
      status[group] = { label: db.label, status: s, hoursSinceTrained: hoursSince, lastTrained: keyFromDate(last) };
    });
    return status;
  }

  /* =====================================================================
   * 8. PROGRESSIVE OVERLOAD DETECTION
   * ===================================================================== */

  function detectPlateaus(logs, asOf, options) {
    options = options || {};
    const lookbackSessions = options.lookbackSessions || 4;
    const lookbackDays = options.lookbackDays || 42; // 6 weeks of history to search through
    const from = new Date(asOf);
    from.setDate(from.getDate() - lookbackDays);

    // exerciseId -> [{date, e1rm, weight, reps}], chronological
    const history = {};
    const namesById = {};

    sortedKeysInRange(logs, from, asOf).forEach(key => {
      const entry = logs[key];
      if (!entry || !entry.exercises) return;
      Object.entries(entry.exercises).forEach(([id, ex]) => {
        const strengthSets = (ex.sets || []).filter(isStrengthSet);
        if (!strengthSets.length) return;
        const best = strengthSets.reduce((top, s) => {
          const e1rm = estimateOneRepMax(s.weight, s.reps);
          return e1rm > top.e1rm ? { e1rm, weight: s.weight, reps: s.reps } : top;
        }, { e1rm: 0, weight: 0, reps: 0 });
        if (!history[id]) history[id] = [];
        history[id].push({ date: key, ...best });
        namesById[id] = { name: ex.name, group: ex.group };
      });
    });

    const plateaus = [];
    Object.keys(history).forEach(id => {
      const sessions = history[id];
      if (sessions.length < lookbackSessions) return;
      const recent = sessions.slice(-lookbackSessions);
      const first = recent[0].e1rm;
      const last = recent[recent.length - 1].e1rm;
      const improvement = first > 0 ? (last - first) / first : 0;
      // Less than ~2% estimated-1RM improvement across the whole window counts as a plateau.
      if (improvement < 0.02) {
        plateaus.push({
          exerciseId: id,
          name: namesById[id].name,
          group: namesById[id].group,
          sessionsAnalyzed: recent.length,
          firstSession: recent[0],
          lastSession: recent[recent.length - 1],
          estimatedImprovementPercent: Math.round(improvement * 1000) / 10
        });
      }
    });
    return plateaus;
  }

  /* =====================================================================
   * 9. WORKOUT QUALITY SCORE (single day, 0-100)
   * ===================================================================== */

  function scoreWorkoutDay(entry) {
    const day = analyzeDay(entry);
    if (day.totalSets === 0 && day.cardioMinutes === 0) {
      return { score: 0, breakdown: { volume: 0, variety: 0, compoundRatio: 0, intensity: 0 }, day };
    }

    // Volume: up to 30 pts, saturating around 18 working sets.
    const volumeScore = Math.min(30, Math.round((day.totalSets / 18) * 30));

    // Variety: up to 20 pts, saturating at 4 distinct groups trained.
    const varietyScore = Math.min(20, Math.round((day.groupsTrained.size / 4) * 20));

    // Compound ratio: up to 20 pts, full credit at 50%+ compound sets.
    const totalWeighted = day.compoundSets + day.isolationSets;
    const compoundRatio = totalWeighted ? day.compoundSets / totalWeighted : 0;
    const compoundScore = Math.min(20, Math.round((compoundRatio / 0.5) * 20));

    // Intensity proxy: up to 15 pts, full credit when all working sets sit
    // in the classic 6-15 rep hypertrophy/strength band.
    const intensityRatio = totalWeighted ? day.setsInHypertrophyRange / totalWeighted : 0;
    const intensityScore = Math.round(intensityRatio * 15);

    // Base participation credit: up to 15 pts just for showing up (keeps
    // pure-cardio or short mobility days from scoring a hard zero).
    const participationScore = day.totalSets > 0 || day.cardioMinutes > 0 ? 15 : 0;

    const score = Math.min(100, volumeScore + varietyScore + compoundScore + intensityScore + participationScore);
    return {
      score,
      breakdown: { volume: volumeScore, variety: varietyScore, compoundRatio: compoundScore, intensity: intensityScore, participation: participationScore },
      day
    };
  }

  /* =====================================================================
   * 10. CONSISTENCY ENGINE
   * ===================================================================== */

  function computeConsistency(logs, asOf, options) {
    options = options || {};
    const daysPerWeekTarget = options.daysPerWeekTarget || 4;
    const monthDays = options.monthDays || 28;

    // Streaks: walk backward from `asOf` day by day.
    let currentStreak = 0;
    {
      const cursor = new Date(asOf);
      while (isDayLogged(logs[keyFromDate(cursor)])) {
        currentStreak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    // Best streak within the lookback window (bounded scan to keep this cheap).
    let bestStreak = 0, running = 0;
    const scanStart = new Date(asOf);
    scanStart.setDate(scanStart.getDate() - 365);
    sortedKeysInRange(logs, scanStart, asOf).forEach(key => {
      if (isDayLogged(logs[key])) { running += 1; bestStreak = Math.max(bestStreak, running); }
      else { running = 0; }
    });
    bestStreak = Math.max(bestStreak, currentStreak);

    // Weekly frequency (trailing 7 days) and monthly adherence (trailing N days).
    const week = new Date(asOf); week.setDate(week.getDate() - 6);
    const weeklyFrequency = sortedKeysInRange(logs, week, asOf).filter(k => isDayLogged(logs[k])).length;

    const month = new Date(asOf); month.setDate(month.getDate() - (monthDays - 1));
    const loggedInMonth = sortedKeysInRange(logs, month, asOf).filter(k => isDayLogged(logs[k])).length;
    const targetSessions = Math.round((daysPerWeekTarget / 7) * monthDays);
    const monthlyAdherence = targetSessions ? Math.min(100, Math.round((loggedInMonth / targetSessions) * 100)) : 0;

    return { currentStreak, bestStreak, weeklyFrequency, daysPerWeekTarget, monthlyAdherence, loggedInMonth, monthDays };
  }

  /* =====================================================================
   * 11. RECOMMENDATION ENGINE (deterministic rules)
   * ===================================================================== */

  function generateRecommendations(bundle) {
    const recs = [];
    const push = (rec) => recs.push(rec);

    // R1 / R2 — per-muscle volume status
    Object.entries(bundle.volume).forEach(([group, info]) => {
      if (group === 'cardio') return;
      const db = MUSCLE_DB[group];
      if (info.status === 'undertrained' || info.status === 'below-optimal') {
        const target = db.optimalMin - info.weeklySets;
        push({
          id: `volume-low-${group}`,
          priority: db.priority === 'high' ? 'high' : 'medium',
          rule: 'IF weeklySets < optimalMin THEN recommend additional volume',
          message: `${info.label} is at ${info.weeklySets} sets this week, below the ${db.optimalMin}-${db.optimalMax} range. Add roughly ${Math.max(1, target)} more working set(s) over your next few sessions.`
        });
      } else if (info.status === 'overtrained') {
        push({
          id: `volume-high-${group}`,
          priority: 'medium',
          rule: 'IF weeklySets > maxRecoverable THEN recommend deload for that muscle',
          message: `${info.label} volume (${info.weeklySets} sets) is above what most lifters recover well from in a week. Consider trimming a set or two, or giving it an extra rest day.`
        });
      }
    });

    // R3 — Push/Pull balance
    const ppl = bundle.pushPullLeg;
    if (ppl.totalSets >= 10) {
      const diff = ppl.percent.push - ppl.percent.pull;
      if (diff > 15) {
        push({ id: 'ppl-push-heavy', priority: 'medium', rule: 'IF push% - pull% > 15 THEN recommend more pulling volume',
          message: `Your training this week leans push-dominant (${ppl.percent.push}% push vs ${ppl.percent.pull}% pull). Adding a row or pulldown variation would even things out and support shoulder health.` });
      } else if (diff < -15) {
        push({ id: 'ppl-pull-heavy', priority: 'medium', rule: 'IF pull% - push% > 15 THEN recommend more pushing volume',
          message: `Your training this week leans pull-dominant (${ppl.percent.pull}% pull vs ${ppl.percent.push}% push). A little extra pressing volume would balance things out.` });
      }
      if (ppl.percent.legs < 20) {
        push({ id: 'ppl-legs-low', priority: 'high', rule: 'IF legs% < 20% of weekly sets THEN recommend a leg session',
          message: `Legs made up only ${ppl.percent.legs}% of this week's training. A dedicated lower-body session would round things out nicely.` });
      }
    }

    // R4 — antagonist-pair imbalance
    bundle.muscleImbalances.forEach(imb => {
      push({
        id: `imbalance-${imb.pair.join('-')}`,
        priority: 'medium',
        rule: 'IF one paired muscle is >= ratioTolerance behind its antagonist THEN recommend targeted work',
        message: `${MUSCLE_DB[imb.lagging].label} (${imb.laggingSets} sets) is noticeably behind ${MUSCLE_DB[imb.leading].label} (${imb.leadingSets} sets) this week — about ${imb.deficitPercent}% less volume. A couple of extra ${MUSCLE_DB[imb.lagging].label.toLowerCase()} sets would help keep things balanced.`
      });
    });

    // R5 — cardio target
    if (bundle.volume.cardio && bundle.volume.cardio.status === 'below-target') {
      push({ id: 'cardio-low', priority: 'low', rule: 'IF weeklyCardioMinutes < minWeeklyMinutes THEN suggest adding cardio',
        message: `Cardio sits at ${bundle.volume.cardio.weeklyMinutes} min this week, under the general ${CARDIO_TARGET.minWeeklyMinutes}-min/week guideline. Even a couple of short sessions would help.` });
    }

    // R6 — plateaus
    bundle.plateaus.forEach(p => {
      push({
        id: `plateau-${p.exerciseId}`,
        priority: 'medium',
        rule: `IF estimated-1RM improvement < 2% over last ${p.sessionsAnalyzed} sessions THEN flag plateau`,
        message: `${p.name} hasn't moved much over your last ${p.sessionsAnalyzed} sessions (about ${p.estimatedImprovementPercent}% change in estimated 1RM). Try adding a small amount of weight or a rep, adding an extra set, or taking a lighter deload week before pushing again.`
      });
    });

    // R7 — consistency (kept encouraging, never shaming)
    const c = bundle.consistency;
    if (c.currentStreak === 0 && c.weeklyFrequency === 0) {
      push({ id: 'consistency-restart', priority: 'high', rule: 'IF currentStreak == 0 AND weeklyFrequency == 0 THEN nudge to restart gently',
        message: `It's been a few days since your last logged session. Whenever you're ready, even a short workout will get the streak going again.` });
    } else if (c.weeklyFrequency < c.daysPerWeekTarget) {
      push({ id: 'consistency-below-target', priority: 'low', rule: 'IF weeklyFrequency < daysPerWeekTarget THEN note the gap',
        message: `You've trained ${c.weeklyFrequency} of your ${c.daysPerWeekTarget}-day weekly target so far. One more session this week would get you there.` });
    }

    const priorityRank = { high: 0, medium: 1, low: 2 };
    return recs.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  }

  /* =====================================================================
   * 12. WEEKLY PLAN SUGGESTION ENGINE
   * ---------------------------------------------------------------------
   * Looks at the last N days (default 15) of actual training, detects:
   *   - which weekdays tend to be rest days vs. training days
   *   - how many sessions/week the person actually trains
   *   - which "split style" the sessions resemble (push/pull/legs,
   *     upper/lower, full-body, or single-muscle "bro split")
   * ...then produces a suggested 7-day chart for the days ahead, biasing
   * muscle selection toward whatever is undertrained/lagging/imbalanced
   * per the volume + balance analysis above, while respecting each
   * muscle's recovery window so nothing gets scheduled back-to-back
   * before it's ready.
   * ===================================================================== */

  const SUPER_GROUPS = {
    upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
    lower: ['legs', 'glutes', 'calves']
  };

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // How many calendar days must separate two sessions hitting the same
  // muscle, derived from that muscle's recovery window.
  function minGapDaysFor(group) {
    const hours = (MUSCLE_DB[group] && MUSCLE_DB[group].recoveryHours) || 48;
    return Math.max(0, Math.ceil(hours / 24) - 1);
  }

  // Scan the trailing `windowDays` of logs and summarize, per weekday
  // (0=Sun..6=Sat): how often it occurred, how often it was a rest day,
  // and which muscle groups typically show up on it. Also returns the
  // flat, chronological list of sessions used for split-style detection.
  function analyzeTrainingPattern(logs, asOf, windowDays) {
    windowDays = windowDays || 15;
    const from = new Date(asOf);
    from.setDate(from.getDate() - (windowDays - 1));

    const perDow = DOW_LABELS.map(() => ({ occurrences: 0, trained: 0, groupFreq: {}, cardioCount: 0 }));
    const sessions = [];

    sortedKeysInRange(logs, from, asOf).forEach(key => {
      const d = toLocalDate(key);
      const dow = d.getDay();
      const entry = logs[key];
      perDow[dow].occurrences += 1;

      const logged = isDayLogged(entry);
      if (!logged) return;
      perDow[dow].trained += 1;

      const groupsToday = new Set();
      let cardioToday = false;
      if (entry.exercises) {
        Object.values(entry.exercises).forEach(ex => {
          const hasStrength = (ex.sets || []).some(isStrengthSet);
          const hasCardio = (ex.sets || []).some(isCardioSet);
          if (hasStrength) { groupsToday.add(ex.group); perDow[dow].groupFreq[ex.group] = (perDow[dow].groupFreq[ex.group] || 0) + 1; }
          if (hasCardio) { cardioToday = true; }
        });
      }
      if (cardioToday) perDow[dow].cardioCount += 1;
      sessions.push({ key, dow, groups: Array.from(groupsToday), cardio: cardioToday });
    });

    const totalTrainedDays = sessions.length;
    const sessionsPerWeek = (totalTrainedDays / windowDays) * 7;

    return { from: keyFromDate(from), to: keyFromDate(asOf), windowDays, perDow, sessions, totalTrainedDays, sessionsPerWeek };
  }

  // Classify each historical session as push / pull / legs / upper /
  // lower / full-body / isolated, then return whichever style pattern
  // was most common — this becomes the template for next week's chart.
  function classifySplitStyle(sessions) {
    if (!sessions || sessions.length < 3) return 'upper-lower'; // not enough data, use a sane default

    const votes = { ppl: 0, 'upper-lower': 0, 'full-body': 0, 'bro-split': 0 };
    sessions.forEach(s => {
      const groups = s.groups.filter(g => g !== 'cardio' && g !== 'abs');
      if (!groups.length) return;
      const inPush = groups.filter(g => PPL_GROUPS.push.includes(g)).length;
      const inPull = groups.filter(g => PPL_GROUPS.pull.includes(g)).length;
      const inLegsCat = groups.filter(g => PPL_GROUPS.legs.includes(g)).length;
      const inUpper = groups.filter(g => SUPER_GROUPS.upper.includes(g)).length;
      const inLower = groups.filter(g => SUPER_GROUPS.lower.includes(g)).length;

      if (groups.length <= 2) { votes['bro-split'] += 1; return; }
      if (inUpper > 0 && inLower > 0 && groups.length >= 4) { votes['full-body'] += 1; return; }
      if ((inPush >= 2 && inPull === 0 && inLegsCat === 0) ||
          (inPull >= 2 && inPush === 0 && inLegsCat === 0) ||
          (inLegsCat >= 2 && inPush === 0 && inPull === 0)) { votes.ppl += 1; return; }
      if ((inUpper >= 2 && inLower === 0) || (inLower >= 2 && inUpper === 0)) { votes['upper-lower'] += 1; return; }
      votes['bro-split'] += 1;
    });

    return Object.keys(votes).reduce((best, key) => votes[key] > votes[best] ? key : best, 'upper-lower');
  }

  // Rank muscle groups by how much attention they need this week:
  // undertrained + high-priority muscles rise to the top; muscles
  // already flagged as "lagging" in an antagonist pair get a boost;
  // already-overtrained muscles sink to the bottom.
  function rankMusclePriority(volumeReport, muscleImbalances) {
    const statusWeight = { undertrained: 3, 'below-optimal': 2, optimal: 1, high: 0.5, overtrained: 0 };
    const priorityWeight = { high: 1.3, medium: 1.0, low: 0.7 };
    const laggingSet = new Set(muscleImbalances.map(i => i.lagging));

    return Object.keys(MUSCLE_DB)
      .map(group => {
        const info = volumeReport[group];
        const score = (statusWeight[info.status] != null ? statusWeight[info.status] : 1) *
          priorityWeight[MUSCLE_DB[group].priority] + (laggingSet.has(group) ? 1 : 0);
        return { group, score, status: info.status, label: MUSCLE_DB[group].label };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Decide which of the 7 upcoming weekdays should be rest days, based
  // on historical rest likelihood per weekday, falling back to a generic
  // evenly-spaced template when there isn't enough history to trust yet.
  function chooseRestWeekdays(pattern, trainingDaysCount) {
    const restCount = 7 - trainingDaysCount;
    const withData = pattern.perDow
      .map((info, dow) => ({
        dow,
        occurrences: info.occurrences,
        restLikelihood: info.occurrences ? 1 - (info.trained / info.occurrences) : 0.5,
        totalGroupHits: Object.values(info.groupFreq).reduce((a, b) => a + b, 0)
      }));

    const confident = withData.filter(w => w.occurrences >= 2).sort((a, b) => b.restLikelihood - a.restLikelihood);
    const rest = new Set();
    confident.forEach(w => { if (rest.size < restCount && w.restLikelihood >= 0.5) rest.add(w.dow); });

    if (rest.size < restCount) {
      // Not enough confidently-observed rest days — fill remaining slots
      // with the weekdays that historically saw the least training.
      const remaining = withData
        .filter(w => !rest.has(w.dow))
        .sort((a, b) => a.totalGroupHits - b.totalGroupHits);
      for (const w of remaining) {
        if (rest.size >= restCount) break;
        rest.add(w.dow);
      }
    }
    return rest;
  }

  // Main entry point: analyze the last `windowDays` and produce a
  // suggested 7-day chart for the days *after* asOf.
  function suggestWeeklyPlan(logs, asOf, options) {
    options = options || {};
    const windowDays = options.windowDays || 15;
    const daysPerWeekTarget = options.daysPerWeekTarget || 4;

    const pattern = analyzeTrainingPattern(logs, asOf, windowDays);
    const splitStyle = classifySplitStyle(pattern.sessions);

    // Prefer the observed weekly frequency once there's enough history;
    // otherwise fall back to the caller's target, clamped to a sane range.
    const observedPerWeek = Math.round(pattern.sessionsPerWeek);
    const trainingDaysCount = pattern.totalTrainedDays >= 4
      ? Math.min(6, Math.max(3, observedPerWeek))
      : Math.min(6, Math.max(3, daysPerWeekTarget));

    const restWeekdays = chooseRestWeekdays(pattern, trainingDaysCount);

    const weeklyVolumeRaw = computeWeeklyVolume(logs, asOf, 7);
    const volumeReport = buildVolumeReport(weeklyVolumeRaw);
    const muscleImbalances = detectMuscleImbalances(weeklyVolumeRaw);
    const priorityList = rankMusclePriority(volumeReport, muscleImbalances);
    const priorityOrder = priorityList.map(p => p.group);

    // Seed each muscle's "last trained" reference point from real recovery
    // status so the plan doesn't re-schedule something trained yesterday.
    const recovery = computeRecoveryStatus(logs, asOf);
    const lastTrainedIndex = {};
    Object.keys(MUSCLE_DB).forEach(group => {
      const hrs = recovery[group] && recovery[group].hoursSinceTrained;
      lastTrainedIndex[group] = hrs == null ? -999 : -Math.floor(hrs / 24);
    });

    // Build the 7 upcoming calendar days.
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(asOf);
      d.setDate(d.getDate() + i);
      days.push({ index: i - 1, date: keyFromDate(d), dow: d.getDay(), label: DOW_LABELS[d.getDay()] });
    }

    const recoveryOk = (group, dayIndex) => (dayIndex - lastTrainedIndex[group]) > minGapDaysFor(group);

    // Rotation pointers used by the ppl / upper-lower / bro-split templates.
    let pplPointer = 0;
    const pplCycle = ['push', 'pull', 'legs'];
    let ulPointer = 0;
    const ulCycle = ['upper', 'lower'];
    let broPointer = 0;

    const chart = [];
    days.forEach(day => {
      if (restWeekdays.has(day.dow)) {
        chart.push({ date: day.date, day: day.label, type: 'rest', focus: [], cardioMinutes: null, note: 'Rest day, based on your usual pattern.' });
        return;
      }

      let candidateGroups = [];
      let categoryLabel = '';

      if (splitStyle === 'ppl') {
        categoryLabel = pplCycle[pplPointer % pplCycle.length];
        pplPointer += 1;
        candidateGroups = PPL_GROUPS[categoryLabel].slice();
      } else if (splitStyle === 'upper-lower') {
        categoryLabel = ulCycle[ulPointer % ulCycle.length];
        ulPointer += 1;
        candidateGroups = SUPER_GROUPS[categoryLabel].slice();
      } else if (splitStyle === 'bro-split') {
        // Walk the priority list, picking the next 1-2 muscles that are
        // actually recovered by this day.
        const picks = [];
        let scanned = 0;
        while (picks.length < 2 && scanned < priorityOrder.length) {
          const g = priorityOrder[(broPointer + scanned) % priorityOrder.length];
          if (recoveryOk(g, day.index)) picks.push(g);
          scanned += 1;
        }
        broPointer += 1;
        candidateGroups = picks;
        categoryLabel = 'focused';
      } else {
        // full-body: take the top-of-queue priority groups regardless of category
        candidateGroups = priorityOrder.slice();
        categoryLabel = 'full-body';
      }

      // Filter by recovery, ranked by priority within the candidate set,
      // and cap full-body / upper-lower sessions at a sane set count.
      const ranked = candidateGroups
        .filter(g => recoveryOk(g, day.index))
        .sort((a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b));

      const cap = splitStyle === 'full-body' ? 4 : (splitStyle === 'bro-split' ? 2 : ranked.length);
      let focus = ranked.slice(0, cap);

      // If recovery filtering emptied the day (rare, only with very high
      // training frequency), fall back to whatever's most-recovered.
      if (focus.length === 0) {
        focus = candidateGroups.length ? [candidateGroups.sort((a, b) =>
          lastTrainedIndex[a] - lastTrainedIndex[b])[0]] : [priorityOrder[0]];
      }

      focus.forEach(g => { lastTrainedIndex[g] = day.index; });

      // Sprinkle in abs on ~every other training day if it needs volume.
      if (volumeReport.abs.status !== 'optimal' && day.index % 2 === 0 && !focus.includes('abs')) {
        focus.push('abs');
      }

      chart.push({
        date: day.date,
        day: day.label,
        type: 'training',
        splitCategory: categoryLabel,
        focus,
        cardioMinutes: null,
        note: `${focus.map(g => MUSCLE_DB[g].label).join(' + ')} day.`
      });
    });

    // Insert cardio into training days if weekly cardio is under target,
    // preferring the weekdays that historically already carry cardio.
    if (volumeReport.cardio.status === 'below-target') {
      const remainingMinutes = Math.max(0, CARDIO_TARGET.minWeeklyMinutes - volumeReport.cardio.weeklyMinutes);
      const trainingDays = chart.filter(c => c.type === 'training');
      if (trainingDays.length && remainingMinutes > 0) {
        const preferredDows = pattern.perDow
          .map((info, dow) => ({ dow, cardioCount: info.cardioCount }))
          .filter(w => w.cardioCount > 0)
          .map(w => w.dow);
        let cardioSlots = trainingDays.filter(c => preferredDows.includes(new Date(c.date + 'T00:00:00').getDay()));
        if (!cardioSlots.length) cardioSlots = trainingDays.slice(0, Math.min(2, trainingDays.length));
        const perSession = Math.ceil(remainingMinutes / Math.min(2, cardioSlots.length || 1));
        cardioSlots.slice(0, 2).forEach(slot => {
          slot.cardioMinutes = perSession;
          slot.note += ` Plus ~${perSession} min cardio.`;
        });
      }
    }

    const rationale = `Based on your last ${pattern.totalTrainedDays} logged session(s) over the past ${windowDays} days, ` +
      `you're training roughly ${Math.round(pattern.sessionsPerWeek * 10) / 10}x/week in a pattern closest to a ${splitStyle.replace('-', '/')} split. ` +
      `This chart keeps that rhythm, targets ${trainingDaysCount} training day(s), and shifts extra focus toward ` +
      `${priorityOrder.slice(0, 2).map(g => MUSCLE_DB[g].label).join(' and ')}, which need the most attention right now.`;

    return {
      windowAnalyzed: { from: pattern.from, to: pattern.to, days: windowDays, sessionsFound: pattern.totalTrainedDays },
      detectedSplit: splitStyle,
      historicalSessionsPerWeek: Math.round(pattern.sessionsPerWeek * 10) / 10,
      trainingDaysCount,
      priorityMuscles: priorityList.slice(0, 5),
      chart,
      rationale
    };
  }

  /* =====================================================================
   * 13. COACH ENGINE (recommendations -> friendly narrative)
   * ===================================================================== */

  function generateCoachMessages(bundle, recommendations) {
    const c = bundle.consistency;
    const todayScore = bundle.todayScore ? bundle.todayScore.score : null;

    let summary;
    if (c.currentStreak > 0) {
      summary = `You're on a ${c.currentStreak}-day streak with ${c.weeklyFrequency} session(s) logged this week.`;
    } else {
      summary = `No active streak right now, with ${c.weeklyFrequency} session(s) logged in the last 7 days.`;
    }
    if (todayScore != null) {
      summary += ` Today's workout scored ${todayScore}/100.`;
    }
    if (recommendations.length === 0) {
      summary += ` Everything looks well-balanced — nice work.`;
    } else {
      const top = recommendations[0];
      summary += ` The biggest opportunity right now: ${top.message}`;
    }

    const tips = recommendations.map(r => r.message);
    return { summary, tips };
  }

  /* =====================================================================
   * 14. PUBLIC API
   * ===================================================================== */

  function generateReport(logs, options) {
    options = options || {};
    const asOf = options.asOf ? new Date(options.asOf) : new Date();
    const lookbackDays = options.lookbackDays || 7;
    const daysPerWeekTarget = options.daysPerWeekTarget || 4;
    const planWindowDays = options.planWindowDays || 15;

    const weeklyVolumeRaw = computeWeeklyVolume(logs, asOf, lookbackDays);
    const volume = buildVolumeReport(weeklyVolumeRaw);
    const pushPullLeg = computePPLBalance(weeklyVolumeRaw);
    const muscleImbalances = detectMuscleImbalances(weeklyVolumeRaw);
    const recovery = computeRecoveryStatus(logs, asOf);
    const plateaus = detectPlateaus(logs, asOf);
    const consistency = computeConsistency(logs, asOf, { daysPerWeekTarget });
    const todayEntry = logs[keyFromDate(asOf)];
    const todayScore = scoreWorkoutDay(todayEntry);
    const weeklyPlan = options.skipWeeklyPlan ? null : suggestWeeklyPlan(logs, asOf, { windowDays: planWindowDays, daysPerWeekTarget });

    const bundle = { asOf: keyFromDate(asOf), volume, pushPullLeg, muscleImbalances, recovery, plateaus, consistency, todayScore, weeklyPlan };
    const recommendations = generateRecommendations(bundle);
    const coach = generateCoachMessages(bundle, recommendations);

    return { version: VERSION, ...bundle, recommendations, coach };
  }

  const IronIntelligenceEngine = {
    VERSION,
    MUSCLE_DB,
    CARDIO_TARGET,
    BALANCE_PAIRS,
    PPL_GROUPS,
    SUPER_GROUPS,
    // low-level building blocks, exposed for testing / custom dashboards
    estimateOneRepMax,
    isDayLogged,
    analyzeDay,
    computeWeeklyVolume,
    classifyVolumeStatus,
    computePPLBalance,
    detectMuscleImbalances,
    computeRecoveryStatus,
    detectPlateaus,
    scoreWorkoutDay,
    computeConsistency,
    generateRecommendations,
    generateCoachMessages,
    analyzeTrainingPattern,
    classifySplitStyle,
    rankMusclePriority,
    suggestWeeklyPlan,
    // main entry point
    generateReport
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = IronIntelligenceEngine;
  } else {
    global.IronIntelligenceEngine = IronIntelligenceEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
