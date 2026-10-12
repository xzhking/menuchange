'use strict';

/**
 * Menu Pinner —— 把任意命令固定到 VS Code 右键菜单顶部，或隐藏不需要的菜单项。
 *
 * 原理（VS Code 1.7x~1.14x 实测）：
 *   1. 右键菜单里 `group === "navigation"` 的项永远排在最前；
 *   2. 同组内按 `group@<order>` 的数字升序，没用过 @ 的按 0 处理；
 *   3. 所以 `group: "navigation@-1000"` 就等价于“置顶”（内置项最小 order 实测为 -11）。
 *
 * 菜单顺序是扩展清单（package.json）里的静态贡献，运行时无法用 API 改，
 * 因此本扩展的做法是：改写“贡献这个菜单项的那个扩展”的清单里的 group，
 * 并保留 <package.json>.menuPinner.bak 备份与可逆的记录。改完必须重启 VS Code。
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const U = require('./lib/manifest-utils');
const NLS = require('./lib/nls');

const SELF_ID = 'menuchange.menu-pinner';
const BAK_SUFFIX = '.menuPinner.bak';
const TOP_ORDER_BASE = -1000;

const MENUS = [
  { id: 'editor/context', label: '编辑器内右键菜单' },
  { id: 'explorer/context', label: '资源管理器右键菜单' },
  { id: 'editor/title/context', label: '编辑器标签页右键菜单' },
  { id: 'terminal/context', label: '终端右键菜单' },
];

let out;
let store;

function log(...a) {
  const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${a.map(String).join(' ')}`;
  if (out) out.appendLine(line);
}

function menuLabel(id) {
  const m = MENUS.find((x) => x.id === id);
  return m ? m.label : id;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ------------------------------------------------------------------ 文件读写

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return undefined; }
}

function atomicWrite(p, text) {
  const tmp = `${p}.menuPinner.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch {
    fs.copyFileSync(tmp, p);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function ownManifestPath() {
  const ext = vscode.extensions.getExtension(SELF_ID);
  return path.join(ext.extensionPath, 'package.json');
}

/** 扩展是否属于 VS Code 自带（装在安装目录里，不去改它的清单） */
function isBuiltinPath(p) {
  const root = vscode.env.appRoot;
  return !!root && p.toLowerCase().startsWith(root.toLowerCase());
}

// ------------------------------------------------------------------ 状态

class Store {
  constructor(context) {
    this.dir = context.globalStorageUri.fsPath;
    this.file = path.join(this.dir, 'pins.json');
    this.data = { version: 1, changes: [], backups: {} };
  }

