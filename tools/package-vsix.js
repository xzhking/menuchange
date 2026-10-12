'use strict';

/**
 * node tools/package-vsix.js
 * 生成 dist/<publisher>.<name>-<version>.vsix（VSIX 就是一个 zip，这里手工写，零依赖）。
 *
 * 别人拿到这个文件后：
 *   1) VS Code 里 Ctrl+Shift+P → Extensions: Install from VSIX... → 选它；
 *   2) 或者命令行 `code --install-extension <文件>`
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// 进包的文件（相对于扩展根目录）
const INCLUDE_FILES = ['package.json', 'extension.js', 'README.md', 'CHANGELOG.md', 'LICENSE', 'icon.png'];
const INCLUDE_DIRS = ['lib'];
// 明确排除：test/、tools/、.github/、dist/、点文件

// ---------------------------------------------------------------- CRC32

let TABLE = null;
function crcTable() {
  if (TABLE) return TABLE;
  TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    TABLE[n] = c;
  }
  return TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

// ---------------------------------------------------------------- zip

function zip(entries) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);       // version needed
    lh.writeUInt16LE(0x0800, 6);   // UTF-8 文件名标志
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);       // version made by
    ch.writeUInt16LE(20, 6);       // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);       // extra
    ch.writeUInt16LE(0, 32);       // comment
    ch.writeUInt16LE(0, 34);       // disk
    ch.writeUInt16LE(0, 36);       // internal attrs
    ch.writeUInt32LE(0, 38);       // external attrs
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------------------------------------------------------------- VSIX 内容

function walk(dir, prefix, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) walk(full, rel, out);
    else out.push({ rel, data: fs.readFileSync(full) });
  }
  return out;
}

function collect() {
  const files = [];
  for (const f of INCLUDE_FILES) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) files.push({ rel: f, data: fs.readFileSync(full) });
    else if (f !== 'CHANGELOG.md') console.warn(`  ! 缺少 ${f}`);
  }
  for (const d of INCLUDE_DIRS) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) continue;
    for (const item of walk(full, d, [])) files.push(item);
  }
  return files;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Override PartName="/extension/LICENSE" ContentType="text/plain" />
</Types>
`;

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</DisplayName>
    <Description xml:space="preserve">${pkg.description.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Description>
    <Tags>${(pkg.keywords || []).join(',')}</Tags>
    <Categories>${(pkg.categories || []).join(',')}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${(pkg.extensionKind || ['workspace'])[0]}" />
    </Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;

const entries = [
  { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
  { name: 'extension.vsixmanifest', data: Buffer.from(MANIFEST, 'utf8') },
  ...collect().map((f) => ({ name: `extension/${f.rel}`, data: f.data })),
];

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const vsixPath = path.join(outDir, `${pkg.publisher}.${pkg.name}-${pkg.version}.vsix`);

// dist/ 会随仓库提交（方便别人直接下载），所以每次只保留当前版本的包，避免二进制堆积
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.vsix') && f !== path.basename(vsixPath)) {
    fs.rmSync(path.join(outDir, f), { force: true });
    console.log(`已清理旧包：${f}`);
  }
}

const buf = zip(entries);
fs.writeFileSync(vsixPath, buf);

console.log(`VSIX 已生成：${vsixPath}`);
console.log(`大小：${(buf.length / 1024).toFixed(1)} KB，条目 ${entries.length} 个：`);
for (const e of entries) console.log(`  · ${e.name}  (${e.data.length} B)`);
