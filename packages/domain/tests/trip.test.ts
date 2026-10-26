import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripPlan, splitBudget, validateTrip, TripInputError } from '../src/trip.ts';
import type { TripInput } from '../src/trip.ts';

const hoje = '2026-10-25';
const base: TripInput = {
  name: 'Férias de janeiro', destination: 'Florianópolis', origin: 'Uberlândia', startDate: '2027-01-10', endDate: '2027-01-19',
  kind: 'carro', adults: 2, children: 2, seniors: false, pets: false, lodging: 'casa', international: false, budgetCents: 600_000, notes: '',
};

test('férias: noites, dias, por dia e por pessoa saem das datas e do orçamento', () => {
  const p = buildTripPlan(base, hoje);
  assert.deepEqual([p.days, p.nights, p.people], [10, 9, 4]);
  assert.equal(p.perDayCents, 60_000);
  assert.equal(p.perPersonCents, 150_000);
});

test('férias: a divisão fecha em 100% e no valor exato, para qualquer tipo de viagem e hospedagem', () => {
  for (const kind of ['carro', 'aviao', 'onibus', 'motorhome', 'navio'] as const) {
    for (const lodging of ['hotel', 'casa', 'camping', 'familia'] as const) {
      for (const international of [false, true]) {
        const lines = splitBudget(kind, lodging, international, 1_234_567);
        assert.equal(lines.reduce((s, l) => s + l.pct, 0), 100, `${kind}/${lodging}/${international}: porcentagens`);
        assert.equal(lines.reduce((s, l) => s + (l.cents ?? 0), 0), 1_234_567, `${kind}/${lodging}/${international}: centavos`);
        assert.ok(lines.every((l) => l.pct >= 0 && (l.cents ?? 0) >= 0));
      }
    }
  }
  assert.ok(splitBudget('carro', 'hotel', false, null).every((l) => l.cents === null), 'sem orçamento não inventa valor');
  const hotel = splitBudget('carro', 'hotel', false, null).find((l) => l.id === 'hospedagem')!.pct;
  const parentes = splitBudget('carro', 'familia', false, null).find((l) => l.id === 'hospedagem')!.pct;
  assert.ok(parentes < hotel / 2, 'na casa de parentes a hospedagem pesa bem menos');
});

test('férias: quanto guardar por mês até a viagem', () => {
  const p = buildTripPlan(base, hoje); // 77 dias até 10/01
  assert.equal(p.daysUntil, 77);
  assert.deepEqual(p.saving, { monthsLeft: 3, perMonthCents: 200_000 });
  const perto = buildTripPlan({ ...base, startDate: '2026-10-30', endDate: '2026-11-02' }, hoje);
  assert.equal(perto.saving?.monthsLeft, 1);
  assert.equal(buildTripPlan({ ...base, budgetCents: null }, hoje).saving, null);
});

test('checklist: muda com o tipo de viagem, a família, os bichos e o destino, sem repetir item', () => {
  const ids = (i: Partial<TripInput>) => buildTripPlan({ ...base, ...i }, hoje).checklist.map((c) => c.id);
  assert.ok(ids({ kind: 'carro' }).includes('car-revisao'));
  assert.ok(ids({ kind: 'carro', children: 2 }).includes('car-cadeirinha'));
  assert.ok(!ids({ kind: 'carro', children: 0 }).includes('car-cadeirinha'));
  assert.ok(ids({ kind: 'motorhome', lodging: 'camping' }).includes('mh-gas'));
  assert.ok(ids({ kind: 'motorhome', lodging: 'camping' }).includes('mh-agua'));
  assert.ok(ids({ kind: 'aviao' }).includes('av-checkin'));
  assert.ok(ids({ kind: 'navio' }).includes('na-embarque'));
  assert.ok(ids({ kind: 'onibus' }).includes('on-bilhete'));
  assert.ok(!ids({ kind: 'aviao' }).includes('car-revisao'));
  assert.ok(ids({ international: true }).includes('doc-passaporte'));
  assert.ok(!ids({ international: false }).includes('doc-passaporte'));
  assert.ok(ids({ pets: true }).includes('pet-vacinas'));
  assert.ok(ids({ seniors: true }).includes('sau-idosos'));
  assert.ok(ids({ children: 0 }).every((id) => !id.startsWith('doc-crian')));
  for (const kind of ['carro', 'aviao', 'onibus', 'motorhome', 'navio'] as const) {
    const all = ids({ kind, lodging: kind === 'motorhome' ? 'camping' : 'hotel', international: true, pets: true, seniors: true });
    assert.equal(new Set(all).size, all.length, `${kind}: ids únicos`);
    assert.ok(all.length >= 30, `${kind}: checklist completo`);
  }
});

test('férias: formulário com problema volta com explicação em português, sem estourar', () => {
  assert.deepEqual(validateTrip(base, hoje), []);
  assert.ok(validateTrip({ ...base, name: ' ' }, hoje).some((x) => /nome/.test(x)));
  assert.ok(validateTrip({ ...base, destination: '' }, hoje).some((x) => /para onde/.test(x)));
  assert.ok(validateTrip({ ...base, endDate: '2027-01-01' }, hoje).some((x) => /volta/.test(x)));
  assert.ok(validateTrip({ ...base, endDate: '2027-06-30' }, hoje).some((x) => /60 dias/.test(x)));
  assert.ok(validateTrip({ ...base, startDate: '2026-09-01', endDate: '2026-09-10' }, hoje).some((x) => /já terminou/.test(x)));
  assert.ok(validateTrip({ ...base, startDate: '2027-02-30' }, hoje).some((x) => /datas/.test(x)));
  assert.ok(validateTrip({ ...base, adults: 0 }, hoje).some((x) => /adultos/.test(x)));
  assert.ok(validateTrip({ ...base, kind: 'motorhome', lodging: 'hotel' }, hoje).some((x) => /camping/.test(x)));
  assert.throws(() => buildTripPlan({ ...base, adults: 0 }, hoje), TripInputError);
});
