'use strict';

/**
 * nls.js —— 解析扩展清单里 `%key%` 形式的本地化标题。
 *
 * VS Code 允许 contributes.commands[].title 写成 "%my.command.title%"，
 * 真正的文案放在同目录的 package.nls.json / package.nls.<locale>.json 里。
 * 不做这一步，选择列表里就会显示成 %xxx.title% 这种占位符。
 */

const fs = require('fs');
const path = require('path');

const cache = new Map();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** 合并 package.nls.json 与指定语言的 package.nls.<locale>.json */
function loadBundle(manifestPath, locale) {
  const key = `${manifestPath}|${locale || ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dir = path.dirname(manifestPath);
  const merged = { ...(readJson(path.join(dir, 'package.nls.json')) || {}) };
  if (locale) {
    const lower = String(locale).toLowerCase();
    for (const name of [
      `package.nls.${lower}.json`,
      `package.nls.${lower.replace(/-/g, '-')}.json`,
      `package.nls.${String(locale)}.json`,
    ]) {
      const loc = readJson(path.join(dir, name));
      if (loc) Object.assign(merged, loc);
    }
  }
  cache.set(key, merged);
  return merged;
}

/** 把 %key% 解析成真实文案；解析不到就原样返回 */
function resolveTitle(manifestPath, title, locale) {
  if (typeof title !== 'string') return title;
  const m = /^%(.*)%$/.exec(title.trim());
  if (!m) return title;
  const value = loadBundle(manifestPath, locale)[m[1]];
  return typeof value === 'string' ? value : title;
}

/** 选择列表里用：解析后若仍是 %占位符%，就退回命令 ID，避免出现看不懂的条目 */
function displayTitle(manifestPath, title, locale, fallback) {
  const t = resolveTitle(manifestPath, title, locale);
  if (typeof t === 'string' && !/^%.*%$/.test(t.trim())) return t;
  return fallback;
}

module.exports = { loadBundle, resolveTitle, displayTitle };
