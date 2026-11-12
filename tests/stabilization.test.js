'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('manifest is valid and every declared icon exists', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(Array.isArray(manifest.icons));
  for (const icon of manifest.icons) {
    const localPath = icon.src.replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(root, localPath)), `Missing icon: ${icon.src}`);
  }
});

test('HTML local script and manifest references resolve', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)=["'](\.{1,2}\/[^"']+)["']/g)]
    .map((match) => match[1])
    .filter((ref) => !/^\.\.\//.test(ref));
  for (const ref of refs) {
    const localPath = ref.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!localPath || localPath.startsWith('#')) continue;
    assert.ok(fs.existsSync(path.join(root, localPath)), `Missing local reference: ${ref}`);
  }
});

test('exercise knowledge base classifies and indexes supplied catalog entries', () => {
  const context = { Object, Array, String, RegExp };
  vm.runInNewContext(read('exercise-knowledge-base.js'), context);
  const db = context.IronExerciseKB.buildDatabase([
    { g: 'chest', n: 'Bench Press', e: 'Barbell' },
    { g: 'arms', n: 'Bicep Curl', e: 'Dumbbell' }
  ]);
  assert.equal(db['chest|bench press'].category, 'compound');
  assert.equal(db['arms|bicep curl'].category, 'isolation');
});

test('intelligence engine exposes its report generator and handles empty history', () => {
  const engine = require(path.join(root, 'iron-intelligence-engine.js'));
  assert.equal(typeof engine.generateReport, 'function');
  const report = engine.generateReport({}, { asOf: new Date('2026-11-11T12:00:00Z') });
  assert.ok(report && typeof report === 'object');
});

test('service worker only removes its own old caches and scopes requests', () => {
  const sw = read('sw.js');
  assert.match(sw, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(sw, /url\.pathname\.startsWith\(scope\.pathname\)/);
  assert.match(sw, /request\.headers\.has\('authorization'\)/);
  assert.ok(sw.includes("await cache.put('./index.html'"));
});

test('platform modules are wired into navigation and cached for offline use', () => {
  const html = read('index.html');
  const platform = read('iron-log-platform.js');
  const sw = read('sw.js');
  for (const view of ['nutrition','recovery','body','intelligence']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, new RegExp(`id="view-${view}"`));
  }
  assert.match(html, /src="iron-log-platform\.js"/);
  assert.match(sw, /'\.\/iron-log-platform\.js'/);
  for (const id of ['saveRecovery','saveBodyMeasurement','addFoodBtn','refreshIntelligence']) {
    assert.match(platform, new RegExp(id));
  }
});

test('workout history sync uses per-day documents and removes legacy field only after writes', () => {
  const html = read('index.html');
  assert.match(html, /collection\('workoutDays'\)/);
  assert.match(html, /await Promise\.all\(batch\.map/);
  assert.match(html, /FieldValue\.delete\(\)/);
  assert.ok(html.indexOf('await Promise.all(batch.map') < html.indexOf('FieldValue.delete()'));
});

test('platform data uses per-user Firestore subcollections and queues offline writes', () => {
  const platform = read('iron-log-platform.js');
  assert.match(platform, /collection\('fitnessModules'\)/);
  assert.match(platform, /ironlog_platform_pending_v1/);
  assert.match(platform, /addEventListener\('online'/);
});

test('platform JavaScript DOM selectors all resolve to declared HTML ids', () => {
  const html = read('index.html');
  const platform = read('iron-log-platform.js');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...platform.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of refs) assert.ok(ids.has(id), `Missing DOM id: ${id}`);
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(allIds).size, allIds.length, 'HTML contains duplicate ids');
});


test('advanced training lab includes templates, supersets, RPE and RIR capture', () => {
  const html = read('index.html');
  const js = read('iron-log-advanced.js');
  for (const id of ['view-traininglab','templateName','templateExercises','advancedTemplateList','advancedSessionEditor']) assert.match(html, new RegExp(`id="${id}"`));
  for (const field of ['weight','reps','rpe','rir','superset']) assert.ok(js.includes(field));
  assert.match(js, /collection\('fitnessModules'\)/);
});

test('barcode lookup and camera scanning are optional and use Open Food Facts', () => {
  const html = read('index.html');
  const js = read('iron-log-advanced.js');
  assert.match(html, /id="foodBarcode"/);
  assert.match(html, /id="foodScanBtn"/);
  assert.match(js, /world\.openfoodfacts\.org\/api\/v2\/product/);
  assert.match(js, /BarcodeDetector/);
});

