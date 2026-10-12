'use strict';

/**
 * manifest-utils.js
 *
 * 纯文本层面的 VS Code 扩展清单（package.json）操作工具：
 *  - 定位 contributes.menus 下的菜单项对象
 *  - 读取/改写菜单项里的 group、when 等字符串属性
 *  - 改动时只替换原有字符区间，最大限度地保持文件其余部分（格式、键顺序、注释外内容）不变
 *
 * 本文件不依赖 'vscode' 模块，可直接用 node 跑测试。
 */

// ---------------------------------------------------------------- 基础扫描器

/** 跳过空白（JS 的 \s 已包含 BOM U+FEFF） */
function skipWs(t, i) {
  while (i < t.length && /\s/.test(t[i])) i++;
  return i;
}

/** t[i] === '"'，返回闭合引号之后的位置 */
function skipStringToken(t, i) {
  i++; // 开引号
  while (i < t.length) {
    const c = t[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    i++;
  }
  return t.length;
}

/** 返回一个值（字符串/对象/数组/字面量）之后的位置 */
function skipValue(t, i) {
  i = skipWs(t, i);
  const c = t[i];
  if (c === '"') return skipStringToken(t, i);
  if (c === '{' || c === '[') {
    const open = c;
    const close = c === '{' ? '}' : ']';
    let depth = 0;
    while (i < t.length) {
      const ch = t[i];
      if (ch === '"') { i = skipStringToken(t, i); continue; }
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    return t.length;
  }
  while (i < t.length && !',}] \t\r\n'.includes(t[i])) i++;
  return i;
}

/**
 * 浅层解析一个对象：只记录直接子属性的值区间，嵌套对象整体算作一个值。
 * @returns {{start:number,end:number,props:Object<string,{valueStart:number,valueEnd:number,raw:string}>}}
 */
function parseObjectShallow(t, objStart) {
  const props = Object.create(null);
  let i = objStart + 1;
  for (;;) {
    i = skipWs(t, i);
    if (i >= t.length) return { start: objStart, end: t.length, props };
    const c = t[i];
    if (c === '}') return { start: objStart, end: i + 1, props };
    if (c === ',') { i++; continue; }
    if (c !== '"') { i = skipValue(t, i); continue; }
    const keyEnd = skipStringToken(t, i);
    let key;
    try { key = JSON.parse(t.slice(i, keyEnd)); } catch { i = keyEnd; continue; }
    i = skipWs(t, keyEnd);
    if (t[i] === ':') i++;
    i = skipWs(t, i);
    const valueStart = i;
    const valueEnd = skipValue(t, i);
    props[key] = { valueStart, valueEnd, raw: t.slice(valueStart, valueEnd) };
    i = valueEnd;
  }
}

/** 数组的每个元素区间 */
function parseArrayItems(t, arrStart) {
  const out = [];
  if (t[arrStart] !== '[') return out;
  let i = arrStart + 1;
  for (;;) {
    i = skipWs(t, i);
    if (i >= t.length) return out;
    if (t[i] === ']') return out;
    if (t[i] === ',') { i++; continue; }
    const end = skipValue(t, i);
    out.push({ start: i, end });
    i = end;
  }
}

function parseJsonValue(t, span) {
  try { return JSON.parse(t.slice(span.valueStart, span.valueEnd)); } catch { return undefined; }
}

function findRootObject(t) {
  return t.indexOf('{');
}

// ---------------------------------------------------------------- 清单结构

/** contributes.menus 对象的位置；找不到返回 null */
function findMenusObject(t) {
  const rootStart = findRootObject(t);
  if (rootStart < 0) return null;
  const root = parseObjectShallow(t, rootStart);
  const contributes = root.props.contributes;
  if (!contributes || contributes.raw[0] !== '{') return null;
  const cObj = parseObjectShallow(t, contributes.valueStart);
  const menus = cObj.props.menus;
  if (!menus || menus.raw[0] !== '{') return null;
  return { start: menus.valueStart, end: menus.valueEnd };
}

function normalizeEntry(t, menuId, objectStart, parsed) {
  const props = parsed.props;
  const entry = { menuId, objectStart, objectEnd: parsed.end, props };
  entry.command = props.command ? parseJsonValue(t, props.command) : undefined;
  entry.group = props.group ? parseJsonValue(t, props.group) : undefined;
  entry.when = props.when ? parseJsonValue(t, props.when) : undefined;
  entry.submenu = props.submenu ? parseJsonValue(t, props.submenu) : undefined;
  return entry;
}

/** 某个菜单（如 editor/context）下的全部菜单项 */
function listMenuEntries(t, menuId) {
  const menus = findMenusObject(t);
  if (!menus) return [];
  const obj = parseObjectShallow(t, menus.start);
  const arr = obj.props[menuId];
  if (!arr || arr.raw[0] !== '[') return [];
  return parseArrayItems(t, arr.valueStart).map((it) =>
    normalizeEntry(t, menuId, it.start, parseObjectShallow(t, it.start))
  );
}

/** 清单里所有菜单（含子菜单）下的全部菜单项 */
function listAllMenuEntries(t) {
  const menus = findMenusObject(t);
  if (!menus) return [];
  const obj = parseObjectShallow(t, menus.start);
  const out = [];
  for (const menuId of Object.keys(obj.props)) {
    const arr = obj.props[menuId];
    if (!arr || arr.raw[0] !== '[') continue;
    for (const it of parseArrayItems(t, arr.valueStart)) {
      out.push(normalizeEntry(t, menuId, it.start, parseObjectShallow(t, it.start)));
    }
  }
  return out;
}

/** 指定菜单里引用了某个命令的菜单项 */
function findCommandEntries(t, menuId, command) {
  return listMenuEntries(t, menuId).filter((e) => e.command === command);
}

/** 某个命令在整个清单里出现的位置（用于“我没告诉你在哪个菜单”时兜底） */
function findAllCommandEntries(t, command) {
  return listAllMenuEntries(t).filter((e) => e.command === command);
}

/** contributes.commands 里的标题 */
function findCommandTitle(t, command) {
  const rootStart = findRootObject(t);
  if (rootStart < 0) return undefined;
  const contributes = parseObjectShallow(t, rootStart).props.contributes;
  if (!contributes || contributes.raw[0] !== '{') return undefined;
  const cmds = parseObjectShallow(t, contributes.valueStart).props.commands;
  if (!cmds || cmds.raw[0] !== '[') return undefined;
  for (const it of parseArrayItems(t, cmds.valueStart)) {
    const p = parseObjectShallow(t, it.start).props;
    if (!p.command) continue;
    const id = parseJsonValue(t, p.command);
    if (id !== command) continue;
    if (!p.title) return undefined;
    const title = parseJsonValue(t, p.title);
    if (typeof title === 'string') return title;
    if (title && typeof title === 'object') return title.value || title.original;
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------- 改写

/** 按 start 从后往前应用补丁，避免偏移失效 */
function applyPatches(t, patches) {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = t;
  for (const p of sorted) out = out.slice(0, p.start) + p.text + out.slice(p.end);
  return out;
}

/**
 * 生成“设置某个字符串属性”的补丁；属性不存在时插入到对象开头。
 * @returns {{start:number,end:number,text:string,kind:'replace'|'insert'}}
 */
function patchStringProperty(t, entry, key, value) {
  const prop = entry.props[key];
  const json = JSON.stringify(value);
  if (prop) return { start: prop.valueStart, end: prop.valueEnd, text: json, kind: 'replace' };
  // 插入：沿用该对象的缩进，生成一行新属性
  const lineStart = t.lastIndexOf('\n', entry.objectStart) + 1;
  const indentMatch = /^[ \t]*/.exec(t.slice(lineStart, entry.objectStart));
  const indent = (indentMatch ? indentMatch[0] : '') + '\t';
  const i = skipWs(t, entry.objectStart + 1);
  const isEmpty = t[i] === '}';
  const closingIndent = indent.slice(0, -1);
  return {
    start: entry.objectStart + 1,
    end: entry.objectStart + 1,
    // 空对象：{\n<indent>"key": value\n<父缩进>}
    // 非空：  {\n<indent>"key": value, …
    text: isEmpty
      ? `\n${indent}"${key}": ${json}\n${closingIndent}`
      : `\n${indent}"${key}": ${json},`,
    kind: 'insert',
  };
}

/** 生成“删除某个字符串属性”的补丁（连同相邻逗号与缩进一起清掉，避免留下空行） */
function patchRemoveProperty(t, entry, key) {
  const prop = entry.props[key];
  if (!prop) return null;
  // 向前定位 key 的起始引号
  let i = prop.valueStart - 1;
  while (i >= 0 && /\s/.test(t[i])) i--;
  if (t[i] === ':') { i--; while (i >= 0 && /\s/.test(t[i])) i--; }
  const closeQuote = t.lastIndexOf('"', i);
  const keyStart = closeQuote > 0 ? t.lastIndexOf('"', closeQuote - 1) : -1;
  if (keyStart < 0) return null;

  let start = keyStart;
  let end = prop.valueEnd;
  const after = skipWs(t, end);
  if (t[after] === ',') {
    end = after + 1; // 吃掉后面的逗号
  } else {
    // 最后一个属性：吃掉前面的逗号
    let k = keyStart - 1;
    while (k >= 0 && /\s/.test(t[k])) k--;
    if (t[k] === ',') start = k;
  }
  // 再向前吃掉这段属性自带的缩进/换行（前提是紧邻前一个 token 是 { 或 ,）
  let s = start - 1;
  while (s >= 0 && /\s/.test(t[s])) s--;
  if (s >= 0 && (t[s] === '{' || t[s] === ',')) start = s + 1;
  return { start, end, text: '', kind: 'remove' };
}

function changeToPatch(t, change) {
  return change.remove
    ? patchRemoveProperty(t, change.entry, change.key)
    : patchStringProperty(t, change.entry, change.key, change.value);
}

/** 一次性把多项改写应用到清单文本；change 形如 {entry,key,value} 或 {entry,key,remove:true} */
function applyEntryChanges(t, changes) {
  const patches = changes.map((c) => changeToPatch(t, c)).filter(Boolean);
  const out = applyPatches(t, patches);
  if (!isValidJson(out)) throw new Error('改写后 JSON 非法，已放弃（原文未修改）');
  return out;
}

// ---------------------------------------------------------------- 校验/杂项

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * VS Code 用 jsonc 解析扩展清单，能容忍注释和尾逗号，
 * 所以校验也要容忍——否则会误判某些扩展的清单非法、拒绝改写。
 */
function stripJsonCommentsAndTrailingCommas(s) {
  let out = '';
  let inStr = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function isValidJson(s) {
  const t = stripBom(s);
  try { JSON.parse(t); return true; } catch { /* 再宽松试一次 */ }
  try { JSON.parse(stripJsonCommentsAndTrailingCommas(t)); return true; } catch { return false; }
}

function readJson(s) {
  const t = stripBom(s);
  try { return JSON.parse(t); } catch { return JSON.parse(stripJsonCommentsAndTrailingCommas(t)); }
}

/** 统计两个文本的行级差异，用于日志展示 */
function diffLines(before, after) {
  const a = before.split(/\r\n|\n/);
  const b = after.split(/\r\n|\n/);
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) out.push({ line: i + 1, before: a[i], after: b[i] });
  }
  return out;
}

module.exports = {
  skipWs,
  skipStringToken,
  skipValue,
  parseObjectShallow,
  parseArrayItems,
  findRootObject,
  findMenusObject,
  listMenuEntries,
  listAllMenuEntries,
  findCommandEntries,
  findAllCommandEntries,
  findCommandTitle,
  applyPatches,
  patchStringProperty,
  patchRemoveProperty,
  applyEntryChanges,
  isValidJson,
  readJson,
  stripBom,
  diffLines,
  TOP_GROUP: 'navigation',
};
