// Opportunistic peer checks and server-confirmed evidence. See docs/design/network.md.
import { trustHash } from '../../../shared/trust.js';
import { compactResult, fitResult } from '../../sim/spec.js';

// Compare the same compact wire result on both peers, before server-only settlement normalization.
export const trustResultHash = (result, battleId = '') => trustHash(fitResult(compactResult(result), { battleId }));

export class MatchTrust {
  /** One task per connected teammate; never use the authority as its own verifier. */
  _launchTrust(fields) {
    if (this.requireCs) return;
    const candidates = fields.filter((f) => (f.trustLevel ?? this.trustLevel) !== 'L0'
      && f.mode === 'client' && f.kind !== 'boss' && f.kind !== 'hidden');
    if (!candidates.length) return;
    const peers = [...this.players.values()].filter((p) => !p.isBot && !p.left && p.connected);
    // Rotate without consuming gameplay RNG; the same input journal must reproduce the assignment.
    const rotation = parseInt(trustHash(fields.map((f) => f.battleId)).slice(0, 8), 16);
    if (peers.length) peers.push(...peers.splice(0, rotation % peers.length));
    const assigned = new Map();
    const place = (f, seen) => {
      for (const p of peers) {
        if (p.playerId === f.authority || seen.has(p.playerId)) continue;
        seen.add(p.playerId);
        const old = assigned.get(p.playerId);
        if (!old || place(old, seen)) { assigned.set(p.playerId, f); return true; }
      }
      return false;
    };
    for (const f of candidates) place(f, new Set());
    for (const [executor, f] of assigned) {
      const task = { id: f.battleId, executor, authority: f.authority, specHash: trustHash(f.spec), digest: null };
      f.trustTask = task;
      if (this.sendTo(executor, { t: 'b.verify', taskId: task.id, specHash: task.specHash, spec: f.spec, officialCs: this.cs || null })) {
        this.trustStats.delegated++;
      } else this._dropTrust(f);
    }
  }

  _onVerifyResult(ps, msg) {
    const f = this.fields.find((field) => field.trustTask?.id === msg.taskId);
    const task = f?.trustTask;
    if (!task || task.executor !== ps.playerId || task.digest || f.done || f.mode !== 'client') return;
    if (msg.error === true || msg.specHash !== task.specHash || !/^[a-f0-9]{64}$/.test(msg.digest || '')) {
      this._dropTrust(f);
      return;
    }
    task.digest = msg.digest;
    this.trustStats.answered++;
  }

  /** Never wait for a peer: only a report already received can trigger server adjudication. */
  _peerDispute(f, result) {
    const task = f.trustTask;
    if (!task) { if ((f.trustLevel ?? this.trustLevel) !== 'L0') this.trustStats.fallbacks++; return null; }
    // A completed reply remains usable after the peer disconnects.
    const digest = task.digest;
    this._dropTrust(f);
    if (!digest) { this.trustStats.fallbacks++; return null; }
    if (digest === trustResultHash(result, f.battleId)) { f.trustAuditPeer = task; this.trustStats.agreements++; return null; }
    this.trustStats.disputes++;
    return task;
  }

  _confirmTrust(f, server, authorityResult, dispute = null) {
    if (!this.trustExplicit) return;
    const digest = trustResultHash(server, f.battleId);
    const authorityWrong = digest !== trustResultHash(authorityResult, f.battleId);
    const verifierWrong = !!dispute && digest !== dispute.digest;
    if (!authorityWrong && !verifierWrong) return;
    this.trustStats.confirmed++;
    this.trustLevel = 'L2';
    if (this.verifyMode !== 'all') this.verifyMode = 'sample';
    // Evidence is private, bounded by the match and the existing session lifetime. No client disagreement alone
    // invokes the callback; a failed/synthetic server simulation cannot confirm a dispute.
    const ids = [];
    if (authorityWrong) ids.push(dispute?.authority || f.authority);
    if (verifierWrong) ids.push(dispute.executor);
    for (const id of new Set(ids.filter(Boolean))) {
      try { this.onTrustDispute?.(id); } catch (e) { this.reportError('trust evidence', e); }
    }
  }

  _dropTrust(f) {
    const task = f?.trustTask;
    if (!task) return;
    f.trustTask = null;
    this.sendTo(task.executor, { t: 'b.verifyCancel', taskId: task.id });
  }
}
