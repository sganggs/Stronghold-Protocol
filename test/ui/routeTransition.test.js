// Unit tests for ui/routeTransition.js — the hierarchy mapping of route changes (DESIGN §10):
// the title is an independent system (fade), lobby/room push and pop, the match zooms in and out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeTransition } from '../../public/js/ui/routeTransition.js';

describe('routeTransition (hierarchy mapping)', () => {
  test('the title is an independent system → fade', () => {
    assert.equal(routeTransition('title', 'lobby'), 'fade');
    assert.equal(routeTransition('lobby', 'title'), 'fade');
  });

  test('lobby ↔ room is push / pop', () => {
    assert.equal(routeTransition('lobby', 'room'), 'push');
    assert.equal(routeTransition('room', 'lobby'), 'pop');
  });

  test('the match zooms in and back out', () => {
    assert.equal(routeTransition('room', 'game'), 'zoomin');
    assert.equal(routeTransition('game', 'room'), 'zoomout');
    assert.equal(routeTransition('lobby', 'game'), 'zoomin', 'a deep link that skips the room still zooms in');
  });

  test('nothing changes on the same route', () => {
    assert.equal(routeTransition('room', 'room'), null);
    assert.equal(routeTransition('game', 'game'), null);
  });
});