  load() {
    const t = readText(this.file);
    if (!t) return;
    try {
      const d = JSON.parse(U.stripBom(t));
      this.data = { version: 1, changes: (d && d.changes) || [], backups: (d && d.backups) || {} };
    } catch (e) {
      log('状态文件解析失败（已忽略，不会影响 VS Code）: ' + e.message);
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    atomicWrite(this.file, JSON.stringify(this.data, null, 2) + '\n');
  }

  pinsIn(menuId) {
    return this.data.changes.filter((c) => c.kind === 'pin' && c.menu === menuId);
  }

  /** 新的置顶项排在最上面：取当前最小 order 再减一 */
  nextOrder(menuId) {
    const orders = this.pinsIn(menuId).map((c) => c.order).filter((n) => typeof n === 'number');
    return orders.length ? Math.min(...orders) - 1 : TOP_ORDER_BASE;
  }

  /** 确保有备份，返回备份路径 */
  ensureBackup(manifest) {
    const known = this.data.backups[manifest];
    if (known && fs.existsSync(known)) return known;
    const target = manifest + BAK_SUFFIX;
    if (!fs.existsSync(target)) fs.copyFileSync(manifest, target);
    this.data.backups[manifest] = target;
    return target;
  }
}

// ------------------------------------------------------------------ 扫描菜单项

/** 扫描所有已装扩展，找出它们在某个菜单里贡献的命令 */
function scanMenu(menuId) {
  const found = new Map();
  for (const ext of vscode.extensions.all) {
    if (ext.id === SELF_ID) continue;
    const manifest = path.join(ext.extensionPath, 'package.json');
    const text = readText(manifest);
    if (!text || !U.isValidJson(text)) continue;
    let entries;
    try { entries = U.listMenuEntries(text, menuId); } catch { continue; }
    for (const e of entries) {
      if (!e.command) continue;
      const key = `${ext.id}|${e.command}`;
      const cur = found.get(key);
      if (cur) { cur.whens.push(e.when); if (cur.group === undefined) cur.group = e.group; continue; }
      found.set(key, {
        extId: ext.id,
        manifest,
        builtin: isBuiltinPath(ext.extensionPath),
        command: e.command,
        title: NLS.displayTitle(manifest, U.findCommandTitle(text, e.command), vscode.env.language, e.command),
        group: e.group,
        whens: [e.when],
      });
    }
  }
  return [...found.values()];
}

function locateCommand(menuId, command) {
  const own = scanMenu(menuId).filter((c) => c.command === command);
  if (!own.length) return undefined;
  return own.find((c) => !c.builtin) || own[0];
}

/** 该命令出现在哪些菜单里（用于给出手动输入时的提示） */
function findCommandMenus(command) {
  const menus = new Set();
  for (const ext of vscode.extensions.all) {
    if (ext.id === SELF_ID) continue;
    const text = readText(path.join(ext.extensionPath, 'package.json'));
    if (!text || !U.isValidJson(text)) continue;
    try {
      for (const e of U.findAllCommandEntries(text, command)) menus.add(e.menuId);
    } catch { /* ignore */ }
  }
  return [...menus];
}

// ------------------------------------------------------------------ 选择器

async function pickMenu(title) {
  const pick = await vscode.window.showQuickPick(
    MENUS.map((m) => ({ label: m.label, description: m.id, id: m.id })),
    { title, placeHolder: '要改哪个菜单？', ignoreFocusOut: true }
  );
  return pick ? pick.id : undefined;
}

async function pickCommand(menuId, action) {
  const cands = scanMenu(menuId);
  const items = cands.map((c) => ({
    label: c.title,
    description: c.extId + (c.builtin ? '（VS Code 自带扩展）' : ''),
    detail: `${c.command}${c.whens.length > 1 ? `　（${c.whens.length} 个显示条件）` : ''}`,
    info: { manifest: c.manifest, extId: c.extId, builtin: c.builtin, command: c.command, title: c.title },
  }));
  items.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
  items.unshift({ label: '$(edit) 手动输入命令 ID…', description: '列表里找不到时用这个', manual: true });

  const pick = await vscode.window.showQuickPick(items, {
    title: `${action}：选择命令（${menuLabel(menuId)}，共 ${cands.length} 项）`,
    placeHolder: '输入关键字过滤，例如 live server、run code',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!pick) return undefined;
  if (!pick.manual) return pick.info;

  const typed = await vscode.window.showInputBox({
    title: `${action}：命令 ID`,
    prompt: '例如 extension.liveServer.goOnline、editor.action.formatDocument',
    ignoreFocusOut: true,
  });
  if (!typed || !typed.trim()) return undefined;
  const command = typed.trim();

  const located = locateCommand(menuId, command);
  if (located) return { ...located, title: located.title || command };

  const elsewhere = findCommandMenus(command);
  if (elsewhere.length) {
    await vscode.window.showWarningMessage(
      `「${command}」没有出现在${menuLabel(menuId)}里，它只出现在：${elsewhere.map(menuLabel).join('、')}。请改选对应的菜单。`
    );
    return undefined;
  }
  // 找不到贡献者：多半是 VS Code 内置命令 → 走自身清单
  return { manifest: undefined, extId: '(builtin)', builtin: true, command, title: command };
}

// ------------------------------------------------------------------ 应用改动

/**
 * 记录“原始值”：优先从备份里读，这样即使清单之前被别人（或手工）改过，
 * 还原时也能回到真正的原始状态。
 */
function originalFrom(basis, menuId, command, entry) {
  let base = [];
  try { base = U.findCommandEntries(basis, menuId, command); } catch { base = []; }
  let m = entry.when !== undefined ? base.find((x) => x.when === entry.when) : undefined;
  if (!m && base.length === 1) m = base[0];
  if (!m) m = base[0];
  return {
    when: entry.when ?? null,
    hadWhen: entry.when !== undefined,
    group: m ? (m.group ?? null) : (entry.group ?? null),
    hadGroup: m ? (m.group !== undefined) : (entry.group !== undefined),
  };
}

function logDiff(before, after, file) {
  const diffs = U.diffLines(before, after);
  log(`${path.basename(file)}：改动 ${diffs.length} 行`);
  for (const d of diffs) log(`   L${d.line}  ${(d.before || '').trim()}  →  ${(d.after || '').trim()}`);
}

async function applyPinToExtension(menuId, info) {
  const text = readText(info.manifest);
  if (text === undefined) {
    vscode.window.showErrorMessage(`读不到清单文件：${info.manifest}`);
    return false;
  }
  const entries = U.findCommandEntries(text, menuId, info.command);
  if (!entries.length) {
    vscode.window.showErrorMessage(`在 ${menuId} 里找不到命令 ${info.command} 的菜单项。`);
    return false;
  }
  const order = store.nextOrder(menuId);
  const bak = store.ensureBackup(info.manifest);
  const basis = readText(bak) || text;

  let next;
  try {
    next = U.applyEntryChanges(
      text,
      entries.map((e) => ({ entry: e, key: 'group', value: `navigation@${order}` }))
    );
  } catch (e) {
    vscode.window.showErrorMessage('改写失败，文件未修改：' + e.message);
    return false;
  }

  atomicWrite(info.manifest, next);
  logDiff(text, next, info.manifest);
  if (next === text) log('（该菜单项已经是这个位置，内容无变化）');

  store.data.changes = store.data.changes.filter(
    (c) => !(c.kind === 'pin' && c.menu === menuId && c.command === info.command && c.target.manifest === info.manifest)
  );
  store.data.changes.push({
    id: uid(),
    kind: 'pin',
    menu: menuId,
    command: info.command,
    title: info.title,
    extId: info.extId,
    order,
    target: { type: 'extension', manifest: info.manifest },
    entries: entries.map((e) => originalFrom(basis, menuId, info.command, e)),
  });
  store.save();
  return true;
}

async function applyPinBuiltin(menuId, info) {
  const when = await vscode.window.showInputBox({
    title: `置顶「${info.title}」（VS Code 内置命令）`,
    prompt:
      '显示条件（when）。留空 = 始终显示。注意：内置命令的原始菜单项无法隐藏，' +
      '置顶后菜单里会同时存在两项。',
    placeHolder: '例如 resourceLangId == html',
    value: '',
    ignoreFocusOut: true,
  });
  if (when === undefined) return false;

  const order = store.nextOrder(menuId);
  store.data.changes = store.data.changes.filter(
    (c) => !(c.kind === 'pin' && c.menu === menuId && c.command === info.command && c.target.type === 'builtin')
  );
  store.data.changes.push({
    id: uid(),
    kind: 'pin',
    menu: menuId,
    command: info.command,
    title: info.title,
    extId: info.extId || '(builtin)',
    order,
    target: { type: 'builtin', manifest: ownManifestPath() },
    builtinWhen: when.trim() || 'true',
    entries: [],
  });
  regenerateOwnManifest();
  store.save();
  return true;
}

async function applyHide(menuId, info) {
  if (info.builtin) {
    vscode.window.showInformationMessage('VS Code 内置命令的菜单项藏在程序本体里，本扩展无法隐藏它。');
    return false;
  }
  const text = readText(info.manifest);
  if (text === undefined) {
    vscode.window.showErrorMessage(`读不到清单文件：${info.manifest}`);
    return false;
  }
  const entries = U.findCommandEntries(text, menuId, info.command);
  if (!entries.length) {
    vscode.window.showErrorMessage(`在 ${menuId} 里找不到命令 ${info.command} 的菜单项。`);
    return false;
  }
  const bak = store.ensureBackup(info.manifest);
  const basis = readText(bak) || text;

  let next;
  try {
    next = U.applyEntryChanges(text, entries.map((e) => ({ entry: e, key: 'when', value: 'false' })));
  } catch (e) {
    vscode.window.showErrorMessage('改写失败，文件未修改：' + e.message);
    return false;
  }
  atomicWrite(info.manifest, next);
  logDiff(text, next, info.manifest);

  store.data.changes = store.data.changes.filter(
    (c) => !(c.kind === 'hide' && c.menu === menuId && c.command === info.command && c.target.manifest === info.manifest)
  );
  store.data.changes.push({
    id: uid(),
    kind: 'hide',
    menu: menuId,
    command: info.command,
    title: info.title,
    extId: info.extId,
    target: { type: 'extension', manifest: info.manifest },
    entries: entries.map((e) => originalFrom(basis, menuId, info.command, e)),
  });
  store.save();
  return true;
}

/** 把内置命令的置顶项写进本扩展自己的清单（contributes.menus 完全由状态文件生成） */
function regenerateOwnManifest() {
  const p = ownManifestPath();
  const text = readText(p);
  if (text === undefined) return false;
  let json;
  try { json = U.readJson(text); } catch (e) { log('自身清单解析失败：' + e.message); return false; }
  json.contributes = json.contributes || {};
  const menus = {};
  for (const c of store.data.changes) {
    if (c.kind !== 'pin' || c.target.type !== 'builtin') continue;
    (menus[c.menu] = menus[c.menu] || []).push({
      command: c.command,
      group: `navigation@${c.order}`,
      when: c.builtinWhen || 'true',
    });
  }
  json.contributes.menus = menus;
  atomicWrite(p, JSON.stringify(json, null, '\t') + '\n');
  log(`自身清单的置顶项已更新：${JSON.stringify(menus)}`);
  return true;
}

// ------------------------------------------------------------------ 还原

function restoreChange(change) {
  if (change.target.type === 'builtin') {
    store.data.changes = store.data.changes.filter((c) => c.id !== change.id);
    regenerateOwnManifest();
    store.save();
    return { ok: true, detail: '已从自身清单移除' };
  }
  const text = readText(change.target.manifest);
  if (text === undefined) {
    store.data.changes = store.data.changes.filter((c) => c.id !== change.id);
    store.save();
    return { ok: false, detail: '清单文件不存在（扩展可能已卸载），仅清除了记录' };
  }
  let entries;
  try { entries = U.findCommandEntries(text, change.menu, change.command); } catch (e) { return { ok: false, detail: e.message }; }

  const changes = [];
  let missed = 0;
  change.entries.forEach((orig, idx) => {
    let e = orig.hadWhen && orig.when ? entries.find((x) => x.when === orig.when) : undefined;
    if (!e) e = entries[idx];
    if (!e) { missed++; return; }
    if (change.kind === 'pin') {
      changes.push(orig.hadGroup
        ? { entry: e, key: 'group', value: orig.group }
        : { entry: e, key: 'group', remove: true });
    } else {
      changes.push(orig.hadWhen
        ? { entry: e, key: 'when', value: orig.when }
        : { entry: e, key: 'when', remove: true });
    }
  });

  if (changes.length) {
    let next;
    try { next = U.applyEntryChanges(text, changes); } catch (e) { return { ok: false, detail: e.message }; }
    atomicWrite(change.target.manifest, next);
    logDiff(text, next, change.target.manifest);
  }
  store.data.changes = store.data.changes.filter((c) => c.id !== change.id);
  store.save();
  return { ok: true, detail: missed ? `已还原，但有 ${missed} 处没找到（可能已被扩展更新改动）` : '已还原' };
}

function isApplied(change) {
  if (change.kind === 'pin') {
    const key = 'group';
    const value = `navigation@${change.order}`;
    const file = change.target.type === 'builtin' ? ownManifestPath() : change.target.manifest;
    const text = readText(file);
    if (text === undefined) return false;
    try { return U.findCommandEntries(text, change.menu, change.command).some((e) => e[key] === value); } catch { return false; }
  }
  if (change.target.type === 'builtin') return true;
  const text = readText(change.target.manifest);
  if (text === undefined) return false;
  try { return U.findCommandEntries(text, change.menu, change.command).some((e) => e.when === 'false'); } catch { return false; }
}

function checkDrift() {
  return store.data.changes.filter((c) => !isApplied(c));
}

function reapplyAll() {
  let done = 0;
  const failed = [];
  for (const c of store.data.changes) {
    if (c.target.type === 'builtin') continue;
    const text = readText(c.target.manifest);
    if (text === undefined) { failed.push(c); continue; }
    let entries;
    try { entries = U.findCommandEntries(text, c.menu, c.command); } catch { entries = []; }
    if (!entries.length) { failed.push(c); continue; }
    const key = c.kind === 'pin' ? 'group' : 'when';
    const value = c.kind === 'pin' ? `navigation@${c.order}` : 'false';
    let next;
    try { next = U.applyEntryChanges(text, entries.map((e) => ({ entry: e, key, value }))); }
    catch { failed.push(c); continue; }
    if (next !== text) {
      atomicWrite(c.target.manifest, next);
      logDiff(text, next, c.target.manifest);
    }
    done++;
  }
  const ownChanged = regenerateOwnManifest();
  store.save();
  return { done, failed, ownChanged };
}

// ------------------------------------------------------------------ 重启提示

/**
 * 只能提示用户手动重启，不再尝试自动重启。
 *
 * 试过两版自动重启，都不成立：
 *   1. `cmd /c "ping -n 3 & start Code.exe"`：固定延迟撞上单实例锁，
 *      老实例没退干净时新实例会“转发给已有实例”后自己退出，VS Code 关了却没起来；
 *   2. 独立 PowerShell 助手（等进程退出→拉起→确认→重试）：日志文件压根没生成。
 *      原因是 VS Code 用 Job Object 管理子进程并设置了 kill-on-job-close，
 *      VS Code 一退出就把助手一起杀掉（Node 的 detached:true 逃不出 Job）。
 *
 * 结论：自动拉起在 VS Code 下不可靠，改为明确提示，由用户自己完全退出再打开。
 */
async function notifyManualRestart(msg) {
  log(msg + '（需要手动重启 VS Code 才生效）');
  const pick = await vscode.window.showInformationMessage(
    `${msg}。\n请完全退出 VS Code（关闭所有窗口）后重新打开——Developer: Reload Window / Restart Extension Host 都不会重读扩展清单。`,
    '知道了',
    '看日志'
  );
  if (pick === '看日志') out.show();
}

// ------------------------------------------------------------------ 命令

async function cmdPinAtTop() {
  const menuId = await pickMenu('置顶：第 1 步 / 2');
  if (!menuId) return;
  const info = await pickCommand(menuId, '置顶');
  if (!info) return;
  const ok = info.builtin ? await applyPinBuiltin(menuId, info) : await applyPinToExtension(menuId, info);
  if (!ok) return;
  const rec = store.data.changes.find((c) => c.kind === 'pin' && c.menu === menuId && c.command === info.command);
  await notifyManualRestart(`已把「${info.title}」固定到${menuLabel(menuId)}顶部${rec ? `（order=${rec.order}）` : ''}`);
}

async function cmdHideItem() {
  const menuId = await pickMenu('隐藏：第 1 步 / 2');
  if (!menuId) return;
  const info = await pickCommand(menuId, '隐藏');
  if (!info) return;
  if (info.builtin) {
    vscode.window.showInformationMessage('VS Code 内置命令的菜单项无法隐藏，只能置顶。');
    return;
  }
  const ok = await applyHide(menuId, info);
  if (!ok) return;
  await notifyManualRestart(`已隐藏${menuLabel(menuId)}里的「${info.title}」`);
}

async function cmdManage() {
  if (!store.data.changes.length) {
    const pick = await vscode.window.showInformationMessage('目前没有任何菜单改动记录。', '打开状态文件');
    if (pick) await openStateFile();
    return;
  }
  const items = store.data.changes.map((c) => ({
    label: `${c.kind === 'pin' ? '$(arrow-up)' : '$(eye-closed)'} ${c.title || c.command}`,
    description: menuLabel(c.menu),
    detail: `${c.command}${c.kind === 'pin' ? `　order=${c.order}` : ''}　${c.target.type === 'builtin' ? '（内置命令：写在本扩展清单里）' : c.target.manifest}`,
    change: c,
  }));
  items.unshift({ label: '$(file) 打开状态文件 pins.json', description: '记录都在这里', open: true });

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: '已改动项（勾选后回车 = 还原）',
    placeHolder: '勾选要还原的项；只勾“打开状态文件”则只打开文件',
    ignoreFocusOut: true,
  });
  if (!picked || !picked.length) return;
  const targets = picked.filter((p) => p.change);
  if (!targets.length) { await openStateFile(); return; }

