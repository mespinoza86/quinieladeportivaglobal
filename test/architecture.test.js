'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migrator = fs.readFileSync(path.join(root, 'scripts', 'migrate-legacy.js'), 'utf8');

test('el servidor solo acepta la URI multi-quiniela', () => {
  assert.match(server, /process\.env\.MONGO_URI_MULTIQUINIELA/);
  assert.doesNotMatch(server, /mongoose\.connect\(process\.env\.MONGO_URI\)/);
  assert.match(server, /Por seguridad no se utilizará MONGO_URI/);
});

test('los modelos deportivos reciben aislamiento por quiniela', () => {
  for (const schema of [
    'JugadorSchema', 'JornadaSchema', 'ResultadoSchema', 'ResultadoOficialSchema',
    'triviaSchema', 'respuestaTriviaSchema', 'EquipoSchema',
    'PronosticoCampeonSchema', 'CampeonOficialSchema'
  ]) {
    assert.match(server, new RegExp(`\\b${schema}\\b`));
  }
  assert.match(server, /\.forEach\(tenantPlugin\)/);
  assert.match(server, /this\.where\(\{ quinielaId: store\.quinielaId \}\)/);
});

test('existen las rutas principales de cuenta y membresía', () => {
  for (const route of [
    '/api/auth/registro', '/api/auth/login', '/api/quinielas',
    '/api/quinielas/unirse', '/api/quiniela-actual/miembros',
    '/api/quiniela-actual/transferir-propiedad', '/api/quiniela-actual/configuracion'
  ]) assert.ok(server.includes(route), `Falta ${route}`);
});

test('la migración es simulación por defecto y separa origen de destino', () => {
  assert.match(migrator, /process\.argv\.includes\('--execute'\)/);
  assert.match(migrator, /MONGO_URI_LEGACY_READONLY/);
  assert.match(migrator, /LEGACY_DB_NAME y TARGET_DB_NAME deben ser diferentes/);
  assert.match(migrator, /No se escribió ningún documento/);
});

test('todas las referencias locales JS y CSS de HTML existen', () => {
  const pages = fs.readdirSync(path.join(root, 'public')).filter(file => file.endsWith('.html'));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)) {
      const url = match[1];
      if (/^https?:/.test(url)) continue;
      const relative = url.replace(/^\//, '');
      const file = relative.startsWith('js/') || relative.startsWith('css/')
        ? path.join(root, 'private', relative)
        : path.join(root, 'public', relative);
      assert.ok(fs.existsSync(file), `${page} referencia un archivo ausente: ${url}`);
    }
  }
});
