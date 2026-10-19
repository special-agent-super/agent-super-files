#!/usr/bin/env node
/**
 * Agent Super Files: build and publish with one command.
 *
 * - Builds Astro before making a commit.
 * - Stages website source, static media, and published entries.
 * - Keeps unpublished drafts (draft: true) local.
 * - Stages a published -> draft transition so the page disappears from builds.
 * - Never stages templates/ or unrelated files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function run(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = capture ? (result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${command} ${args.join(' ')} завершилась с ошибкой.${detail ? '\n' + detail : ''}`);
  }
  return result;
}

function gitText(...args) {
  return run('git', args, { capture: true }).stdout.trim();
}

function gitPaths(...args) {
  const result = run('git', [...args, '-z'], { capture: true });
  return result.stdout.split('\0').filter(Boolean);
}

// Astro defaults draft to false when the field is absent.
function isDraft(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return false;
  return /^draft\s*:\s*true\s*(?:#.*)?$/im.test(match[1]);
}

function wasPreviouslyPublic(path) {
  const result = run('git', ['show', `HEAD:${path}`], { capture: true, allowFailure: true });
  return result.status === 0 && !isDraft(result.stdout);
}

function canStage(path) {
  if (path.includes('.DS_Store') || /(^|\/)\.env(?:\.|$)/.test(path)) return false;
  if (path === 'package.json' || path === 'package-lock.json' || path === 'astro.config.mjs' || path === '.gitignore') return true;
  if (/^scripts\/[\w./-]+\.(?:mjs|js)$/.test(path)) return true;
  if (/^\.github\/workflows\/[\w.-]+\.(?:yml|yaml)$/.test(path)) return true;
  if (path === 'src/content.config.ts') return true;
  if (/^src\/content\/entries\/.+\.(md|mdx)$/.test(path)) {
    if (!existsSync(path)) return true; // tracked deletion
    return !isDraft(readFileSync(path, 'utf8')) || wasPreviouslyPublic(path);
  }
  if (/^src\/(?:pages|layouts|components|styles|utils)\//.test(path)) return true;
  if (/^public\/(?:images|scans|audio|video)\//.test(path)) {
    return /\.(?:avif|gif|ico|jpe?g|png|svg|webp|mp3|m4a|wav|flac|ogg|mp4|webm|pdf)$/i.test(path);
  }
  if (/^public\/favicon\.(?:svg|ico)$/.test(path)) return true;
  return false;
}

try {
  if (gitText('rev-parse', '--show-toplevel') !== root) {
    throw new Error('Запусти команду внутри основного репозитория Agent Super Files.');
  }
  const branch = gitText('branch', '--show-current');
  if (branch !== 'main') {
    throw new Error(`Текущая ветка: ${branch || '(detached HEAD)'}. Публикация разрешена только из main.`);
  }

  // Protect files a user might have staged manually; we never silently commit them.
  const previouslyStaged = gitPaths('diff', '--cached', '--name-only');
  const unsafe = previouslyStaged.filter(path => !canStage(path));
  if (unsafe.length) {
    throw new Error('В Git уже подготовлены файлы, которые нельзя публиковать автоматически:\n'
      + unsafe.map(path => `  - ${path}`).join('\n')
      + '\nСними их с индекса командой git restore --staged -- <путь> и запусти публикацию ещё раз.');
  }

  console.log('\n[1/4] Проверяю сборку сайта...\n');
  run('npm', ['run', 'build']);

  console.log('\n[2/4] Отбираю файлы для публикации...\n');
  const unstagedOrUntracked = gitPaths('ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '--full-name');
  const candidates = [...new Set(unstagedOrUntracked)].filter(canStage);
  if (candidates.length) {
    // Exact file paths: drafts, templates and unrelated directories stay untouched.
    run('git', ['add', '-A', '--', ...candidates]);
  }
  const staged = gitPaths('diff', '--cached', '--name-only');
  const stagedUnsafe = staged.filter(path => !canStage(path));
  if (stagedUnsafe.length) {
    throw new Error(`Обнаружены нежелательные файлы в коммите: ${stagedUnsafe.join(', ')}`);
  }

  if (staged.length) {
    console.log('Будут опубликованы:');
    for (const path of staged) console.log('  ' + path);

    console.log('\n[3/4] Создаю коммит...\n');
    run('git', ['commit', '-m', 'Update archive']);
  } else {
    console.log('Готовых новых изменений нет. Черновики и templates/ не затронуты.');
    console.log('Проверю также, нет ли ранее созданных, но не отправленных коммитов.');
  }

  console.log('\n[4/4] Отправляю на GitHub...\n');
  run('git', ['push', 'origin', 'main']);
  console.log('\nГотово. GitHub Actions запустит публикацию на REG.RU.');
} catch (error) {
  console.error(`\nПубликация остановлена: ${error.message}`);
  process.exitCode = 1;
}
