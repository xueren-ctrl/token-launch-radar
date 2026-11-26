// Local 7-gate self-check for the token-radar-01 entry (Node 22+, stdlib only).
// Mirrors the scorer's gate: dashboard files + no-network rule, board shape, rank
// order, watchlist coverage, farm steps, screenshots, dossier byte-identity.
//   node check-gates.mjs --out <output dir> --input <snapshot.json>
// Prints one line per gate with numbers; exits 0 when all 7 pass, 1 otherwise.

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const outDir = arg('out', join(here, 'out'));
const inputFile = arg('input', '/home/hatch/workspace/makefun-kit/token-radar-01/token-radar-01-kit/input/snapshot.json');

const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const snapshot = readJson(inputFile);
const watchlist = new Set(snapshot.watchlist);
const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

// ---- gate 1: dashboard files + no-network rule -------------------------
{
  const dir = join(outDir, 'dashboard');
  const files = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(join(d, e.name), p);
      else if (e.isFile()) files.push(p);
    }
  };
  let detail = '';
  let ok = true;
  if (!existsSync(dir)) {
    ok = false;
    detail = 'no dashboard/ directory';
  } else {
    walk(dir, '');
    const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    const badNames = files.filter((f) => !/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(f) || f.split('/').some((s) => s.startsWith('.')));
    // No-network rule: no http:// or https:// inside an HTML tag, a <style> body,
    // an inline <script> import, a CSS file, or a JS import/require/dynamic-import.
    const hits = [];
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      if (f.endsWith('.html')) {
        const tags = text.match(/<[^>]*>/g) ?? [];
        for (const t of tags) if (/https?:\/\//.test(t)) hits.push(`${f}: ${t.slice(0, 80)}`);
        const style = text.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
        for (const s of style) if (/https?:\/\//.test(s)) hits.push(`${f}: <style> body`);
      } else if (f.endsWith('.css')) {
        if (/https?:\/\//.test(text)) hits.push(`${f}: URL in CSS`);
      } else if (f.endsWith('.js')) {
        const imports = text.match(/(import\s+[^;]*?from\s+['"][^'"]+['"]|import\s*\(['"][^'"]+['"]\)|require\s*\(['"][^'"]+['"]\))/g) ?? [];
        for (const im of imports) if (/https?:\/\//.test(im)) hits.push(`${f}: ${im.slice(0, 80)}`);
      }
    }
    const hasHtml = files.some((f) => f.endsWith('.html'));
    const hasCss = files.some((f) => f.endsWith('.css'));
    const hasJs = files.some((f) => f.endsWith('.js'));
    ok = files.length >= 1 && files.length <= 400 && bytes <= 4 * 1024 * 1024 && badNames.length === 0 && hits.length === 0 && hasHtml && hasCss && hasJs;
    detail = `${files.length} files, ${bytes} bytes, html=${hasHtml} css=${hasCss} js=${hasJs}, bad names=${badNames.length}, network hits=${hits.length}${hits.length ? ': ' + hits.slice(0, 3).join(' | ') : ''}`;
  }
  gate('1 dashboard_files', ok, detail);
}

// ---- gate 2: board shape ----------------------------------------------
let board = null;
{
  const p = join(outDir, 'board.json');
  let ok = false;
  let detail = '';
  if (!existsSync(p)) {
    detail = 'no board.json';
  } else {
    const size = statSync(p).size;
    const doc = readJson(p);
    board = doc.rows;
    if (!Array.isArray(board)) {
      detail = 'rows is not an array';
    } else {
      const bad = [];
      const seen = new Set();
      for (const r of board) {
        if (typeof r.slug !== 'string' || !r.slug || /\s/.test(r.slug) || !bySlug.has(r.slug)) bad.push(`${r.slug}: bad slug`);
        else if (seen.has(r.slug)) bad.push(`${r.slug}: duplicate`);
        else seen.add(r.slug);
        if (typeof r.name !== 'string' || !r.name) bad.push(`${r.slug}: no name`);
        if (!Number.isSafeInteger(r.rank) || r.rank <= 0) bad.push(`${r.slug}: bad rank`);
        if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) bad.push(`${r.slug}: bad implied value`);
        if (!Array.isArray(r.farm_steps)) bad.push(`${r.slug}: no farm_steps`);
      }
      ok = board.length >= 100 && board.length <= 4000 && size <= 8 * 1024 * 1024 && bad.length === 0;
      detail = `${board.length} rows, ${size} bytes, bad rows=${bad.length}${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`;
    }
  }
  gate('2 board_file', ok, detail);
}

// ---- gate 3: ranks + order --------------------------------------------
{
  let ok = false;
  let detail = '';
  if (board === null) detail = 'no board';
  else {
    const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
    let rankIssue = null;
    for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) { rankIssue = `rank ${i + 1} is ${ranks[i]}`; break; }
    let orderIssue = null;
    for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) { orderIssue = `row ${i + 1} outranks row ${i}`; break; }
    const allEqual = board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd;
    ok = rankIssue === null && orderIssue === null && !allEqual;
    detail = `ranks 1..${board.length} ${rankIssue === null ? 'ok' : 'FAIL ' + rankIssue}; order ${orderIssue === null ? 'non-increasing' : 'FAIL ' + orderIssue}; top $${board[0]?.implied_value_usd} bottom $${board[board.length - 1]?.implied_value_usd}`;
  }
  gate('3 sorted_by_value', ok, detail);
}

