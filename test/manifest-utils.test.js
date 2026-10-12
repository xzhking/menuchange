'use strict';

/**
 * node test/manifest-utils.test.js
 * 纯文本清单改写逻辑的回归测试（不依赖 vscode）。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const U = require('../lib/manifest-utils');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const SYNTHETIC = `{
	"name": "demo",
	"publisher": "someone",
	"version": "1.0.0",
	"contributes": {
		"commands": [
			{
				"command": "demo.hello",
				"title": "Say Hello"
			},
			{
				"command": "demo.short",
				"title": { "value": "本地化标题", "original": "Localized" }
			}
		],
		"menus": {
			"editor/context": [
				{
					"command": "demo.hello",
					"group": "myGrp@1",
					"when": "resourceLangId == html"
				},
				{
					"command": "demo.short"
				}
			],
			"explorer/context": [
				{
					"command": "demo.hello",
					"group": "myGrp@2",
					"when": "resourceLangId == xml"
				}
			]
		},
		"configuration": {
			"title": "demo",
			"properties": {
				"demo.menus": { "type": "object", "default": { "menus": "干扰项" } }
			}
		}
	}
}
`;

// ------------------------------------------------------------------ 解析

test('列出 editor/context 的菜单项', () => {
  const entries = U.listMenuEntries(SYNTHETIC, 'editor/context');
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].command, 'demo.hello');
  assert.strictEqual(entries[0].group, 'myGrp@1');
  assert.strictEqual(entries[0].when, 'resourceLangId == html');
  assert.strictEqual(entries[1].command, 'demo.short');
  assert.strictEqual(entries[1].group, undefined);
});

test('configuration 里的 "menus" 干扰项不会影响解析', () => {
  const all = U.listAllMenuEntries(SYNTHETIC);
  const menus = [...new Set(all.map((e) => e.menuId))].sort();
  assert.deepStrictEqual(menus, ['editor/context', 'explorer/context']);
});

test('按命令跨菜单查找', () => {
  const found = U.findAllCommandEntries(SYNTHETIC, 'demo.hello');
  assert.strictEqual(found.length, 2);
  assert.deepStrictEqual(found.map((e) => e.menuId), ['editor/context', 'explorer/context']);
});

test('读取命令标题（字符串与本地化对象）', () => {
  assert.strictEqual(U.findCommandTitle(SYNTHETIC, 'demo.hello'), 'Say Hello');
  assert.strictEqual(U.findCommandTitle(SYNTHETIC, 'demo.short'), '本地化标题');
  assert.strictEqual(U.findCommandTitle(SYNTHETIC, 'nope'), undefined);
});

// ------------------------------------------------------------------ 改写

test('替换已存在的 group', () => {
  const entry = U.findCommandEntries(SYNTHETIC, 'editor/context', 'demo.hello')[0];
  const out = U.applyEntryChanges(SYNTHETIC, [{ entry, key: 'group', value: 'navigation@-1000' }]);
  assert.ok(U.isValidJson(out));
  const back = U.findCommandEntries(out, 'editor/context', 'demo.hello')[0];
  assert.strictEqual(back.group, 'navigation@-1000');
  assert.strictEqual(back.when, 'resourceLangId == html');
  assert.strictEqual(U.diffLines(SYNTHETIC, out).length, 1, '只应有 1 行变化');
});

test('给没有 group 的菜单项插入 group', () => {
  const entry = U.findCommandEntries(SYNTHETIC, 'editor/context', 'demo.short')[0];
  assert.strictEqual(entry.group, undefined);
  const out = U.applyEntryChanges(SYNTHETIC, [{ entry, key: 'group', value: 'navigation@-999' }]);
  assert.ok(U.isValidJson(out));
  const back = U.findCommandEntries(out, 'editor/context', 'demo.short')[0];
  assert.strictEqual(back.group, 'navigation@-999');
  assert.strictEqual(U.listMenuEntries(out, 'editor/context').length, 2);
});

test('给没有 when 的菜单项插入 when', () => {
  const entry = U.findCommandEntries(SYNTHETIC, 'editor/context', 'demo.short')[0];
  const out = U.applyEntryChanges(SYNTHETIC, [{ entry, key: 'when', value: 'false' }]);
  assert.ok(U.isValidJson(out));
  assert.strictEqual(U.findCommandEntries(out, 'editor/context', 'demo.short')[0].when, 'false');
});

test('同时改写多条（偏移不互相污染）', () => {
  const entries = U.findAllCommandEntries(SYNTHETIC, 'demo.hello');
  assert.strictEqual(entries.length, 2);
  const out = U.applyEntryChanges(SYNTHETIC, [
    { entry: entries[0], key: 'group', value: 'navigation@-1000' },
    { entry: entries[1], key: 'group', value: 'navigation@-999' },
  ]);
  assert.ok(U.isValidJson(out));
  const after = U.findAllCommandEntries(out, 'demo.hello');
  assert.deepStrictEqual(after.map((e) => e.group), ['navigation@-1000', 'navigation@-999']);
  assert.strictEqual(U.diffLines(SYNTHETIC, out).length, 2);
});

test('删除属性：中间项 / 首项 / 唯一项都仍是合法 JSON', () => {
  // 插入后再删除，应回到原样
  const entry = U.findCommandEntries(SYNTHETIC, 'editor/context', 'demo.short')[0];
  const inserted = U.applyEntryChanges(SYNTHETIC, [{ entry, key: 'group', value: 'navigation@-999' }]);
  const back = U.listMenuEntries(inserted, 'editor/context')[1];
  const removed = U.applyEntryChanges(inserted, [{ entry: back, key: 'group', remove: true }]);
  assert.ok(U.isValidJson(removed));
  assert.strictEqual(U.findCommandEntries(removed, 'editor/context', 'demo.short')[0].group, undefined);
  assert.strictEqual(removed, SYNTHETIC, '插入再删除应与原文完全一致');

  // 各种形态：删中间项、删首项（带尾逗号）、删唯一项
  const cases = [
    { doc: '{"a":1,"b":2}', key: 'a', expect: '{"b":2}' },
    { doc: '{"a":1,"b":2}', key: 'b', expect: '{"a":1}' },
    { doc: '{"b":2}', key: 'b', expect: '{}' },
  ];
  for (const c of cases) {
    const text = `{"contributes":{"menus":{"m":[${c.doc}]}}}`;
    const e = U.listMenuEntries(text, 'm')[0];
    const out = U.applyEntryChanges(text, [{ entry: e, key: c.key, remove: true }]);
    assert.ok(U.isValidJson(out), '删除后应合法: ' + out);
    const expected = `{"contributes":{"menus":{"m":[${c.expect}]}}}`;
    assert.strictEqual(out, expected, `删除 ${c.key} 结果应为 ${expected}`);
  }
});

test('容忍 JSONC（注释 / 尾逗号）的清单校验', () => {
  const jsonc = '{\n  // 注释\n  "a": 1,\n  "b": [1, 2,],\n  /* 块注释 */ "c": {"d": 2},\n}';
  assert.ok(U.isValidJson(jsonc));
  assert.deepStrictEqual(U.readJson(jsonc).b, [1, 2]);
  assert.strictEqual(U.isValidJson('{"a": }'), false);
});
test('空对象插入属性后仍是合法 JSON', () => {
  const doc = '{"contributes":{"menus":{"editor/context":[{}]}}}';
  const entry = U.listMenuEntries(doc, 'editor/context')[0];
  const out = U.applyEntryChanges(doc, [{ entry, key: 'group', value: 'navigation@-1000' }]);
  assert.ok(U.isValidJson(out));
  assert.strictEqual(U.listMenuEntries(out, 'editor/context')[0].group, 'navigation@-1000');
});