  const results = targets.map((p) => ({ title: p.change.title || p.change.command, r: restoreChange(p.change) }));
  const failed = results.filter((x) => !x.r.ok);
  log('还原结果：' + results.map((x) => `${x.title}: ${x.r.ok ? 'OK' : '失败'}（${x.r.detail}）`).join('；'));
  await notifyManualRestart(`已还原 ${results.length - failed.length} 项${failed.length ? `，${failed.length} 项失败（详见日志）` : ''}`);
}

async function cmdReapply() {
  if (!store.data.changes.length) {
    vscode.window.showInformationMessage('没有需要重新应用的改动。');
    return;
  }
  const r = reapplyAll();
  if (!r.done && !r.failed.length) { vscode.window.showInformationMessage('没有需要重新应用的改动。'); return; }
  await notifyManualRestart(`已重新应用 ${r.done} 项${r.failed.length ? `，${r.failed.length} 项失败（清单里找不到目标项）` : ''}`);
}

async function cmdRestoreAll() {
  if (!store.data.changes.length) {
    vscode.window.showInformationMessage('没有需要还原的改动。');
    return;
  }
  const yes = await vscode.window.showWarningMessage(
    `将按记录把 ${store.data.changes.length} 项菜单改动写回原值，是否继续？`,
    { modal: true },
    '还原'
  );
  if (yes !== '还原') return;
  const results = store.data.changes.map((c) => restoreChange(c));
  const okCount = results.filter((r) => r.ok).length;
  await notifyManualRestart(`已还原 ${okCount} / ${results.length} 项`);
}

