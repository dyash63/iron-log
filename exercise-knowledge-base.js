/*!
 * Iron Exercise Knowledge Base
 * Deterministic exercise metadata derived from the app's EXERCISE_DATA catalog.
 * These are practical heuristics, not individualized prescriptions or medical advice.
 */
(function (global) {
  'use strict';

  function normalize(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function classify(exercise) {
    const name = String(exercise.n || '').toLowerCase();
    const equipment = String(exercise.e || '').toLowerCase();
    const group = String(exercise.g || '').toLowerCase();

    const compoundTerms = [
      'press', 'squat', 'deadlift', 'row', 'pull up', 'pull-up', 'chin up',
      'chin-up', 'dip', 'lunge', 'step up', 'step-up', 'thrust', 'clean',
      'snatch', 'burpee', 'push up', 'push-up', 'pulldown', 'pull down'
    ];
    const isCompound = compoundTerms.some(term => name.includes(term));
    const isBodyweight = equipment.includes('bodyweight') ||
      /push.?up|pull.?up|chin.?up|dip|plank|burpee|mountain climber/i.test(name);

    let category = isCompound ? 'compound' : 'isolation';
    if (/carry|walk|run|bike|cycling|rowing machine|jump rope|jumping jack|cardio/i.test(name)) {
      category = 'conditioning';
    }

    let biomechanics = 'Controlled resistance movement';
    if (/\bpress\b|push.?up|dip|fly|crossover/i.test(name)) biomechanics = 'Horizontal or vertical push';
    else if (/row|pulldown|pull.?up|chin.?up|face pull/i.test(name)) biomechanics = 'Horizontal or vertical pull';
    else if (/squat|lunge|leg press|step.?up/i.test(name)) biomechanics = 'Knee-dominant lower-body movement';
    else if (/deadlift|hinge|good morning|back extension|thrust/i.test(name)) biomechanics = 'Hip-dominant lower-body movement';
    else if (/curl/i.test(name)) biomechanics = 'Elbow flexion';
    else if (/extension|pushdown|kickback/i.test(name)) biomechanics = 'Elbow extension';
    else if (/raise|lateral|front raise|rear delt/i.test(name)) biomechanics = 'Shoulder isolation';
    else if (/plank|crunch|sit.?up|rotation|twist/i.test(name)) biomechanics = 'Trunk stability or flexion';
    else if (category === 'conditioning') biomechanics = 'Cardiorespiratory conditioning';

    let difficulty = 'Beginner';
    if (isCompound && !isBodyweight) difficulty = 'Intermediate';
    if (/snatch|clean|muscle up|pistol squat/i.test(name)) difficulty = 'Advanced';

    let recommendedSets = category === 'conditioning' ? [2, 4] : (isCompound ? [3, 4] : [2, 4]);
    let recommendedReps = category === 'conditioning' ? [8, 15] : (isCompound ? [6, 10] : [10, 15]);
    let restSeconds = isCompound ? [120, 180] : [60, 90];
    let repNote = isCompound
      ? 'Use controlled reps; stop with 1–3 reps in reserve'
      : 'Use a controlled range of motion; stop with 1–3 reps in reserve';

    if (/calf|lateral raise|rear delt|fly|curl|pushdown|extension/i.test(name)) {
      recommendedReps = [10, 20];
      restSeconds = [45, 90];
    }
    if (/plank/i.test(name)) {
      recommendedReps = [20, 60];
      repNote = 'Hold for seconds with steady breathing and neutral alignment';
      restSeconds = [45, 75];
    }
    if (category === 'conditioning') {
      recommendedReps = [10, 20];
      repNote = 'Choose a sustainable pace and track duration separately where supported';
      restSeconds = [30, 90];
    }

    const fatigueRating = isCompound ? 'High' : (category === 'conditioning' ? 'Variable' : 'Moderate');

    return {
      category,
      biomechanics,
      difficulty,
      recommendedSets,
      recommendedReps,
      repNote,
      restSeconds,
      fatigueRating
    };
  }

  function buildDatabase(exercises) {
    const database = Object.create(null);
    (Array.isArray(exercises) ? exercises : []).forEach(exercise => {
      if (!exercise || !exercise.g || !exercise.n) return;
      const key = String(exercise.g) + '|' + normalize(exercise.n);
      if (!database[key]) database[key] = classify(exercise);
    });
    return database;
  }

  global.IronExerciseKB = Object.freeze({ buildDatabase });
})(typeof window !== 'undefined' ? window : globalThis);
