const fs = require('fs');
const path = require('path');

const roots = process.argv.slice(2);
const scanRoots = roots.length > 0
  ? roots
  : ['src', 'server', 'docs', 'scripts', 'README.md', 'TUTORIAL.md', '.env.example', 'package.json'];

const ignoredDirectories = new Set(['node_modules', 'dist', '.git']);
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.cjs', '.md', '.json', '.css', '.html']);

const mojibakeRules = [
  {
    name: 'replacement-character',
    pattern: /\uFFFD/,
  },
  {
    name: 'private-use-character',
    pattern: /[\uE000-\uF8FF]/,
  },
  {
    name: 'utf8-as-gbk-fragment',
    pattern: /(?:\u95B8|\u9352|\u6769|\u5B80|\u6FB6|\u7E31|\u704F|\u93C2|\u9422|\u95AB|\u947A|\u9395|\u93C8|\u93B4){2,}/,
  },
  {
    name: 'western-mojibake-fragment',
    pattern: /(?:\u8119|\u8117|\u8292\u9227|\u00C3|\u00C2|\u00E2\u20AC|\u00E2\u20AC\u2122|\u00E2\u20AC\u0153|\u00E2\u20AC\uFFFD|\u00E2\u20AC\u00A6)/,
  },
  {
    name: 'utf8-as-gbk-readable-fragment',
    pattern: /(?:\u7039\u70b4\u67e6|\u7f01\u64b9|\u935a\u5ea3|\u9353\u5d87|\u59af\u2033|\u93b7\u55d7|\u7459\u52eb|\u6d60\u8bf2|\u6960\u5c7e|\u5a34\u5b2d|\u7ecb\u51b2|\u7ee0\uff04|\u9286|\u951b)/,
  },
];

const hits = [];

function shouldScanFile(filePath) {
  if (filePath.endsWith('.env.example')) return true;
  return allowedExtensions.has(path.extname(filePath));
}

function walk(entry) {
  if (!fs.existsSync(entry)) return;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    if (ignoredDirectories.has(path.basename(entry))) return;
    for (const child of fs.readdirSync(entry)) walk(path.join(entry, child));
    return;
  }
  if (!shouldScanFile(entry)) return;

  const text = fs.readFileSync(entry, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    for (const rule of mojibakeRules) {
      if (rule.pattern.test(line)) {
        hits.push(`${entry}:${index + 1}: matched ${rule.name} -> ${line.trim()}`);
        return;
      }
    }
  });
}

for (const root of scanRoots) walk(root);

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error(`MOJIBAKE_HITS=${hits.length}`);
  process.exit(1);
}

console.log('MOJIBAKE_HITS=0');