async function cmdRestoreBackups() {
  const entries = Object.entries(store.data.backups).filter(([, bak]) => fs.existsSync(bak));
  if (!entries.length) {
    vscode.window.showInformationMessage('还没有任何备份文件（' + BAK_SUFFIX + '）。');
    return;
  }
  const list = entries.map(([m]) => `· ${m}`).join('\n');
  const yes = await vscode.window.showWarningMessage(
    `将用备份覆盖以下 ${entries.length} 个扩展清单（会连带撤销这些扩展被本扩展改过的所有内容）：\n${list}`,
    { modal: true },
    '覆盖还原'
  );
  if (yes !== '覆盖还原') return;
  const done = [];
  for (const [manifest, bak] of entries) {
    try {
      atomicWrite(manifest, fs.readFileSync(bak, 'utf8'));
      done.push(manifest);
      log(`已用备份覆盖：${manifest}`);
    } catch (e) {
      log(`覆盖失败 ${manifest}: ${e.message}`);
    }
  }
  store.data.changes = [];
  regenerateOwnManifest();
  store.save();
  await notifyManualRestart(`已覆盖还原 ${done.length} 个清单`);
}

async function openStateFile() {
  store.save();
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(store.file));
  await vscode.window.showTextDocument(doc, { preview: false });
}

