import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as offerUI from '../../public/js/ui/offerOverlay.js';
import { OfferView, offerPickable, offerSeat } from '../../public/js/ui/offerOverlay.js';
import { spTap } from '../../public/js/ui/choiceOverlay.js';
import { Button, Countdown } from '../../public/js/ui/components.js';

const offer = { id: 'pick', pluginId: 'demo', seq: 1, deadline: 10000, windowSec: 10, waiting: 2,
  seats: [{ playerId: 'p', picked: false, slots: [
    { idx: 0, id: 'one', name: '<script>bad</script>', desc: 'First description', icon: 'funds', remaining: 1 },
    { idx: 1, id: 'two', name: 'Second', desc: 'Second description', icon: 'item', remaining: 0 },
  ] }] };
function* walk(v) {
  if (Array.isArray(v)) { for (const c of v) yield* walk(c); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const nodes = props => [...walk(OfferView({ offer, myId: 'p', ...props }))];

test('native offer view renders source names/descriptions, timer, pick and bounded refresh controls', () => {
  const tree = nodes({});
  const cards = tree.filter(n => n.type === 'button');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].props['aria-label'], '<script>bad</script>');
  assert.ok(tree.some(n => n.props?.children === 'First description'));
  assert.ok(tree.some(n => n.type === Countdown && n.props.deadline === 10000));
  const refreshes = tree.filter(n => n.type === Button);
  assert.equal(refreshes.length, 2);
  assert.equal(refreshes[0].props.disabled, false);
  assert.equal(refreshes[1].props.disabled, true);
  assert.ok(tree.every(n => !n.props?.dangerouslySetInnerHTML));
});

test('two-tap/keyboard confirmation, busy state and spectator read-only behavior match choice cards', () => {
  assert.deepEqual(spTap(null, 0, true), { armed: 0, pick: null });
  assert.deepEqual(spTap(0, 0, true), { armed: null, pick: 0 });
  assert.equal(offerPickable(offer, 'p', false, null), true);
  assert.equal(offerPickable(offer, 'p', true, null), false);
  assert.equal(offerPickable(offer, 'p', false, 'busy'), false);
  assert.equal(offerSeat(offer, 'spectator'), null);
  for (const props of [{ readOnly: true }, { myId: 'spectator' }, { busy: 'sending' }]) {
    assert.ok(nodes(props).filter(n => n.type === 'button' || n.type === Button).every(n => n.props.disabled));
  }
});

test('a completed seat waits for its team with disabled picks and refreshes', () => {
  const tree = nodes({ offer: { ...offer, seats: [{ ...offer.seats[0], picked: true }] } });
  assert.ok(tree.filter(n => n.type === 'button' || n.type === Button).every(n => n.props.disabled));
  assert.match(JSON.stringify(tree.filter(n => n.props?.role === 'status').map(n => n.props.children)), /等待队友/);
});

test('offer dialog owns Escape/Tab, suppresses match shortcuts and permits large text scrolling', () => {
  const ui = readFileSync('public/js/ui/offerOverlay.js', 'utf8');
  const css = readFileSync('public/css/screens/game-panels.css', 'utf8');
  const game = readFileSync('public/js/screens/game.js', 'utf8');
  assert.match(ui, /e.key === 'Escape'/);
  assert.match(ui, /e.key !== 'Tab'/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(game, /document.querySelector\('\.offerov\[role="dialog"\]'\)/);
  assert.match(css, /\.offerov \.spov__inner[^}]*overflow: auto/);
  assert.match(css, /\.offerov \.spcard__desc[^}]*overflow: visible/);
});


test('nonblocking windows release prep and completed seats while retaining a reopen control', () => {
  const pending = { ...offer, quorum: 'none' };
  const completed = { ...pending, seats: [{ ...pending.seats[0], picked: true }] };
  assert.equal(offerUI.offerBlocksPrep([pending]), false);
  assert.equal(offerUI.offerBlocksPrep([completed]), false);
  assert.equal(offerUI.offerVisible([pending], 'p'), pending);
  assert.equal(offerUI.offerVisible([pending], 'p', [pending.seq]), null, 'minimized until reopened');
  assert.equal(offerUI.offerVisible([pending], 'p', [pending.seq], { seq: pending.seq, picked: false }), pending);
  assert.equal(offerUI.offerVisible([completed], 'p', [], { seq: pending.seq, picked: false }), null, 'pick auto-collapses');
  assert.equal(offerUI.offerVisible([completed], 'p', [], { seq: completed.seq, picked: true }), completed);
  const blocking = { ...completed, seq: 2, quorum: 'all' };
  assert.equal(offerUI.offerBlocksPrep([pending, blocking]), true);
  assert.equal(offerUI.offerVisible([blocking], 'p', [2]), blocking, 'cannot dismiss a blocking window');
  const opened = [];
  const dock = [...walk(offerUI.OfferDock({ offers: [completed], myId: 'p', onOpen: o => opened.push(o.seq) }))];
  dock.find(n => n.type === Button).props.onClick();
  assert.deepEqual(opened, [completed.seq]);
});

test('prep editing and shortcuts depend on blocking state and the visible dialog', () => {
  const game = readFileSync('public/js/screens/game.js', 'utf8');
  assert.doesNotMatch(game, /const editable = !hasOffers/);
  assert.doesNotMatch(game, /hasPersonalChoice \|\| hasOffers\) && 'has-sp'/, 'minimized windows must not hide the prep bond/effect panels');
  assert.match(game, /const editable = !offerBlocksPrep\(pub\?\.offers\)/);
  assert.doesNotMatch(game, /if \(L.pub\?\.offers\?\.length\) return/);
  assert.match(game, /document.querySelector\('\.offerov\[role="dialog"\]'\)/);
});

test('unavailable cards cannot be picked but can still be refreshed', () => {
  const tree = nodes({ offer: { ...offer, seats: [{ ...offer.seats[0], slots: [{ ...offer.seats[0].slots[0], available: false }] }] } });
  assert.equal(tree.find(n => n.type === 'button').props.disabled, true);
  assert.equal(tree.find(n => n.type === Button).props.disabled, false);
  assert.ok(tree.some(n => n.props?.class === 'spcard__unavailable'));
});
