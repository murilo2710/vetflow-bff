// Testes unitários de arquitetura: leem os imports de todos os arquivos de src/
// e falham se uma regra da Clean Architecture ou do Vertical Slice for quebrada.
// Mesmo papel do ArchUnit (Java) / NetArchTest (.NET), escrito com node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

// ---- configuração específica deste serviço ----
const FRAMEWORK_PACKAGES = ['express'];          // só a camada API pode importar
const MIN_FEATURES = 3;
// -----------------------------------------------

const SRC = resolve(import.meta.dirname, '../../src');
const toPosix = (p) => p.split(sep).join('/');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

const graph = walk(SRC).filter((f) => f.endsWith('.js')).map((abs) => {
  const source = readFileSync(abs, 'utf8');
  const imports = [...source.matchAll(IMPORT_RE)].map((m) => m[1] || m[2] || m[3]).map((spec) =>
    spec.startsWith('.')
      ? { internal: true, path: toPosix(relative(SRC, resolve(dirname(abs), spec))) }
      : { internal: false, path: spec });
  return { file: toPosix(relative(SRC, abs)), imports };
});

const layerOf = (path) => path.split('/')[0];
const featureOf = (path) => {
  const m = path.match(/^(application|api)\/features\/([^/]+)\//);
  return m ? m[2] : null;
};
const inLayer = (layer) => graph.filter((g) => layerOf(g.file) === layer);

test('existem as quatro camadas da Clean Architecture', () => {
  for (const layer of ['domain', 'application', 'infrastructure', 'api']) {
    assert.ok(existsSync(join(SRC, layer)), `pasta src/${layer} não existe`);
  }
});

test('Domain não depende de nenhuma outra camada nem de bibliotecas', () => {
  for (const { file, imports } of inLayer('domain')) {
    for (const imp of imports) {
      assert.ok(imp.internal && layerOf(imp.path) === 'domain', `${file} importa ${imp.path}`);
    }
  }
});

test('Application depende apenas de Domain (sem Infrastructure, API ou bibliotecas)', () => {
  for (const { file, imports } of inLayer('application')) {
    for (const imp of imports) {
      assert.ok(imp.internal, `${file} importa o pacote ${imp.path}`);
      assert.ok(['domain', 'application'].includes(layerOf(imp.path)), `${file} importa ${imp.path}`);
    }
  }
});

test('Vertical Slice: uma feature não importa outra feature', () => {
  for (const { file, imports } of graph) {
    const own = featureOf(file);
    if (!own) continue;
    for (const imp of imports.filter((i) => i.internal)) {
      const target = featureOf(imp.path);
      assert.ok(!target || target === own, `${file} (feature ${own}) importa a feature ${target}`);
    }
  }
});

test('API não depende de Infrastructure (as implementações chegam por injeção)', () => {
  for (const { file, imports } of inLayer('api')) {
    for (const imp of imports.filter((i) => i.internal)) {
      assert.notEqual(layerOf(imp.path), 'infrastructure', `${file} importa ${imp.path}`);
    }
  }
});

test('Infrastructure não depende de API nem de Application', () => {
  for (const { file, imports } of inLayer('infrastructure')) {
    for (const imp of imports.filter((i) => i.internal)) {
      assert.ok(!['api', 'application'].includes(layerOf(imp.path)), `${file} importa ${imp.path}`);
    }
  }
});

test('frameworks web só aparecem na camada API', () => {
  for (const { file, imports } of graph) {
    for (const imp of imports.filter((i) => !i.internal && FRAMEWORK_PACKAGES.some((p) => i.path === p || i.path.startsWith(`${p}/`)))) {
      assert.equal(layerOf(file), 'api', `${file} importa ${imp.path}`);
    }
  }
});

test('somente o composition root (main.js) monta as implementações de Infrastructure', () => {
  const outsiders = graph
    .filter((g) => !['infrastructure', 'main.js'].includes(layerOf(g.file)))
    .filter((g) => g.imports.some((i) => i.internal && layerOf(i.path) === 'infrastructure'));
  assert.deepEqual(outsiders.map((g) => g.file), []);
});

test('cada feature tem handler (Application) e endpoint (API) com o mesmo nome', () => {
  const appFeatures = readdirSync(join(SRC, 'application/features')).sort();
  const apiFeatures = readdirSync(join(SRC, 'api/features')).sort();
  assert.ok(appFeatures.length >= MIN_FEATURES, `esperado pelo menos ${MIN_FEATURES} features`);
  assert.deepEqual(apiFeatures, appFeatures);
  for (const feature of appFeatures) {
    assert.ok(existsSync(join(SRC, 'application/features', feature, 'handler.js')), `${feature} sem handler.js`);
    assert.ok(existsSync(join(SRC, 'api/features', feature, 'endpoint.js')), `${feature} sem endpoint.js`);
  }
});
