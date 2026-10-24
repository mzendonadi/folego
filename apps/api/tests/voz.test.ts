import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { voiceToOgg } from '../src/wa-media.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('voz: gravação em MP4 fragmentado (como o Chrome grava) vira OGG/Opus mono que o WhatsApp aceita', { skip: hasFfmpeg ? false : 'ffmpeg não está instalado nesta máquina' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'folego-teste-voz-'));
  try {
    const mp4 = join(dir, 'chrome.m4a');
    // Seno de 1 s em AAC, em MP4 fragmentado (moov vazio + fragmentos), igual à saída do MediaRecorder do Chrome.
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', mp4]);
    assert.equal(r.status, 0, String(r.stderr));
    const ogg = await voiceToOgg(readFileSync(mp4));
    assert.ok(ogg, 'converteu');
    assert.equal(ogg!.subarray(0, 4).toString('latin1'), 'OggS');
    assert.ok(ogg!.includes('OpusHead'), 'o codec é Opus');
    assert.equal(ogg!.readUInt8(ogg!.indexOf('OpusHead') + 9), 1, 'mono (1 canal)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('voz: arquivo que não é áudio não derruba nada (devolve null e o original segue)', async () => {
  assert.equal(await voiceToOgg(Buffer.from('isto não é áudio')), null);
});
