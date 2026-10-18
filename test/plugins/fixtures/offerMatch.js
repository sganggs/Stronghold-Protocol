// A real Match in the production content host, stopped at its first offer for IPC assertions.
import { Match as RealMatch } from '../../../server/match/Match.js';
export class Match extends RealMatch {
  start() {
    this.openOfferWindow('prep', 3);
    this.broadcast({ t: 'm.public', offers: this.offerViews() });
  }
}