// ---- gate 4: watchlist coverage ---------------------------------------
{
  let ok = false;
  let detail = '';
  if (board === null) detail = 'no board';
  else {
    const slugs = new Set(board.map((r) => r.slug));
    const missing = [...watchlist].filter((s) => !slugs.has(s));
    ok = missing.length === 0;
    detail = `${watchlist.size - missing.length}/${watchlist.size} watchlist slugs covered${missing.length ? ': missing ' + missing.slice(0, 5).join(', ') : ''}`;
  }
  gate('4 coverage', ok, detail);
}

// ---- gate 5: farm steps -----------------------------------------------
{
  let ok = false;
  let detail = '';
  if (board === null) detail = 'no board';
  else {
    const bad = [];
    let total = 0;
    for (const r of board) {
      total += r.farm_steps.length;
      if (r.farm_steps.length < 3 || r.farm_steps.length > 12) bad.push(`${r.slug}: ${r.farm_steps.length} steps`);
      for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) bad.push(`${r.slug}: step ${s.length} chars`);
    }
    ok = bad.length === 0;
    detail = `${total} steps across ${board.length} rows (${(total / board.length).toFixed(2)}/row), bad=${bad.length}${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`;
  }
  gate('5 farm_steps', ok, detail);
}

// ---- gate 6: screenshots ----------------------------------------------
{
  const dir = join(outDir, 'screenshots');
  let ok = false;
  let detail = '';
  if (!existsSync(dir)) {
    detail = 'no screenshots/ directory';
  } else {
    const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
    const bad = [];
    for (const name of names) {
      const p = join(dir, name);
      const st = statSync(p);
      const buf = readFileSync(p);
      let dims = null;
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        dims = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
      } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i + 9 < buf.length) {
          if (buf[i] !== 0xff) { i++; continue; }
          const marker = buf[i + 1];
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
          const len = buf.readUInt16BE(i + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            dims = { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), type: 'jpeg' };
            break;
          }
          i += 2 + len;
        }
      }
      if (dims === null) bad.push(`${name}: not a whole PNG/JPEG`);
      else {
        const long = Math.max(dims.w, dims.h);
        const short = Math.min(dims.w, dims.h);
        if (st.size > 524288) bad.push(`${name}: ${st.size} bytes over 512 KiB`);
        if (long > 1440) bad.push(`${name}: long side ${long} over 1440`);
        if (short < 800) bad.push(`${name}: short side ${short} under 800`);
      }
    }
    ok = names.length >= 3 && names.length <= 4 && bad.length === 0;
    detail = `${names.length} images (${names.join(', ')}), bad=${bad.length}${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`;
  }
  gate('6 screenshots', ok, detail);
}

// ---- gate 7: dossier byte-identity ------------------------------------
{
  const p = join(outDir, 'dossier.json');
  let ok = false;
  let detail = '';
  if (!existsSync(p)) {
    detail = 'no dossier.json';
  } else {
    const size = statSync(p).size;
    try {
      const rebuilt = buildDossier(outDir, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
      const mine = readFileSync(p);
      const same = Buffer.compare(Buffer.from(rebuilt), mine) === 0;
      ok = same && size <= 1.5 * 1024 * 1024;
      detail = `${size} bytes, byte-identical to buildDossier: ${same}`;
    } catch (e) {
      detail = `buildDossier refused: ${e.message}`;
    }
  }
  gate('7 dossier_matches', ok, detail);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} gates pass${failed ? `, ${failed} FAIL` : ''}`);
process.exit(failed === 0 ? 0 : 1);
