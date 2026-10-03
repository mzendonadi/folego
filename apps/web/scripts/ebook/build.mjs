// Gera o eBook do Fôlego em PDF: node apps/web/scripts/ebook/build.mjs
// Saída: apps/api/src/assets/folego-ebook.pdf (o servidor importa este arquivo como eBook padrão na primeira subida).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBook } from './engine.mjs';
import { part1 } from './part1.mjs';
import { part2 } from './part2.mjs';
import { part3 } from './part3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../../api/src/assets/folego-ebook.pdf');

const book = await createBook({ title: 'Respira: o guia do Fôlego para organizar o dinheiro e conquistar tranquilidade', author: 'Fôlego' });
book.cover({
  kicker: 'eBook · guia de finanças pessoais',
  title: ['Respira.', 'Organiza.', 'Avança.'],
  subtitle: 'O guia do Fôlego para organizar o dinheiro, sair do vermelho e conquistar tranquilidade e liberdade financeira.',
  author: 'Edição presente · Prumo, o app de finanças do Fôlego',
});
part1(book);
part2(book);
part3(book);
book.fillToc();
book.back({ lines: ['Obrigado por respirar com a gente.', 'Volte aqui sempre que precisar de um fôlego novo.'], url: 'folego.online' });
const bytes = await book.save();
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, bytes);
console.log(`eBook gerado: ${book.pdf.getPageCount()} páginas, ${(bytes.length / 1024).toFixed(0)} KB -> ${out}`);
