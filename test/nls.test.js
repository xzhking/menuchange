'use strict';

/**
 * node test/nls.test.js
 * 本地化标题（%key%）解析的测试：临时造一个扩展目录，测完删除。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NLS = require('../lib/nls');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-nls-'));
const manifest = path.join(dir, 'package.json');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + e.message); }
}

try {
  fs.writeFileSync(manifest, '{}', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.nls.json'), JSON.stringify({ 'a.title': 'Plain Title', 'b.title': 'Base Only' }), 'utf8');
  fs.writeFileSync(path.join(dir, 'package.nls.zh-cn.json'), JSON.stringify({ 'a.title': '中文标题' }), 'utf8');

  test('按语言取本地化文案', () => {
    assert.strictEqual(NLS.resolveTitle(manifest, '%a.title%', 'zh-cn'), '中文标题');
  });
  test('该语言没有的键回退到 package.nls.json', () => {
    assert.strictEqual(NLS.resolveTitle(manifest, '%b.title%', 'zh-cn'), 'Base Only');
  });
  test('没有语言包时用基础文案', () => {
    assert.strictEqual(NLS.resolveTitle(manifest, '%a.title%', 'en'), 'Plain Title');
  });
  test('普通字符串原样返回', () => {
    assert.strictEqual(NLS.resolveTitle(manifest, 'Open with Live Server', 'zh-cn'), 'Open with Live Server');
  });
  test('查不到的占位符原样返回', () => {
    assert.strictEqual(NLS.resolveTitle(manifest, '%nope.title%', 'zh-cn'), '%nope.title%');
  });
  test('displayTitle：占位符查不到时退回命令 ID', () => {
    assert.strictEqual(NLS.displayTitle(manifest, '%nope.title%', 'zh-cn', 'ext.cmd.id'), 'ext.cmd.id');
    assert.strictEqual(NLS.displayTitle(manifest, '%a.title%', 'zh-cn', 'ext.cmd.id'), '中文标题');
    assert.strictEqual(NLS.displayTitle(manifest, 'Run Code', 'zh-cn', 'ext.cmd.id'), 'Run Code');
  });
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n通过 ' + passed + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : ''));
if (failures.length) process.exit(1);
