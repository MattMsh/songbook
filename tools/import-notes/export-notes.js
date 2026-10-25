// Exports an Apple Notes folder (with subfolders) to HTML, one file per note.
// Usage: osascript -l JavaScript export-notes.js "Пісні" ./notes-export
ObjC.import('Foundation');

function run(argv) {
  const folderName = argv[0];
  if (!folderName) throw new Error('Usage: osascript -l JavaScript export-notes.js "<folder>" [outDir]');
  const fm = $.NSFileManager.defaultManager;
  const cwd = fm.currentDirectoryPath.js;
  let outDir = argv[1] || './notes-export';
  if (!outDir.startsWith('/')) outDir = cwd + '/' + outDir;

  const Notes = Application('Notes');
  let folder = null;
  for (const account of Notes.accounts()) {
    folder = findFolder(account.folders(), folderName);
    if (folder) break;
  }
  if (!folder) throw new Error('Folder not found: ' + folderName);

  let count = 0;
  const exportFolder = (f, dir) => {
    fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(dir), true, $(), null);
    const used = new Set();
    for (const note of f.notes()) {
      const title = note.name();
      let base = safeName(title);
      for (let i = 2; used.has(base.toLowerCase()); i++) base = safeName(title) + ' (' + i + ')';
      used.add(base.toLowerCase());
      const html = '<!-- title: ' + title.replace(/--/g, '—') + ' -->\n' + note.body();
      const ok = $(html).writeToFileAtomicallyEncodingError($(dir + '/' + base + '.html'), true, $.NSUTF8StringEncoding, null);
      if (!ok) throw new Error('Cannot write ' + dir + '/' + base + '.html');
      count++;
    }
    for (const sub of f.folders()) exportFolder(sub, dir + '/' + safeName(sub.name()));
  };
  exportFolder(folder, outDir);
  return 'Exported ' + count + ' notes to ' + outDir;
}

function findFolder(folders, name) {
  for (const f of folders) {
    if (f.name() === name) return f;
    const nested = findFolder(f.folders(), name);
    if (nested) return nested;
  }
  return null;
}

function safeName(s) {
  return s.replace(/[\/\\:*?"<>|\r\n\t]+/g, '_').replace(/^\.+/, '').trim().slice(0, 100) || 'note';
}
