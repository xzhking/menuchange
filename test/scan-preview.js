'use strict';

/**
 * node test/scan-preview.js [菜单id]
 * 只读预览：把某个右键菜单里所有扩展贡献的命令列出来，
 * 也就是 Menu Pinner 的“选择命令”列表里会出现什么。
 */

const fs = require('fs');
const path = require('path');
const U = require('../lib/manifest-utils');
const NLS = require('../lib/nls');

const menu = process.argv[2] || 'editor/context';
const locale = process.argv[3] || 'zh-cn';
const dir = path.join(process.env.USERPROFILE || process.env.HOME, '.vscode', 'extensions');

const rows = [];
for (const d of fs.readdirSync(dir)) {
  if (d.startsWith('.')) continue;
  const manifest = path.join(dir, d, 'package.json');
  if (!fs.existsSync(manifest)) continue;
  const text = fs.readFileSync(manifest, 'utf8');
  if (!U.isValidJson(text)) { console.log(`  (跳过，清单无法解析) ${d}`); continue; }
  let entries = [];
  try { entries = U.listMenuEntries(text, menu); } catch { continue; }
  for (const e of entries) {
    if (!e.command) continue;
    rows.push({
      ext: d,
      cmd: e.command,
      title: NLS.displayTitle(manifest, U.findCommandTitle(text, e.command), locale, e.command),
      group: e.group,
      when: e.when,
    });
  }
}

rows.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
console.log(`${menu}：共 ${rows.length} 项（来自 ${new Set(rows.map((r) => r.ext)).size} 个扩展）\n`);
for (const r of rows) {
  console.log(`  ${r.title}`);
  console.log(`      ext=${r.ext}  group=${r.group ?? '(无)'}  when=${r.when ?? '(无)'}`);
}
