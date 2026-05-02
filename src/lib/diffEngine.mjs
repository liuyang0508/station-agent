export function computeLineDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');

  // LCS-based diff
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const hunks = buildHunks(oldLines, newLines, lcs);

  return hunks.map(hunk => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    type: hunk.type // 'add', 'remove', 'same'
  }));
}

function longestCommonSubsequence(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the LCS
  const lcs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift({ value: a[i - 1], oldIdx: i - 1, newIdx: j - 1 });
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return lcs;
}

function buildHunks(oldLines, newLines, lcs) {
  const hunks = [];
  let oldIdx = 0, newIdx = 0, lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const lcsItem = lcs[lcsIdx];

    // Collect removed lines
    const removed = [];
    while (oldIdx < oldLines.length && (!lcsItem || oldIdx < lcsItem.oldIdx)) {
      removed.push(oldLines[oldIdx]);
      oldIdx++;
    }

    // Collect added lines
    const added = [];
    while (newIdx < newLines.length && (!lcsItem || newIdx < lcsItem.newIdx)) {
      added.push(newLines[newIdx]);
      newIdx++;
    }

    if (removed.length > 0 || added.length > 0) {
      const firstOld = lcsItem ? lcsItem.oldIdx - removed.length + 1 : oldIdx + 1;
      const firstNew = lcsItem ? lcsItem.newIdx - added.length + 1 : newIdx + 1;
      hunks.push({
        oldStart: firstOld,
        oldLines: removed,
        newStart: firstNew,
        newLines: added,
        type: removed.length > 0 && added.length > 0 ? 'change' : removed.length > 0 ? 'remove' : 'add'
      });
    }

    if (lcsItem) {
      oldIdx++;
      newIdx++;
      lcsIdx++;
    }
  }

  return hunks;
}

export function renderDiffAsText(oldText, newText) {
  const hunks = computeLineDiff(oldText, newText);
  if (hunks.length === 0) return { ok: true, identical: true };

  const lines = [];
  for (const hunk of hunks) {
    if (hunk.type === 'remove' || hunk.type === 'change') {
      for (const line of hunk.oldLines) {
        lines.push(`- ${line}`);
      }
    }
    if (hunk.type === 'add' || hunk.type === 'change') {
      for (const line of hunk.newLines) {
        lines.push(`+ ${line}`);
      }
    }
  }

  return { ok: true, identical: false, lines, hunks };
}

export function renderDiffAsHtml(oldText, newText) {
  const hunks = computeLineDiff(oldText, newText);
  if (hunks.length === 0) return { ok: true, identical: true, html: '' };

  const parts = [];
  for (const hunk of hunks) {
    parts.push(`<div class="diff-hunk">`);
    if (hunk.type === 'remove' || hunk.type === 'change') {
      for (const line of hunk.oldLines) {
        parts.push(`<div class="diff-line diff-removed">− ${escapeHtml(line)}</div>`);
      }
    }
    if (hunk.type === 'add' || hunk.type === 'change') {
      for (const line of hunk.newLines) {
        parts.push(`<div class="diff-line diff-added">+ ${escapeHtml(line)}</div>`);
      }
    }
    parts.push(`</div>`);
  }

  return { ok: true, identical: false, html: parts.join(''), hunks };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
