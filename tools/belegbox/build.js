// Fasst alle .gs-Dateien zu dist/Code.gs zusammen, damit man im Apps-Script-Editor
// nur drei Dateien einfügen muss: Code.gs, Index.html, appsscript.json.
// Ausführen: node tools/belegbox/build.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const dist = path.join(dir, 'dist');
const reihenfolge = ['Logic.gs', 'Config.gs', 'Setup.gs', 'Extract.gs', 'Currency.gs', 'Store.gs', 'Gmail.gs', 'Export.gs', 'WebApp.gs'];
const vorhanden = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort();
const fehlt = vorhanden.filter(f => !reihenfolge.includes(f));
if (fehlt.length) throw new Error('Nicht in der Reihenfolge eingetragen: ' + fehlt.join(', '));

function baue() {
  const teile = reihenfolge.map(f => '// ===== ' + f + ' =====\n\n' + fs.readFileSync(path.join(dir, f), 'utf8').trim() + '\n');
  return '// PLANEGY Belegbox – automatisch erzeugt aus tools/belegbox/*.gs (node tools/belegbox/build.js). Nicht von Hand ändern.\n\n' +
    teile.join('\n');
}

if (require.main === module) {
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'Code.gs'), baue());
  fs.copyFileSync(path.join(dir, 'Index.html'), path.join(dist, 'Index.html'));
  fs.copyFileSync(path.join(dir, 'appsscript.json'), path.join(dist, 'appsscript.json'));
  console.log('dist/Code.gs, dist/Index.html, dist/appsscript.json geschrieben');
}

module.exports = { baue };