test('progress photos use IndexedDB and cloud upload requires explicit opt-in', () => {
  const html = read('index.html');
  const js = read('iron-log-advanced.js');
  assert.match(html, /id="photoCloudConsent" type="checkbox"/);
  assert.match(js, /indexedDB\.open\('iron-log-private-media'/);
  assert.match(js, /if\(\$\('photoCloudConsent'\)\.checked\)/);
  assert.match(js, /progressPhotos/);
});

test('AI coach proxy verifies Firebase identity and keeps provider key server-side', () => {
  const js = read('iron-log-advanced.js');
  const server = read('server/coach-api.mjs');
  assert.match(js, /getIdToken\(\)/);
  assert.match(server, /verifyIdToken/);
  assert.match(server, /COACH_PROVIDER_API_KEY/);
  assert.doesNotMatch(js, /COACH_PROVIDER_API_KEY/);
});

test('health import bridge is present and documents native API boundary', () => {
  const html = read('index.html');
  const js = read('iron-log-advanced.js');
  const docs = read('docs/HEALTH-INTEGRATIONS.md');
  assert.match(html, /id="healthImportFile"/);
  assert.match(js, /importHealthRecords/);
  assert.match(docs, /cannot directly query Apple HealthKit or Android Health Connect/);
});

test('advanced script is loaded and precached by the service worker', () => {
  assert.match(read('index.html'), /src="iron-log-advanced\.js"/);
  assert.match(read('sw.js'), /'\.\/iron-log-advanced\.js'/);
});


test('time-series module sync uses per-day Firestore documents', () => {
  const platform = read('iron-log-platform.js');
  for (const collection of ['nutritionDays','recoveryDays','bodyMeasurementDays']) assert.ok(platform.includes(collection));
  assert.match(platform, /Promise\.all\(dates\.map/);
  assert.match(platform, /fitnessModules'\)\.doc\(id\)\.delete/);
});

test('advanced training history is stored per date, templates separately', () => {
  const js = read('iron-log-advanced.js');
  assert.match(js, /advancedTrainingDays/);
  assert.match(js, /advancedTemplates/);
});

test('AI coach preflight permits the Firebase bearer token and provider calls time out', () => {
  const server = read('server/coach-api.mjs');
  assert.match(server, /access-control-allow-headers':'content-type, authorization'/);
  assert.match(server, /AbortSignal\.timeout\(30_000\)/);
  assert.doesNotMatch(server, /slice\(0,500\).*detail/);
});

test('advanced training uses local calendar dates and rejects invalid sets before saving', () => {
  const js = read('iron-log-advanced.js');
  assert.match(js, /getFullYear\(\).*getMonth\(\).*getDate\(\)/s);
  assert.match(js, /for\(const input of inputs\).*No changes were saved/s);
  assert.match(js, /for\(const input of inputs\).*session\.updatedAt/s);
});

test('barcode lookup refuses incomplete nutrient records instead of logging missing values as zero', () => {
  const js = read('iron-log-advanced.js');
  assert.match(js, /Object\.values\(per100\)\.every\(v=>v!==null&&Number\.isFinite\(v\)&&v>=0\)/);
  assert.match(js, /Cannot add this product: one or more required nutrition values are missing/);
});

test('cloud restore merges local-only nutrition, recovery and body entries with cloud records', () => {
  const js = read('iron-log-platform.js');
  assert.match(js, /Preserve device-only\/offline records/);
  assert.match(js, /new Map\(localRows\.map/);
  assert.match(js, /recovery=merged;write\(dbKey\[id\],recovery\)/);
  assert.match(js, /body=merged;write\(dbKey\[id\],body\)/);
});

test('service worker cache version changes when the implementation bundle changes', () => {
  assert.match(read('sw.js'), /v1\.4\.1/);
  const sw = read('sw.js');
  for (const asset of ['./iron-log-platform.js','./iron-log-advanced.js','./exercise-knowledge-base.js']) {
    assert.ok(sw.includes(`'${asset}'`), `Service worker missing ${asset}`);
    assert.ok(fs.existsSync(path.join(root, asset.slice(2))), `Missing cached asset ${asset}`);
  }
});

test('coach API rejects unconfigured cross-origin requests and handles oversized bodies explicitly', () => {
  const server = read('server/coach-api.mjs');
  assert.match(server, /!ORIGIN \|\| requestOrigin!==ORIGIN/);
  assert.match(server, /status:413/);
  assert.match(server, /error\.status\|\|/);
  assert.match(server, /Coach provider timed out/);
});

test('fresh Firestore collections receive existing local module data and targets', () => {
  const js = read('iron-log-platform.js');
  assert.match(js, /else cloudSave\('targets',targets\)/);
  assert.match(js, /else \{const localData=id==='nutrition'\?nutrition:id==='recovery'\?recovery:body/);
  assert.match(js, /if\(Object\.keys\(localData\|\|\{\}\)\.length\)cloudSave\(id,localData\)/);
});
