/*!
 * Iron Exercise Knowledge Base (part of the Iron Intelligence Engine family)
 * ------------------------------------------------------------------------
 * A deterministic, rule-based classifier that turns Iron Log's lightweight
 * exercise library entries — { group, name, equipment, secondaryMuscles }
 * — into the richer per-exercise metadata described in the Iron
 * Intelligence Engine design doc: movement pattern, push/pull/leg
 * classification, compound vs. isolation, biomechanical classification,
 * difficulty, fatigue rating, recovery time, recommended sets/reps/rest,
 * and strength/hypertrophy/endurance emphasis.
 *
 * Iron Log's exercise library already has 900+ entries (EXERCISE_DATA in
 * index.html). Hand-authoring metadata for each one isn't practical or
 * maintainable, so instead of a hardcoded per-exercise table, this file
 * is a small set of transparent, explainable RULES that classify any
 * exercise from its name + group + equipment. No AI/LLM calls, no network
 * requests — every classification can be traced back to the keyword rule
 * that produced it (see `classification.reason` on each result).
 *
 * USAGE
 * -----
 *   <script src="exercise-knowledge-base.js"></script>
 *   <script>
 *     // Classify one exercise:
 *     const meta = IronExerciseKB.classifyExercise({
 *       group: 'chest', name: 'Bench Press', equipment: 'Barbell, Bench', secondaryMuscles: 'Chest, Shoulders, Triceps'
 *     });
 *
 *     // Or batch-classify Iron Log's whole EXERCISE_DATA array into a
 *     // lookup map keyed the same way Iron Log keys its own EXERCISE_META
 *     // (group + "|" + normalized name):
 *     const KB = IronExerciseKB.buildDatabase(EXERCISE_DATA);
 *     const meta2 = KB['chest|bench press'];
 *   </script>
 * ------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const VERSION = '1.0.0';

  /* =====================================================================
   * MOVEMENT-PATTERN MAP (mirrors IronIntelligenceEngine.MUSCLE_DB.movement
   * — kept as a local, dependency-free copy so this file works standalone)
   * ===================================================================== */
  const GROUP_MOVEMENT = {
    chest: 'push', shoulders: 'push', triceps: 'push',
    back: 'pull', biceps: 'pull', forearms: 'pull',
    legs: 'legs', glutes: 'legs', calves: 'legs',
    abs: 'core',
    cardio: 'cardio'
  };

  const GROUP_LABEL = {
    chest: 'Chest', triceps: 'Triceps', biceps: 'Biceps', forearms: 'Forearms',
    back: 'Back', shoulders: 'Shoulders', legs: 'Legs', glutes: 'Glutes',
    calves: 'Calves', abs: 'Abs', cardio: 'Cardio'
  };

  // Base recovery windows, mirroring IronIntelligenceEngine.MUSCLE_DB.recoveryHours.
  const GROUP_RECOVERY_HOURS = {
    chest: 48, back: 48, shoulders: 48, biceps: 48, triceps: 48,
    forearms: 24, legs: 72, glutes: 72, calves: 48, abs: 24, cardio: 24
  };

  /* =====================================================================
   * KEYWORD DICTIONARIES
   * ===================================================================== */
  const MOBILITY_KEYWORDS = [
    'stretch', 'mobility', 'foam roll', 'foam roller', 'warm-up', 'warmup',
    'breathing', 'meditation', 'circles', 'circle', 'cat-cow', 'cat cow',
    "child's pose", 'wall angels', 'dislocates', 'open book', 'chin tuck',
    'neck tilt', 'neck stretch', 'head turn', 'head tilt', 'cars', 'car ',
    'blackroll', 'smr ', 'rolling', 'deep breathing'
  ];

  const PLYO_CARDIO_KEYWORDS = [
    'interval', 'sprint', 'hiit', 'jump', 'battle rope', 'box jump',
    'burpee', 'ball slam', 'sled', 'skip', 'high knee'
  ];

  const HINGE_KEYWORDS = ['deadlift', 'rdl', 'romanian deadlift', 'hip thrust', 'good morning', 'hinge', 'kettlebell swing', 'pull-through', 'pull through'];
  const SQUAT_KEYWORDS = ['squat', 'lunge', 'step-up', 'step up', 'leg press'];
  const HORIZONTAL_PUSH_KEYWORDS = ['bench', 'chest press', 'push-up', 'pushup', 'push up', 'fly', 'flye', 'dip'];
  const VERTICAL_PUSH_KEYWORDS = ['overhead press', 'shoulder press', 'military press', 'ohp', 'handstand push', 'push press', 'landmine press'];
  const VERTICAL_PULL_KEYWORDS = ['pulldown', 'pull down', 'pull-up', 'pull up', 'chin-up', 'chin up', 'chin tuck'];
  const HORIZONTAL_PULL_KEYWORDS = ['row'];
  const CORE_ROTATION_KEYWORDS = ['twist', 'rotation', 'woodchop', 'wood chop', 'russian'];
  const CORE_STABILITY_KEYWORDS = ['plank', 'hold', 'dead bug', 'deadbug', 'pallof', 'carry', 'hollow'];

  const COMPOUND_KEYWORDS = [
    'squat', 'deadlift', 'press', 'bench', 'row', 'pull-up', 'pull up',
    'chin-up', 'chin up', 'lunge', 'thrust', 'clean', 'snatch', 'dip',
    'pulldown', 'pull down', 'jerk', 'muscle up'
  ];
  const ISOLATION_KEYWORDS = [
    'curl', 'extension', 'fly', 'flye', 'raise', 'kickback', 'shrug',
    'pushdown', 'push down', 'wrist curl', 'lateral raise', 'crunch',
    'abduction', 'adduction'
  ];

  const ADVANCED_KEYWORDS = [
    'muscle up', 'pistol', 'front lever', 'back lever', 'planche',
    'handstand', 'archer', 'dragon flag', 'human flag', 'typewriter',
    'l-sit', 'l sit', 'straddle l-sit', 'tuck l-sit', 'one arm', 'one-arm',
    'single-arm cable pushdown'
  ];

  function nameHasAny(name, list) {
    const n = name.toLowerCase();
    return list.some(k => n.includes(k));
  }

  /* =====================================================================
   * CLASSIFICATION RULES
   * ===================================================================== */

  function classifyLifeCycleCategory(group, name) {
    if (nameHasAny(name, MOBILITY_KEYWORDS)) return 'mobility';
    if (group === 'cardio') return 'cardio';
    if (group === 'abs') return 'core';
    return 'resistance';
  }

  // Compound vs isolation, for "resistance" category exercises only.
  function classifyCompoundIsolation(name, secondaryMuscles) {
    const hasCompoundWord = nameHasAny(name, COMPOUND_KEYWORDS);
    const hasIsolationWord = nameHasAny(name, ISOLATION_KEYWORDS);
    if (hasCompoundWord) {
      return { category: 'compound', reason: 'name matches a compound-movement keyword (e.g. squat, press, row, deadlift)' };
    }
    if (hasIsolationWord) {
      return { category: 'isolation', reason: 'name matches an isolation-movement keyword' };
    }
    if (secondaryMuscles.length >= 2) {
      return { category: 'compound', reason: 'hits 2+ secondary muscles, implying a multi-joint movement' };
    }
    return { category: 'isolation', reason: 'default: single-muscle-focused movement with no compound keyword match' };
  }

  function classifyBiomechanics(group, name, lifeCycleCategory) {
    if (lifeCycleCategory === 'mobility') return { label: 'Static Stretch / Mobility', reason: 'name matches a stretch/mobility keyword' };
    if (lifeCycleCategory === 'cardio') {
      return nameHasAny(name, PLYO_CARDIO_KEYWORDS)
        ? { label: 'Plyometric / Conditioning', reason: 'name matches a high-intensity/plyometric cardio keyword' }
        : { label: 'Steady-State Cardio', reason: 'default cardio classification' };
    }
    if (nameHasAny(name, HINGE_KEYWORDS)) return { label: 'Hip Hinge', reason: 'name matches a hip-hinge keyword' };
    if (nameHasAny(name, SQUAT_KEYWORDS)) return { label: 'Squat / Lunge Pattern', reason: 'name matches a squat/lunge keyword' };
    if (group === 'chest' && nameHasAny(name, HORIZONTAL_PUSH_KEYWORDS)) return { label: 'Horizontal Push', reason: 'chest exercise matching a horizontal-press keyword' };
    if (nameHasAny(name, VERTICAL_PUSH_KEYWORDS) || (name.toLowerCase().includes('overhead') && name.toLowerCase().includes('press'))) return { label: 'Vertical Push', reason: 'name matches an overhead-press keyword' };
    if (nameHasAny(name, VERTICAL_PULL_KEYWORDS)) return { label: 'Vertical Pull', reason: 'name matches a pulldown/pull-up keyword' };
    if (group === 'back' && nameHasAny(name, HORIZONTAL_PULL_KEYWORDS)) return { label: 'Horizontal Pull', reason: 'back exercise matching a rowing keyword' };
    if (group === 'biceps') return { label: 'Elbow Flexion (Isolation)', reason: 'primary muscle is biceps' };
    if (group === 'triceps') return { label: 'Elbow Extension (Isolation)', reason: 'primary muscle is triceps' };
    if (group === 'shoulders') return { label: 'Shoulder Isolation', reason: 'primary muscle is shoulders, no press pattern matched' };
    if (group === 'calves') return { label: 'Ankle Plantarflexion (Isolation)', reason: 'primary muscle is calves' };
    if (group === 'forearms') return { label: 'Wrist / Grip Isolation', reason: 'primary muscle is forearms' };
    if (group === 'abs') {
      if (nameHasAny(name, CORE_ROTATION_KEYWORDS)) return { label: 'Core Rotation', reason: 'name matches a rotational-core keyword' };
      if (nameHasAny(name, CORE_STABILITY_KEYWORDS)) return { label: 'Core Anti-Extension / Stability', reason: 'name matches an isometric-core keyword' };
      return { label: 'Core Flexion', reason: 'default abs classification' };
    }
    const movement = GROUP_MOVEMENT[group] || 'push';
    const fallbackLabel = { push: 'Push (General)', pull: 'Pull (General)', legs: 'Lower Body (General)' }[movement] || 'General';
    return { label: fallbackLabel, reason: 'no specific keyword matched; falling back to the muscle group\'s general movement pattern' };
  }

  function classifyDifficulty(name, category, lifeCycleCategory) {
    if (nameHasAny(name, ADVANCED_KEYWORDS)) return { label: 'Advanced', reason: 'name matches an advanced-skill keyword' };
    if (lifeCycleCategory === 'resistance' && category === 'compound') return { label: 'Intermediate', reason: 'compound movements require more coordination and technique' };
    return { label: 'Beginner', reason: 'isolation, cardio, or mobility work — generally accessible' };
  }

  function classifyFatigue(group, name, category, lifeCycleCategory, biomechanicsLabel) {
    if (lifeCycleCategory === 'mobility') return { label: 'Low', reason: 'mobility/stretching work carries minimal systemic fatigue' };
    if (lifeCycleCategory === 'cardio') {
      return biomechanicsLabel === 'Plyometric / Conditioning'
        ? { label: 'High', reason: 'plyometric/high-intensity cardio is systemically taxing' }
        : { label: 'Medium', reason: 'steady-state cardio is moderately taxing' };
    }
    if (category === 'compound') {
      return (group === 'legs' || group === 'glutes' || group === 'back')
        ? { label: 'High', reason: 'heavy compound movement for a large, high-demand muscle group' }
        : { label: 'Medium', reason: 'compound movement for a smaller muscle group' };
    }
    return { label: 'Low', reason: 'isolation/core work carries lower systemic fatigue' };
  }

  function classifyRecovery(group, fatigueLabel, lifeCycleCategory) {
    const base = GROUP_RECOVERY_HOURS[group] != null ? GROUP_RECOVERY_HOURS[group] : 48;
    if (lifeCycleCategory === 'mobility') return 12; // can be repeated almost daily
    if (fatigueLabel === 'High') return base + 24; // heavy compounds need extra time beyond the generic muscle-group window
    return base;
  }

  function classifySetsRepsRest(lifeCycleCategory, category) {
    if (lifeCycleCategory === 'mobility') {
      return { sets: [1, 3], reps: null, repNote: 'Hold 20-45 sec per side/position', restSeconds: [15, 30] };
    }
    if (lifeCycleCategory === 'cardio') {
      return { sets: null, reps: null, repNote: 'Duration-based (minutes), not sets/reps', restSeconds: null };
    }
    if (lifeCycleCategory === 'core') {
      return { sets: [2, 4], reps: [12, 20], repNote: null, restSeconds: [30, 60] };
    }
    if (category === 'compound') {
      return { sets: [3, 5], reps: [5, 10], repNote: null, restSeconds: [90, 180] };
    }
    return { sets: [2, 4], reps: [10, 15], repNote: null, restSeconds: [45, 90] };
  }

  function classifyEmphasis(lifeCycleCategory, category) {
    if (lifeCycleCategory === 'mobility') return { strength: 1, hypertrophy: 1, endurance: 2 };
    if (lifeCycleCategory === 'cardio') return { strength: 1, hypertrophy: 1, endurance: 5 };
    if (lifeCycleCategory === 'core') return { strength: 2, hypertrophy: 3, endurance: 4 };
    if (category === 'compound') return { strength: 5, hypertrophy: 4, endurance: 2 };
    return { strength: 2, hypertrophy: 5, endurance: 3 }; // isolation
  }

  function parseSecondaryMuscles(raw) {
    if (!raw) return [];
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }

  /* =====================================================================
   * PUBLIC: classify a single exercise
   * ===================================================================== */

  // input: { group, name, equipment, secondaryMuscles } — equipment and
  // secondaryMuscles may be strings (Iron Log's 'e'/'m' fields) or arrays.
  function classifyExercise(input) {
    const group = input.group;
    const name = input.name || '';
    const equipment = Array.isArray(input.equipment) ? input.equipment.join(', ') : (input.equipment || 'Bodyweight');
    const secondaryMuscles = Array.isArray(input.secondaryMuscles) ? input.secondaryMuscles : parseSecondaryMuscles(input.secondaryMuscles);

    const lifeCycleCategory = classifyLifeCycleCategory(group, name);
    const compoundIsolation = lifeCycleCategory === 'resistance'
      ? classifyCompoundIsolation(name, secondaryMuscles)
      : { category: lifeCycleCategory, reason: `classified as ${lifeCycleCategory} rather than a weighted resistance movement` };

    const biomechanics = classifyBiomechanics(group, name, lifeCycleCategory);
    const difficulty = classifyDifficulty(name, compoundIsolation.category, lifeCycleCategory);
    const fatigue = classifyFatigue(group, name, compoundIsolation.category, lifeCycleCategory, biomechanics.label);
    const recoveryHours = classifyRecovery(group, fatigue.label, lifeCycleCategory);
    const prescription = classifySetsRepsRest(lifeCycleCategory, compoundIsolation.category);
    const emphasis = classifyEmphasis(lifeCycleCategory, compoundIsolation.category);

    return {
      name,
      primaryMuscle: GROUP_LABEL[group] || group,
      primaryGroup: group,
      secondaryMuscles,
      equipment,
      movementPattern: lifeCycleCategory === 'mobility' ? 'mobility' : (GROUP_MOVEMENT[group] || 'push'),
      lifeCycleCategory,          // 'resistance' | 'core' | 'cardio' | 'mobility'
      category: compoundIsolation.category, // 'compound' | 'isolation' | 'core' | 'cardio' | 'mobility'
      biomechanics: biomechanics.label,
      difficulty: difficulty.label,
      fatigueRating: fatigue.label,
      recoveryHours,
      recommendedSets: prescription.sets,
      recommendedReps: prescription.reps,
      repNote: prescription.repNote,
      restSeconds: prescription.restSeconds,
      emphasis, // { strength, hypertrophy, endurance } each 1-5
      classification: {
        // why each call was made — keeps the engine's decisions auditable,
        // matching the "explainable, not black-box" design principle.
        compoundIsolation: compoundIsolation.reason,
        biomechanics: biomechanics.reason,
        difficulty: difficulty.reason,
        fatigue: fatigue.reason
      }
    };
  }

  /* =====================================================================
   * PUBLIC: batch-classify Iron Log's whole exercise library
   * ===================================================================== */

  // Mirrors Iron Log's own normalizeExerciseName()/exerciseMetaKey() so the
  // resulting map can be looked up with the same keys Iron Log already uses.
  function normalizeExerciseName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function exerciseMetaKey(group, name) {
    return group + '|' + normalizeExerciseName(name);
  }

  // exerciseDataArray: Iron Log's EXERCISE_DATA — [{ g, n, e, m, img, src }, ...]
  function buildDatabase(exerciseDataArray) {
    const db = {};
    (exerciseDataArray || []).forEach(ex => {
      const key = exerciseMetaKey(ex.g, ex.n);
      if (db[key]) return; // first entry wins, same de-dupe rule Iron Log itself uses
      const meta = classifyExercise({ group: ex.g, name: ex.n, equipment: ex.e, secondaryMuscles: ex.m });
      meta.image = ex.img || null;
      meta.source = ex.src || null;
      db[key] = meta;
    });
    return db;
  }

  const IronExerciseKB = {
    VERSION,
    GROUP_MOVEMENT,
    GROUP_LABEL,
    GROUP_RECOVERY_HOURS,
    normalizeExerciseName,
    exerciseMetaKey,
    classifyExercise,
    buildDatabase
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = IronExerciseKB;
  } else {
    global.IronExerciseKB = IronExerciseKB;
  }
})(typeof window !== 'undefined' ? window : globalThis);