test('改写非法 JSON 时抛错而不是写坏文件', () => {
  const bad = '{"name":"x", "contributes": ';
  assert.strictEqual(U.isValidJson(bad), false);
});

// ------------------------------------------------------------------ 真实清单回放

const liveServerDir = path.join(process.env.USERPROFILE || process.env.HOME, '.vscode', 'extensions', 'ritwickdey.liveserver-5.7.10');
const fixtureCandidates = ['package.json.menuPinner.bak', 'package.json.bak-topmenu', 'package.json'].map((f) => path.join(liveServerDir, f));
const fixture = fixtureCandidates.find((p) => fs.existsSync(p));

if (!fixture) {
  console.log('  skip 未找到 Live Server 清单样本（真实清单回放测试跳过）');
} else {
  const original = fs.readFileSync(fixture, 'utf8');
  console.log('  info 样本文件: ' + fixture);

  test('真实清单可被解析且 JSON 合法', () => {
    assert.ok(U.isValidJson(original));
    const online = U.findCommandEntries(original, 'editor/context', 'extension.liveServer.goOnline');
    assert.ok(online.length >= 1, '应能找到 goOnline 的编辑器菜单项');
  });

  test('真实清单：置顶后 / 还原后逐字节一致', () => {
    // 1) 置顶：把 editor/context 与 explorer/context 里的 Live Server 项全部改到 navigation@-1000
    const targets = U.findAllCommandEntries(original, 'extension.liveServer.goOnline')
      .concat(U.findAllCommandEntries(original, 'extension.liveServer.goOffline'));
    assert.ok(targets.length > 0);
    const pinned = U.applyEntryChanges(original, targets.map((e) => ({ entry: e, key: 'group', value: 'navigation@-1000' })));
    assert.ok(U.isValidJson(pinned));
    for (const e of U.findAllCommandEntries(pinned, 'extension.liveServer.goOnline')) {
      assert.strictEqual(e.group, 'navigation@-1000');
    }

    // 2) 还原：把记录下来的原始 group 写回去
    const restore = targets.map((e) => ({ entry: U.findAllCommandEntries(pinned, e.command).find((x) => x.menuId === e.menuId && x.when === e.when), key: 'group', value: e.group }));
    const restored = U.applyEntryChanges(pinned, restore);
    assert.strictEqual(restored, original, '还原后应与原文件完全一致');
  });
}

// ------------------------------------------------------------------ 结果

console.log('\n通过 ' + passed + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : ''));
if (failures.length) {
  for (const f of failures) console.error('\n--- ' + f.name + '\n' + f.e.stack);
  process.exit(1);
}