// ------------------------------------------------------------------ 生命周期

function activate(context) {
  out = vscode.window.createOutputChannel('Menu Pinner');
  context.subscriptions.push(out);
  store = new Store(context);
  store.load();

  const register = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  register('menuPinner.pinAtTop', cmdPinAtTop);
  register('menuPinner.hideItem', cmdHideItem);
  register('menuPinner.manage', cmdManage);
  register('menuPinner.reapply', cmdReapply);
  register('menuPinner.restoreAll', cmdRestoreAll);
  register('menuPinner.restoreBackups', cmdRestoreBackups);

  log(`已激活。状态文件：${store.file}；当前记录改动 ${store.data.changes.length} 项`);
  if (store.data.changes.length) {
    log('记录：' + store.data.changes.map((c) => `${c.kind}/${c.menu}/${c.title || c.command}`).join('；'));
  }

  // 启动几秒后检查改动是否被扩展更新覆盖
  setTimeout(async () => {
    try {
      const bad = checkDrift();
      if (!bad.length) return;
      log('检测到失效改动：' + bad.map((c) => `${c.title || c.command}（${c.menu}）`).join('；'));
      const pick = await vscode.window.showWarningMessage(
        `Menu Pinner：有 ${bad.length} 项置顶/隐藏已失效（通常是扩展更新覆盖了清单）`,
        '重新应用',
        '查看',
        '忽略'
      );
      if (pick === '重新应用') {
        const r = reapplyAll();
        await notifyManualRestart(`已重新应用 ${r.done} 项${r.failed.length ? `，${r.failed.length} 项失败` : ''}`);
      } else if (pick === '查看') out.show();
    } catch (e) {
      log('启动检查出错：' + e.message);
    }
  }, 3000);
}

function deactivate() { /* 无需清理 */ }

module.exports = { activate, deactivate };
