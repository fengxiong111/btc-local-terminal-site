import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRecovery } from './tail-recovery-gate.mjs';
const now = Date.parse('2026-10-18T12:00:00Z');
const snap = ms => ({ schema: 'tail-convexity-v1', generated_at_ms: now - ms, state: 'WATCH', board: [] });
const metrics = ms => ({ schema: 'btc-metrics-v1', observed_at_ms: now - ms, status: 'LIVE' });
const pastRun = (minutes,status='completed') => ({ createdAt: new Date(now-minutes*60000).toISOString(), status });
test('healthy scan is left alone',()=>assert.equal(decideRecovery(snap(30*60000),metrics(30*60000),[],now).status,'HEALTHY'));
test('no run for over 45 minutes triggers recovery when stale',()=>assert.equal(decideRecovery(snap(75*60000),metrics(75*60000),[pastRun(80)],now).status,'DISPATCH_REQUIRED'));
test('a newly dispatched scan blocks duplicate recovery',()=>assert.equal(decideRecovery(snap(150*60000),metrics(150*60000),[pastRun(5)],now).status,'WAIT_RECENT_SCAN'));
test('in-progress scan blocks duplicate recovery even when old',()=>assert.equal(decideRecovery(snap(150*60000),metrics(150*60000),[pastRun(55,'in_progress')],now).status,'WAIT_RECENT_SCAN'));
test('stale metrics independently triggers recovery',()=>assert.equal(decideRecovery(snap(12*60000),metrics(100*60000),[pastRun(100)],now).status,'DISPATCH_REQUIRED'));
test('blocked scanner state triggers recovery only after cooldown',()=>assert.equal(decideRecovery({...snap(2*60000),state:'BLOCKED_DATA'},metrics(2*60000),[pastRun(2)],now).status,'WAIT_RECENT_SCAN'));
test('invalid upstream run history fails closed',()=>assert.equal(decideRecovery(snap(150*60000),metrics(150*60000),null,now).status,'BLOCKED_RUN_HISTORY'));
test('future timestamps fail closed',()=>assert.equal(decideRecovery({...snap(0),generated_at_ms:now+180000},metrics(2*60000),[],now).status,'BLOCKED_CLOCK'));

test('recent rerun completion suppresses new dispatch despite old createdAt',()=>assert.equal(decideRecovery(snap(150*60000),metrics(150*60000),[{...pastRun(130), updatedAt:new Date(now-5*60000).toISOString()}],now).status,'WAIT_RECENT_SCAN'));
test('mismatched metrics and put scan are not considered healthy',()=>assert.equal(decideRecovery(snap(10*60000),metrics(30*60000),[pastRun(60)],now).status,'DISPATCH_REQUIRED'));
