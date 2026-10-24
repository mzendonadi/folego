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
    // Com metadados de verdade no MP4 (data de criação, marca, "SoundHandler"): o ffmpeg os copiaria para o OpusTags e a Meta recusaria o arquivo.
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-metadata', 'creation_time=2026-10-24T22:26:13.000000Z', '-metadata:s:a', 'handler_name=SoundHandler', '-metadata', 'comment=um texto bem comprido para deixar o bloco de metadados passar de duzentos e cinquenta e cinco bytes e se espalhar por mais de uma pagina do ogg opus ................................................', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', mp4]);
    assert.equal(r.status, 0, String(r.stderr));
    const ogg = await voiceToOgg(readFileSync(mp4));
    assert.ok(ogg, 'converteu');
    assert.equal(ogg!.subarray(0, 4).toString('latin1'), 'OggS');
    assert.ok(ogg!.includes('OpusHead'), 'o codec é Opus');
    assert.equal(ogg!.readUInt8(ogg!.indexOf('OpusHead') + 9), 1, 'mono (1 canal)');
    // Cabeçalho limpo: sem os metadados do MP4 (era isso que fazia a Meta ler o arquivo como octet-stream).
    const texto = ogg!.toString('latin1');
    for (const lixo of ['creation_time', 'handler_name', 'major_brand', 'SoundHandler', 'um texto bem comprido']) assert.ok(!texto.includes(lixo), `sem "${lixo}" nos metadados`);
    const tagsAt = ogg!.indexOf('OpusTags');
    const proxPagina = ogg!.indexOf('OggS', tagsAt);
    assert.ok(proxPagina - tagsAt < 200, `OpusTags curto (${proxPagina - tagsAt} bytes até a próxima página)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('voz: arquivo que não é áudio não derruba nada (devolve null e o original segue)', async () => {
  assert.equal(await voiceToOgg(Buffer.from('isto não é áudio')), null);
});
