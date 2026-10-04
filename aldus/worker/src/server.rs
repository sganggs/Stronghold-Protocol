//! Sessions, the lobby, and the wiring to the match engine.
//!
//! This is the Rust port of two files of the original project: `server/net.js` (one identity for a
//! player across sockets, `hello` / `welcome`, replies with `rid`) and `server/lobby.js` (rooms,
//! seats, the host, AI seats, the removal of a player by the host, spectator seats, start, leave, the
//! return to the lobby when a match ends). The rules of a match are not here: `engine.rs` calls the
//! original engine for them.
//!
//! Everything is in memory (step 1 of aldus/WS-STATE.md): a restart of the Durable Object ends every
//! room. Not ported yet, and listed in README.md: the rate limits, the per-network limits, the result
//! replay after a match, and the coalescing of repeated `hello`s.
//!
//! **Re-entrancy.** The engine calls `send` / `broadcast` / `onEnd` while Rust is inside a call into it
//! (the `Server` is then borrowed) and also from its own timers (it is then free). A callback that finds
//! the `Server` free acts at once; one that finds it borrowed leaves an [`Event`] in the outbox, and
//! every method that calls the engine drains the outbox when the call returns. The order of the
//! frames is the order the engine made them in both cases.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};
use std::time::Duration;

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use worker::{Date, Delay, WebSocket};

use crate::engine::{self, Consts, Fail, Reply};

pub type Shared = Rc<RefCell<Server>>;

/// Close codes of `server/net.js` (`CLOSE`).
const CLOSE_REPLACED: u16 = 4001;
const CLOSE_HELLO_TIMEOUT: u16 = 4002;

fn now_ms() -> u64 {
    Date::now().as_millis()
}

/// What a match asks of the platform (the `send` / `broadcast` / `onEnd` of its interface).
enum Event {
    Send { room: String, match_id: u64, player_id: String, json: String },
    Broadcast { room: String, match_id: u64, json: String },
    End { room: String, match_id: u64 },
}

struct Conn {
    ws: WebSocket,
    session: Option<String>,
    /// We sent a close frame: frames still in flight are ignored.
    closing: bool,
}

/// One player identity; it outlives its sockets for the reconnect window.
struct Session {
    player_id: String,
    token: String,
    name: String,
    conn: Option<u64>,
    connected: bool,
    last_seen: u64,
    room_code: Option<String>,
    /// A `room.closed` reason to deliver on the next resume.
    notice: Option<String>,
    /// The checked operator loadout, as JSON text.
    loadout: Option<String>,
    /// Counts connects and disconnects: a timer armed at a disconnect acts only if nothing changed.
    epoch: u64,
}

#[derive(Clone)]
struct Seat {
    seat: usize,
    player_id: String,
    name: String,
    is_bot: bool,
    ready: bool,
    connected: bool,
    left: bool,
    loadout: Option<String>,
}

/// A spectator seat of a co-op room (`MAX_SPECTATORS`). A spectator is not a player: it is not in
/// `seats`, it is never the host, and it does not keep a room alive. It watches.
#[derive(Clone)]
struct Spectator {
    player_id: String,
    name: String,
    connected: bool,
}

struct MatchHandle {
    id: u64,
    js: JsValue,
    // the engine holds these functions for as long as the match lives
    _send: Closure<dyn FnMut(String, String) -> bool>,
    _broadcast: Closure<dyn FnMut(String)>,
    _on_end: Closure<dyn FnMut(String)>,
}

struct Room {
    code: String,
    mode: String,
    difficulty: String,
    host_id: Option<String>,
    seats: Vec<Option<Seat>>,
    spectators: Vec<Spectator>,
    game: Option<MatchHandle>,
    match_count: u32,
}

impl Room {
    fn seat_of(&self, player_id: &str) -> Option<&Seat> {
        self.seats.iter().flatten().find(|s| s.player_id == player_id)
    }
    fn seat_of_mut(&mut self, player_id: &str) -> Option<&mut Seat> {
        self.seats.iter_mut().flatten().find(|s| s.player_id == player_id)
    }
    fn spectator_of(&self, player_id: &str) -> Option<&Spectator> {
        self.spectators.iter().find(|s| s.player_id == player_id)
    }
    fn spectator_of_mut(&mut self, player_id: &str) -> Option<&mut Spectator> {
        self.spectators.iter_mut().find(|s| s.player_id == player_id)
    }
    fn free_seat(&self) -> Option<usize> {
        self.seats.iter().position(Option::is_none)
    }
    fn active_humans(&self) -> Vec<&Seat> {
        self.seats.iter().flatten().filter(|s| !s.is_bot && !s.left).collect()
    }
    fn state(&self) -> Value {
        let seats: Vec<Value> = self
            .seats
            .iter()
            .map(|s| match s {
                Some(s) => json!({
                    "seat": s.seat, "playerId": s.player_id, "name": s.name, "isBot": s.is_bot,
                    "ready": s.ready, "connected": s.connected && !s.left,
                }),
                None => Value::Null,
            })
            .collect();
        let spectators: Vec<Value> =
            self.spectators.iter().map(|s| json!({ "playerId": s.player_id, "name": s.name, "connected": s.connected })).collect();
        json!({
            "t": "room.state", "code": self.code, "hostId": self.host_id, "mode": self.mode,
            "difficulty": self.difficulty, "inMatch": self.game.is_some(), "seats": seats, "spectators": spectators,
        })
    }
}

pub struct Server {
    me: Weak<RefCell<Server>>,
    consts: Consts,
    conns: HashMap<u64, Conn>,
    sessions: HashMap<String, Session>,
    tokens: HashMap<String, String>,
    rooms: HashMap<String, Room>,
    /// Matches the engine may still send for: running ones, and ended ones until they are disposed.
    live: HashSet<u64>,
    /// Lobby grace timers by player id (the token of the timer that may act).
    grace: HashMap<String, u64>,
    next_id: u64,
    outbox: Rc<RefCell<Vec<Event>>>,
    draining: bool,
}

impl Server {
    pub fn new(consts: Consts) -> Shared {
        Rc::new_cyclic(|me| {
            RefCell::new(Server {
                me: me.clone(),
                consts,
                conns: HashMap::new(),
                sessions: HashMap::new(),
                tokens: HashMap::new(),
                rooms: HashMap::new(),
                live: HashSet::new(),
                grace: HashMap::new(),
                next_id: 0,
                outbox: Rc::new(RefCell::new(Vec::new())),
                draining: false,
            })
        })
    }

    // ---------------------------------------------------------------------------------------------
    // entry points: one borrow each, and the outbox is empty when they return

    /// Adopt an accepted socket. A socket that never says `hello` is closed with 4002.
    pub fn connect(shared: &Shared, ws: WebSocket) -> u64 {
        let mut s = shared.borrow_mut();
        let id = s.id();
        s.conns.insert(id, Conn { ws, session: None, closing: false });
        let ms = s.consts.hello_timeout_ms;
        s.later(ms, move |s| {
            if let Some(c) = s.conns.get_mut(&id) {
                if c.session.is_none() && !c.closing {
                    c.closing = true;
                    let _ = c.ws.close(Some(CLOSE_HELLO_TIMEOUT), Some("hello timeout"));
                }
            }
        });
        id
    }

    /// One frame from a socket; `None` is a binary frame.
    pub fn frame(shared: &Shared, conn_id: u64, text: Option<String>) {
        let mut s = shared.borrow_mut();
        s.on_frame(conn_id, text.as_deref());
        s.drain();
    }

    pub fn closed(shared: &Shared, conn_id: u64) {
        let mut s = shared.borrow_mut();
        s.on_close(conn_id);
        s.drain();
    }

    pub fn health(&self) -> Value {
        json!({
            "ok": true,
            "version": self.consts.protocol_version,
            "app": self.consts.app_version,
            "runtime": "cloudflare-worker",
            "rooms": self.rooms.len(),
            "matches": self.rooms.values().filter(|r| r.game.is_some()).count(),
            "spectators": self.rooms.values().map(|r| r.spectators.len()).sum::<usize>(),
            "sessions": self.sessions.len(),
            "sockets": self.conns.len(),
        })
    }

    // ---------------------------------------------------------------------------------------------
    // plumbing

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    /// Run `f` on the server after `ms`, on a task of its own (the server is free then).
    fn later(&self, ms: u64, f: impl FnOnce(&mut Server) + 'static) {
        let me = self.me.clone();
        wasm_bindgen_futures::spawn_local(async move {
            Delay::from(Duration::from_millis(ms)).await;
            if let Some(rc) = me.upgrade() {
                if let Ok(mut s) = rc.try_borrow_mut() {
                    f(&mut s);
                    s.drain();
                }
            }
        });
    }

    fn drain(&mut self) {
        if self.draining {
            return;
        }
        self.draining = true;
        loop {
            let events = std::mem::take(&mut *self.outbox.borrow_mut());
            if events.is_empty() {
                break;
            }
            for ev in events {
                self.apply(ev);
            }
        }
        self.draining = false;
    }

    fn apply(&mut self, ev: Event) -> bool {
        match ev {
            Event::Send { room, match_id, player_id, json } => self.send_to_player(&room, match_id, &player_id, &json),
            Event::Broadcast { room, match_id, json } => {
                self.broadcast_room(&room, match_id, &json);
                true
            }
            Event::End { room, match_id } => {
                self.on_match_end(&room, match_id);
                true
            }
        }
    }

    fn send_conn(&self, conn_id: u64, text: &str) -> bool {
        match self.conns.get(&conn_id) {
            Some(c) if !c.closing => c.ws.send_with_str(text).is_ok(),
            _ => false,
        }
    }

    fn send_session(&self, player_id: &str, text: &str) -> bool {
        match self.sessions.get(player_id) {
            Some(s) if s.connected => s.conn.is_some_and(|c| self.send_conn(c, text)),
            _ => false,
        }
    }

    /// `errorMsg` of server/net.js.
    fn error_frame(&self, code: &str, rid: Option<u64>, detail: Option<&str>) -> String {
        let code = if self.consts.err_text.contains_key(code) { code } else { "INTERNAL" };
        let msg = self.consts.err_text.get(code).cloned().unwrap_or_default();
        let mut m = json!({ "t": "error", "code": code, "msg": msg });
        if let Some(rid) = rid {
            m["rid"] = json!(rid);
        }
        if let Some(d) = detail.filter(|d| !d.is_empty()) {
            m["detail"] = json!(d.chars().take(120).collect::<String>());
        }
        m.to_string()
    }

    // ---------------------------------------------------------------------------------------------
    // the session layer (server/net.js onFrame / onHelloMsg / onClose)

    fn on_frame(&mut self, conn_id: u64, text: Option<&str>) {
        let Some(conn) = self.conns.get(&conn_id) else { return };
        if conn.closing {
            return;
        }
        let now = now_ms();
        let bound = conn.session.clone();
        if let Some(s) = bound.as_ref().and_then(|pid| self.sessions.get_mut(pid)) {
            if s.conn == Some(conn_id) {
                s.last_seen = now;
            }
        }
        let Some(text) = text else {
            let f = self.error_frame("BAD_MSG", None, Some("binary frame"));
            self.send_conn(conn_id, &f);
            return;
        };
        let info = engine::inspect(text);
        let (Some(t), None) = (info.t.clone(), info.detail.as_deref()) else {
            let f = self.error_frame("BAD_MSG", info.rid, info.detail.as_deref());
            self.send_conn(conn_id, &f);
            return;
        };
        // the engine accepted the frame, so it is JSON
        let msg: Value = serde_json::from_str(text).unwrap_or(Value::Null);
        match t.as_str() {
            "ping" => {
                let mut pong = json!({ "t": "pong", "c": msg["c"], "s": now });
                if let Some(rid) = info.rid {
                    pong["rid"] = json!(rid);
                }
                self.send_conn(conn_id, &pong.to_string());
            }
            "hello" => self.on_hello(conn_id, &msg, info.rid, now),
            _ => {
                let Some(pid) = bound else {
                    let f = self.error_frame("BAD_MSG", info.rid, Some("hello required"));
                    self.send_conn(conn_id, &f);
                    return;
                };
                let res = if t.starts_with("b.") { self.route_game(&pid, &t, text) } else { self.on_message(&pid, &t, &msg, text) };
                self.drain();
                match res {
                    // a battle report without a rid that reached no running match is stale, not a mistake: no answer
                    Err(_) if t == "b.progress" && info.rid.is_none() => {}
                    Err(e) => {
                        let f = self.error_frame(&e.code, info.rid, e.detail.as_deref());
                        self.send_conn(conn_id, &f);
                    }
                    Ok(()) => {
                        if let Some(rid) = info.rid {
                            self.send_conn(conn_id, &json!({ "t": "ok", "rid": rid }).to_string());
                        }
                    }
                }
            }
        }
    }

    fn on_hello(&mut self, conn_id: u64, msg: &Value, rid: Option<u64>, now: u64) {
        if let Some(v) = msg.get("version").filter(|v| !v.is_null()) {
            if v.as_i64() != Some(self.consts.protocol_version) {
                let d = format!("version mismatch: server {}", self.consts.protocol_version);
                let f = self.error_frame("BAD_MSG", rid, Some(&d));
                self.send_conn(conn_id, &f);
                return;
            }
        }
        let Some(name) = msg.get("name").and_then(Value::as_str).and_then(engine::sanitize_name) else {
            let f = self.error_frame("BAD_MSG", rid, Some("bad field name"));
            self.send_conn(conn_id, &f);
            return;
        };

        let bound = self.conns.get(&conn_id).and_then(|c| c.session.clone());
        let repeat = bound.is_some();
        let mut resumed = false;
        let pid = match bound {
            Some(pid) => pid,
            None => {
                let known = msg.get("token").and_then(Value::as_str).and_then(|t| self.tokens.get(t)).cloned();
                let pid = match known {
                    Some(pid) => {
                        resumed = true;
                        // the session moves to this socket: the old one is closed without a disconnect
                        if let Some(old) = self.sessions.get(&pid).and_then(|s| s.conn).filter(|c| *c != conn_id) {
                            if let Some(c) = self.conns.get_mut(&old) {
                                c.session = None;
                                c.closing = true;
                                let _ = c.ws.close(Some(CLOSE_REPLACED), Some("session replaced"));
                            }
                        }
                        pid
                    }
                    None => {
                        let mut pid = format!("p_{}", engine::random_hex(5));
                        while self.sessions.contains_key(&pid) {
                            pid = format!("p_{}", engine::random_hex(5));
                        }
                        let token = engine::random_hex(16);
                        self.tokens.insert(token.clone(), pid.clone());
                        self.sessions.insert(pid.clone(), Session {
                            player_id: pid.clone(),
                            token,
                            name: name.clone(),
                            conn: None,
                            connected: false,
                            last_seen: now,
                            room_code: None,
                            notice: None,
                            loadout: None,
                            epoch: 0,
                        });
                        pid
                    }
                };
                if let Some(c) = self.conns.get_mut(&conn_id) {
                    c.session = Some(pid.clone());
                }
                if let Some(s) = self.sessions.get_mut(&pid) {
                    s.conn = Some(conn_id);
                    s.connected = true;
                    s.epoch += 1;
                }
                pid
            }
        };
        let Some(s) = self.sessions.get_mut(&pid) else { return };
        s.name = name;
        s.last_seen = now;
        let mut welcome = json!({
            "t": "welcome", "playerId": s.player_id, "token": s.token, "name": s.name, "serverNow": now,
            "version": self.consts.protocol_version, "resumed": resumed,
        });
        if let Some(rid) = rid {
            welcome["rid"] = json!(rid);
        }
        self.send_conn(conn_id, &welcome.to_string());
        self.lobby_on_hello(&pid, resumed, repeat);
        self.drain();
    }

    fn on_close(&mut self, conn_id: u64) {
        let Some(conn) = self.conns.remove(&conn_id) else { return };
        let Some(pid) = conn.session else { return };
        let Some(s) = self.sessions.get_mut(&pid) else { return };
        if s.conn != Some(conn_id) {
            return;
        }
        s.conn = None;
        s.connected = false;
        s.epoch += 1;
        let epoch = s.epoch;
        let window = self.lobby_on_disconnect(&pid);
        // the reconnect window: the session, and its seat with it, goes when nobody came back
        let gone = pid.clone();
        self.later(window, move |s| {
            if s.sessions.get(&gone).is_some_and(|x| !x.connected && x.epoch == epoch) {
                s.expire(&gone);
            }
        });
    }

    fn expire(&mut self, player_id: &str) {
        let Some(s) = self.sessions.remove(player_id) else { return };
        self.tokens.remove(&s.token);
        if let Some(code) = s.room_code {
            self.remove_member(&code, player_id);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // the lobby (server/lobby.js)

    /// The session's room; a stale `room_code` is cleared.
    fn room_of(&mut self, player_id: &str) -> Option<String> {
        let code = self.sessions.get(player_id)?.room_code.clone()?;
        // a player seat, or a spectator seat
        let seated = self.rooms.get(&code).is_some_and(|r| match r.seat_of(player_id) {
            Some(s) => !s.left && !s.is_bot,
            None => r.spectator_of(player_id).is_some(),
        });
        if !seated {
            if let Some(s) = self.sessions.get_mut(player_id) {
                s.room_code = None;
            }
            return None;
        }
        Some(code)
    }

    fn lobby_on_hello(&mut self, player_id: &str, resumed: bool, repeat: bool) {
        if !resumed && !repeat {
            return;
        }
        let Some(code) = self.room_of(player_id) else {
            if let Some(reason) = self.sessions.get_mut(player_id).and_then(|s| s.notice.take()) {
                self.send_session(player_id, &json!({ "t": "room.closed", "reason": reason }).to_string());
            }
            return;
        };
        self.grace.remove(player_id);
        let name = self.sessions.get(player_id).map(|s| s.name.clone()).unwrap_or_default();
        if let Some(s) = self.sessions.get_mut(player_id) {
            s.notice = None;
        }
        // only a change others can see is broadcast; a plain resync answers the requester alone
        let mut changed = false;
        let mut spectator = false;
        if let Some(room) = self.rooms.get_mut(&code) {
            let in_match = room.game.is_some();
            if let Some(seat) = room.seat_of_mut(player_id) {
                changed = !seat.connected;
                seat.connected = true;
                if !in_match && seat.name != name {
                    seat.name = name;
                    changed = true;
                }
            } else if let Some(seat) = room.spectator_of_mut(player_id) {
                spectator = true;
                changed = !seat.connected;
                seat.connected = true;
                if !in_match && seat.name != name {
                    seat.name = name;
                    changed = true;
                }
            }
            if room.host_id.is_none() {
                changed = true;
            }
        }
        if self.rooms.get(&code).is_some_and(|r| r.host_id.is_none()) {
            self.migrate_host(&code);
        }
        if changed {
            self.broadcast_state(&code);
        } else if let Some(text) = self.rooms.get(&code).map(|r| r.state().to_string()) {
            self.send_session(player_id, &text);
        }
        // the full match state again; a spectator gets what a spectator may see
        if let Some(js) = self.rooms.get(&code).and_then(|r| r.game.as_ref()).map(|g| g.js.clone()) {
            engine::match_call(&js, if spectator { "addSpectator" } else { "onReconnect" }, player_id);
            self.drain();
        }
    }

    /// The socket of a session closed. Returns the reconnect window of that session (ms).
    fn lobby_on_disconnect(&mut self, player_id: &str) -> u64 {
        let Some(code) = self.room_of(player_id) else { return self.consts.reconnect_window_ms };
        let Some(room) = self.rooms.get_mut(&code) else { return self.consts.reconnect_window_ms };
        // a solo run may be resumed for 24 h; every other session keeps the 10 minutes
        let window = if room.game.is_some() && room.mode == "solo" { self.consts.solo_resume_ms } else { self.consts.reconnect_window_ms };
        // a spectator's seat is kept like a player's, but the match is not told: a spectator plays no field
        let player = match room.seat_of_mut(player_id) {
            Some(seat) => {
                seat.connected = false;
                true
            }
            None => {
                if let Some(seat) = room.spectator_of_mut(player_id) {
                    seat.connected = false;
                }
                false
            }
        };
        match room.game.as_ref().map(|g| g.js.clone()) {
            Some(js) => {
                if player {
                    engine::match_call(&js, "onDisconnect", player_id);
                    self.drain();
                }
            }
            None => self.start_grace(&code, player_id),
        }
        self.broadcast_state(&code);
        window
    }

    fn on_message(&mut self, pid: &str, t: &str, msg: &Value, text: &str) -> Reply {
        let str_of = |k: &str| msg.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        match t {
            "room.create" => self.create(pid, str_of("mode"), str_of("difficulty")),
            "room.join" => self.join(pid, &str_of("code")),
            "room.leave" => match self.room_of(pid) {
                Some(code) => {
                    self.remove_member(&code, pid);
                    Ok(())
                }
                None => Err(Fail::new("NOT_IN_ROOM")),
            },
            "room.ready" => self.ready(pid, msg.get("ready").and_then(Value::as_bool).unwrap_or(false)),
            "room.setDifficulty" => self.set_difficulty(pid, str_of("difficulty")),
            "room.addBot" => self.add_bot(pid),
            "room.removeBot" => self.remove_bot(pid, msg.get("seat").and_then(Value::as_u64).unwrap_or(u64::MAX) as usize),
            "room.kick" => self.kick(pid, msg.get("seat").and_then(Value::as_u64).unwrap_or(u64::MAX) as usize, &str_of("playerId")),
            "room.start" => self.start(pid),
            "room.loadout" => self.loadout(pid, msg.get("entries").unwrap_or(&Value::Null)),
            "room.spectate" => self.spectate(pid, &str_of("code")),
            "room.removeSpectator" => self.remove_spectator(pid, &str_of("playerId")),
            _ if t.starts_with("g.") => self.route_game(pid, t, text),
            _ => Err(Fail::with("BAD_MSG", &format!("unhandled type {}", t.chars().take(32).collect::<String>()))),
        }
    }

    fn human_seat(&self, idx: usize, player_id: &str) -> Option<Seat> {
        let s = self.sessions.get(player_id)?;
        Some(Seat {
            seat: idx,
            player_id: s.player_id.clone(),
            name: s.name.clone(),
            is_bot: false,
            ready: false,
            connected: s.connected,
            left: false,
            loadout: s.loadout.clone(),
        })
    }

    fn gen_code(&self) -> Option<String> {
        let letters: Vec<char> = self.consts.code_alphabet.chars().collect();
        if letters.is_empty() {
            return None;
        }
        for _ in 0..1000 {
            let code: String = (0..self.consts.room_code_len).map(|_| letters[engine::random_u32() as usize % letters.len()]).collect();
            if !self.rooms.contains_key(&code) {
                return Some(code);
            }
        }
        None
    }

    fn create(&mut self, pid: &str, mode: String, difficulty: String) -> Reply {
        let cur = self.room_of(pid);
        if cur.as_ref().and_then(|c| self.rooms.get(c)).is_some_and(|r| r.game.is_some()) {
            return Err(Fail::with("ROOM_STARTED", "leave your running match first"));
        }
        if self.rooms.len() >= self.consts.max_rooms {
            return Err(Fail::with("INTERNAL", "too many rooms"));
        }
        let Some(code) = self.gen_code() else { return Err(Fail::with("INTERNAL", "no room code available")) };
        if let Some(cur) = cur {
            self.remove_member(&cur, pid);
        }
        let mut seats: Vec<Option<Seat>> = vec![None; self.consts.max_seats];
        seats[0] = self.human_seat(0, pid);
        self.rooms.insert(code.clone(), Room { code: code.clone(), mode, difficulty, host_id: Some(pid.to_string()), seats, spectators: Vec::new(), game: None, match_count: 0 });
        if let Some(s) = self.sessions.get_mut(pid) {
            s.room_code = Some(code.clone());
            s.notice = None;
        }
        self.broadcast_state(&code);
        Ok(())
    }

    fn join(&mut self, pid: &str, code: &str) -> Reply {
        let norm = code.trim().to_uppercase();
        if norm.chars().count() != self.consts.room_code_len || !self.rooms.contains_key(&norm) {
            return Err(Fail::new("ROOM_NOT_FOUND"));
        }
        let cur = self.room_of(pid);
        // a member gets the state again; a spectator of this room goes on: it may take a free player seat
        if cur.as_deref() == Some(norm.as_str()) && self.rooms[&norm].spectator_of(pid).is_none() {
            if let Some(text) = self.rooms.get(&norm).map(|r| r.state().to_string()) {
                self.send_session(pid, &text);
            }
            return Ok(());
        }
        if cur.as_ref().and_then(|c| self.rooms.get(c)).is_some_and(|r| r.game.is_some()) {
            return Err(Fail::with("ROOM_STARTED", "leave your running match first"));
        }
        let room = &self.rooms[&norm];
        if room.game.is_some() {
            return Err(Fail::new("ROOM_STARTED"));
        }
        if room.mode == "solo" {
            return Err(Fail::with("ROOM_FULL", "solo room"));
        }
        let Some(idx) = room.free_seat() else { return Err(Fail::new("ROOM_FULL")) };
        if let Some(cur) = cur {
            self.remove_member(&cur, pid);
        }
        let seat = self.human_seat(idx, pid);
        if let Some(room) = self.rooms.get_mut(&norm) {
            room.seats[idx] = seat;
            if room.host_id.is_none() {
                room.host_id = Some(pid.to_string());
            }
        }
        if let Some(s) = self.sessions.get_mut(pid) {
            s.room_code = Some(norm.clone());
            s.notice = None;
        }
        self.broadcast_state(&norm);
        Ok(())
    }

    /// The room of a lobby request that only its host, or any member, may make before a match.
    fn lobby_room(&mut self, pid: &str, host_only: bool) -> Result<String, Fail> {
        let code = self.room_of(pid).ok_or_else(|| Fail::new("NOT_IN_ROOM"))?;
        let room = &self.rooms[&code];
        if host_only && room.host_id.as_deref() != Some(pid) {
            return Err(Fail::new("NOT_HOST"));
        }
        if room.game.is_some() {
            return Err(Fail::new("ROOM_STARTED"));
        }
        Ok(code)
    }

    fn ready(&mut self, pid: &str, ready: bool) -> Reply {
        let code = self.room_of(pid).ok_or_else(|| Fail::new("NOT_IN_ROOM"))?;
        if self.rooms[&code].spectator_of(pid).is_some() {
            return Err(Fail::new("SPECTATOR"));
        }
        let code = self.lobby_room(pid, false).map(|_| code)?;
        let changed = self.rooms.get_mut(&code).and_then(|r| r.seat_of_mut(pid)).is_some_and(|seat| {
            let changed = seat.ready != ready;
            seat.ready = ready;
            changed
        });
        if changed {
            self.broadcast_state(&code);
        }
        Ok(())
    }

    fn set_difficulty(&mut self, pid: &str, difficulty: String) -> Reply {
        let code = self.lobby_room(pid, true)?;
        let Some(room) = self.rooms.get_mut(&code) else { return Ok(()) };
        if room.difficulty != difficulty {
            room.difficulty = difficulty;
            let host = room.host_id.clone();
            for s in room.seats.iter_mut().flatten() {
                if !s.is_bot && Some(&s.player_id) != host.as_ref() {
                    s.ready = false;
                }
            }
            self.broadcast_state(&code);
        }
        Ok(())
    }

    fn add_bot(&mut self, pid: &str) -> Reply {
        let code = self.lobby_room(pid, true)?;
        let room = &self.rooms[&code];
        if room.mode == "solo" {
            return Err(Fail::with("ROOM_FULL", "solo rooms cannot have AI teammates"));
        }
        let Some(idx) = room.free_seat() else { return Err(Fail::new("ROOM_FULL")) };
        let used: HashSet<&str> = room.seats.iter().flatten().filter(|s| s.is_bot).map(|s| s.name.as_str()).collect();
        let name = self.consts.bot_names.iter().find(|n| !used.contains(n.as_str())).cloned().unwrap_or_else(|| format!("AI·{}", idx + 1));
        let mut bot_id = format!("ai_{}", engine::random_hex(4));
        while room.seat_of(&bot_id).is_some() {
            bot_id = format!("ai_{}", engine::random_hex(4));
        }
        if let Some(room) = self.rooms.get_mut(&code) {
            room.seats[idx] = Some(Seat { seat: idx, player_id: bot_id, name, is_bot: true, ready: true, connected: true, left: false, loadout: None });
        }
        self.broadcast_state(&code);
        Ok(())
    }

    fn remove_bot(&mut self, pid: &str, seat: usize) -> Reply {
        let code = self.lobby_room(pid, true)?;
        let Some(room) = self.rooms.get_mut(&code) else { return Ok(()) };
        if !room.seats.get(seat).and_then(Option::as_ref).is_some_and(|s| s.is_bot) {
            return Err(Fail::with("BAD_TARGET", "seat does not hold an AI"));
        }
        room.seats[seat] = None;
        self.broadcast_state(&code);
        Ok(())
    }

    fn start(&mut self, pid: &str) -> Reply {
        let code = self.lobby_room(pid, true)?;
        let room = &self.rooms[&code];
        let humans = room.active_humans();
        if humans.iter().any(|s| s.player_id != pid && (!s.connected || !s.ready)) {
            return Err(Fail::new("NOT_READY"));
        }
        let bots = room.seats.iter().flatten().filter(|s| s.is_bot).count();
        if humans.is_empty() || (room.mode == "solo" && (humans.len() != 1 || bots > 0)) {
            return Err(Fail::with("BAD_MSG", "invalid seat configuration"));
        }
        self.start_match(&code)
    }

    /// `room.loadout`: checked against the game data, kept on the session and the seat, and handed to a
    /// running match (which accepts it during INFO_CHECK only).
    fn loadout(&mut self, pid: &str, entries: &Value) -> Reply {
        let loadout = engine::check_loadout(entries)?;
        if let Some(s) = self.sessions.get_mut(pid) {
            s.loadout = Some(loadout.clone());
        }
        let Some(code) = self.room_of(pid) else { return Ok(()) };
        let Some(room) = self.rooms.get_mut(&code) else { return Ok(()) };
        // a spectator's loadout stays on its session: it never reaches the match
        let Some(seat) = room.seat_of_mut(pid) else { return Ok(()) };
        seat.loadout = Some(loadout.clone());
        let Some(js) = room.game.as_ref().map(|g| g.js.clone()) else { return Ok(()) };
        let res = engine::match_set_loadout(&js, pid, &loadout);
        self.drain();
        res
    }

    // ---------------------------------------------------------------------------------------------
    // the match (server/lobby.js startMatch / onMatchEnd / routeGame)

    fn start_match(&mut self, code: &str) -> Reply {
        let match_id = self.id();
        let seed = engine::random_u32();
        let Some(room) = self.rooms.get_mut(code) else { return Err(Fail::new("NOT_IN_ROOM")) };
        // the host's start counts as the host's ready
        if let Some(host) = room.host_id.clone() {
            if let Some(seat) = room.seat_of_mut(&host) {
                seat.ready = true;
            }
        }
        let seats: Vec<Value> = room
            .seats
            .iter()
            .flatten()
            .map(|s| {
                let loadout = if s.is_bot { None } else { s.loadout.as_deref().and_then(|l| serde_json::from_str::<Value>(l).ok()) };
                json!({ "seat": s.seat, "playerId": s.player_id, "name": s.name, "isBot": s.is_bot, "connected": s.connected, "loadout": loadout })
            })
            .collect();
        let spectators: Vec<&str> = room.spectators.iter().map(|s| s.player_id.as_str()).collect();
        let opts = json!({
            "roomCode": room.code, "mode": room.mode, "difficulty": room.difficulty, "seats": seats,
            "spectators": spectators, "seed": seed, "matchNo": room.match_count + 1,
        });

        let send = {
            let (me, outbox, room) = (self.me.clone(), self.outbox.clone(), code.to_string());
            Closure::<dyn FnMut(String, String) -> bool>::new(move |player_id: String, json: String| {
                dispatch(&me, &outbox, Event::Send { room: room.clone(), match_id, player_id, json })
            })
        };
        let broadcast = {
            let (me, outbox, room) = (self.me.clone(), self.outbox.clone(), code.to_string());
            Closure::<dyn FnMut(String)>::new(move |json: String| {
                dispatch(&me, &outbox, Event::Broadcast { room: room.clone(), match_id, json });
            })
        };
        let on_end = {
            let (me, outbox, room) = (self.me.clone(), self.outbox.clone(), code.to_string());
            Closure::<dyn FnMut(String)>::new(move |_summary: String| {
                dispatch(&me, &outbox, Event::End { room: room.clone(), match_id });
            })
        };
        let js = match engine::create_match(&opts.to_string(), send.as_ref().unchecked_ref(), broadcast.as_ref().unchecked_ref(), on_end.as_ref().unchecked_ref()) {
            Ok(js) => js,
            Err(e) => {
                worker::console_error!("[lobby] {code} match failed to start: {}", engine::describe(e));
                self.broadcast_state(code);
                return Err(Fail::with("INTERNAL", "match failed to start"));
            }
        };
        self.live.insert(match_id);
        if let Some(room) = self.rooms.get_mut(code) {
            room.game = Some(MatchHandle { id: match_id, js: js.clone(), _send: send, _broadcast: broadcast, _on_end: on_end });
            room.match_count += 1;
        }
        self.broadcast_state(code);
        let started = engine::match_start(&js);
        self.drain();
        if let Err(e) = started {
            worker::console_error!("[lobby] {code} match failed to start: {}", engine::describe(e));
            let dead = self.rooms.get_mut(code).and_then(|r| r.game.take());
            self.bury(dead);
            self.broadcast_state(code);
            return Err(Fail::with("INTERNAL", "match failed to start"));
        }
        Ok(())
    }

    /// Dispose a match on a task of its own: the engine may still be inside the call that ended it, and
    /// the functions it holds must outlive that call.
    fn bury(&self, game: Option<MatchHandle>) {
        let Some(game) = game else { return };
        self.later(0, move |s| {
            engine::match_dispose(&game.js);
            s.live.remove(&game.id);
            drop(game);
        });
    }

    /// The `onEnd` of a match: the room goes back to the lobby.
    fn on_match_end(&mut self, code: &str, match_id: u64) {
        let Some(room) = self.rooms.get_mut(code) else { return };
        if room.game.as_ref().map(|g| g.id) != Some(match_id) {
            return;
        }
        let game = room.game.take();
        let mut away = Vec::new();
        for slot in room.seats.iter_mut() {
            let Some(s) = slot else { continue };
            if s.is_bot {
                continue;
            }
            if s.left {
                *slot = None;
                continue;
            }
            s.ready = false;
            if !s.connected {
                away.push(s.player_id.clone());
            }
        }
        away.extend(room.spectators.iter().filter(|s| !s.connected).map(|s| s.player_id.clone()));
        let host_ok = room.host_id.as_ref().and_then(|h| room.seat_of(h)).is_some_and(|s| !s.is_bot && !s.left);
        let empty = room.active_humans().is_empty();
        self.bury(game);
        for pid in away {
            self.start_grace(code, &pid);
        }
        if !host_ok {
            self.migrate_host(code);
        }
        if empty {
            self.dispose_room(code, "empty");
        } else {
            self.broadcast_state(code);
        }
    }

    /// A `g.*` or `b.*` message goes to the running match; `g.leave` is the lobby's.
    fn route_game(&mut self, pid: &str, t: &str, text: &str) -> Reply {
        let code = self.room_of(pid).ok_or_else(|| Fail::new("NOT_IN_ROOM"))?;
        let Some(js) = self.rooms.get(&code).and_then(|r| r.game.as_ref()).map(|g| g.js.clone()) else {
            return Err(Fail::with("WRONG_PHASE", "no running match"));
        };
        if t == "g.leave" {
            self.remove_member(&code, pid);
            return Ok(());
        }
        // a spectator only watches: nothing else of it reaches the match
        if t != "g.watch" && self.rooms[&code].spectator_of(pid).is_some() {
            return Err(Fail::new("SPECTATOR"));
        }
        let res = engine::match_handle(&js, pid, text);
        self.drain();
        res
    }

    // ---------------------------------------------------------------------------------------------
    // membership

    /// Remove a human from a room for good. In the lobby the seat is freed; in a match it is marked as
    /// departed and the match is told.
    fn remove_member(&mut self, code: &str, player_id: &str) {
        if let Some(s) = self.sessions.get_mut(player_id) {
            if s.room_code.as_deref() == Some(code) {
                s.room_code = None;
            }
        }
        self.grace.remove(player_id);
        if self.free_spectator_seat(code, player_id) {
            return;
        }
        let Some(room) = self.rooms.get_mut(code) else { return };
        let in_match = room.game.as_ref().map(|g| g.js.clone());
        let Some(idx) = room.seats.iter().position(|s| s.as_ref().is_some_and(|s| s.player_id == player_id && !s.is_bot && !s.left)) else { return };
        match in_match {
            Some(js) => {
                if let Some(seat) = room.seats[idx].as_mut() {
                    seat.left = true;
                    seat.connected = false;
                    seat.ready = false;
                }
                engine::match_call(&js, "onLeave", player_id);
                self.drain();
            }
            None => room.seats[idx] = None,
        }
        // onLeave may have ended the match and emptied the room
        let Some(room) = self.rooms.get(code) else { return };
        let was_host = room.host_id.as_deref() == Some(player_id);
        let empty = room.active_humans().is_empty();
        if was_host {
            self.migrate_host(code);
        }
        if empty {
            self.dispose_room(code, "empty");
        } else {
            self.broadcast_state(code);
        }
    }

    /// Free a spectator seat: the match forgets the spectator. The host does not change and the room is
    /// not deleted, because a spectator is not the host and does not keep a room alive. Returns `true`
    /// when `player_id` had a spectator seat.
    fn free_spectator_seat(&mut self, code: &str, player_id: &str) -> bool {
        let Some(room) = self.rooms.get_mut(code) else { return false };
        let Some(idx) = room.spectators.iter().position(|s| s.player_id == player_id) else { return false };
        room.spectators.remove(idx);
        if let Some(js) = room.game.as_ref().map(|g| g.js.clone()) {
            engine::match_call(&js, "removeSpectator", player_id);
            self.drain();
        }
        self.broadcast_state(code);
        true
    }

    /// `room.kick`: before the match, the host removes another human. `player_id` is the player that
    /// the host confirmed: a seat that changed hands since then is refused.
    fn kick(&mut self, pid: &str, seat: usize, player_id: &str) -> Reply {
        let code = self.lobby_room(pid, true)?;
        let Some(target) = self.rooms[&code].seats.get(seat).and_then(Option::as_ref).filter(|s| !s.left) else {
            return Err(Fail::with("BAD_TARGET", "seat holds no player"));
        };
        if target.player_id != player_id {
            return Err(Fail::with("BAD_TARGET", "seat changed hands"));
        }
        if target.is_bot {
            return Err(Fail::with("BAD_TARGET", "seat holds an AI (room.removeBot)"));
        }
        if target.player_id == pid {
            return Err(Fail::with("BAD_TARGET", "cannot kick yourself"));
        }
        self.remove_and_tell(&code, player_id);
        Ok(())
    }

    /// `room.spectate`: one of the spectator seats of a co-op room, in its lobby or while its match runs.
    fn spectate(&mut self, pid: &str, code: &str) -> Reply {
        let norm = code.trim().to_uppercase();
        if norm.chars().count() != self.consts.room_code_len || !self.rooms.contains_key(&norm) {
            return Err(Fail::new("ROOM_NOT_FOUND"));
        }
        let cur = self.room_of(pid);
        if cur.as_deref() == Some(norm.as_str()) {
            if self.rooms[&norm].spectator_of(pid).is_none() {
                return Err(Fail::with("ALREADY", "seated as a player"));
            }
            if let Some(text) = self.rooms.get(&norm).map(|r| r.state().to_string()) {
                self.send_session(pid, &text);
            }
            return Ok(());
        }
        if cur.as_ref().and_then(|c| self.rooms.get(c)).is_some_and(|r| r.game.is_some()) {
            return Err(Fail::with("ROOM_STARTED", "leave your running match first"));
        }
        let room = &self.rooms[&norm];
        if room.mode == "solo" {
            return Err(Fail::with("ROOM_FULL", "solo room"));
        }
        if room.spectators.len() >= self.consts.max_spectators {
            return Err(Fail::with("ROOM_FULL", "no free spectator seat"));
        }
        if let Some(cur) = cur {
            self.remove_member(&cur, pid);
        }
        let Some(s) = self.sessions.get_mut(pid) else { return Ok(()) };
        s.room_code = Some(norm.clone());
        s.notice = None;
        let seat = Spectator { player_id: pid.to_string(), name: s.name.clone(), connected: s.connected };
        let Some(room) = self.rooms.get_mut(&norm) else { return Ok(()) };
        room.spectators.push(seat);
        let js = room.game.as_ref().map(|g| g.js.clone());
        self.broadcast_state(&norm);
        // a running match registers the spectator and sends what it may see
        if let Some(js) = js {
            engine::match_call(&js, "addSpectator", pid);
            self.drain();
        }
        Ok(())
    }

    /// `room.removeSpectator`: the host frees a spectator seat, at any time.
    fn remove_spectator(&mut self, pid: &str, player_id: &str) -> Reply {
        let code = self.room_of(pid).ok_or_else(|| Fail::new("NOT_IN_ROOM"))?;
        let room = &self.rooms[&code];
        if room.host_id.as_deref() != Some(pid) {
            return Err(Fail::new("NOT_HOST"));
        }
        if room.spectator_of(player_id).is_none() {
            return Err(Fail::with("BAD_TARGET", "not a spectator of this room"));
        }
        self.remove_and_tell(&code, player_id);
        Ok(())
    }

    /// Remove a member that the host sent away. It gets `room.closed {kicked}`: now, or on its next
    /// resume when it is not connected.
    fn remove_and_tell(&mut self, code: &str, player_id: &str) {
        let was_here = self.sessions.get(player_id).is_some_and(|s| s.room_code.as_deref() == Some(code));
        self.remove_member(code, player_id);
        if !was_here {
            return;
        }
        if self.sessions.get(player_id).is_some_and(|s| s.connected) {
            self.send_session(player_id, &json!({ "t": "room.closed", "reason": "kicked" }).to_string());
        } else if let Some(s) = self.sessions.get_mut(player_id) {
            s.notice = Some("kicked".to_string());
        }
    }

    /// The connected human with the lowest seat becomes the host (else the human with the lowest seat).
    fn migrate_host(&mut self, code: &str) {
        let Some(room) = self.rooms.get_mut(code) else { return };
        let humans = room.active_humans();
        let pick = humans.iter().find(|s| s.connected).or(humans.first()).map(|s| s.player_id.clone());
        room.host_id = pick;
    }

    /// A human who dropped in the lobby keeps the seat for the grace time.
    fn start_grace(&mut self, code: &str, player_id: &str) {
        let token = self.id();
        self.grace.insert(player_id.to_string(), token);
        let (code, pid) = (code.to_string(), player_id.to_string());
        self.later(self.consts.lobby_grace_ms, move |s| {
            if s.grace.get(&pid) != Some(&token) {
                return;
            }
            s.grace.remove(&pid);
            let waiting = s.rooms.get(&code).is_some_and(|r| {
                r.game.is_none()
                    && match r.seat_of(&pid) {
                        Some(x) => !x.connected,
                        None => r.spectator_of(&pid).is_some_and(|x| !x.connected),
                    }
            });
            if !waiting {
                return;
            }
            if let Some(x) = s.sessions.get_mut(&pid) {
                if x.room_code.as_deref() == Some(code.as_str()) {
                    x.notice = Some("timeout".to_string());
                }
            }
            s.remove_member(&code, &pid);
        });
    }

    /// Delete a room. Its players get `room.closed`, except when the room only emptied. Its spectators
    /// always get it.
    fn dispose_room(&mut self, code: &str, reason: &str) {
        let Some(mut room) = self.rooms.remove(code) else { return };
        let game = room.game.take();
        let closed = json!({ "t": "room.closed", "reason": reason }).to_string();
        for s in room.seats.iter().flatten().filter(|s| !s.is_bot) {
            self.grace.remove(&s.player_id);
            let Some(session) = self.sessions.get_mut(&s.player_id) else { continue };
            if session.room_code.as_deref() != Some(code) {
                continue;
            }
            session.room_code = None;
            if s.left || reason == "empty" {
                continue;
            }
            if session.connected {
                self.send_session(&s.player_id, &closed);
            } else if let Some(session) = self.sessions.get_mut(&s.player_id) {
                session.notice = Some(reason.to_string());
            }
        }
        // the spectators did not leave: they get the reason, also when the last player left the room
        for s in &room.spectators {
            self.grace.remove(&s.player_id);
            let Some(session) = self.sessions.get_mut(&s.player_id) else { continue };
            if session.room_code.as_deref() != Some(code) {
                continue;
            }
            session.room_code = None;
            if session.connected {
                self.send_session(&s.player_id, &closed);
            } else if let Some(session) = self.sessions.get_mut(&s.player_id) {
                session.notice = Some(reason.to_string());
            }
        }
        self.bury(game);
    }

    // ---------------------------------------------------------------------------------------------
    // sending

    /// The sockets of the connected, present humans of a room: its players, then its spectators.
    fn member_conns(&self, room: &Room) -> Vec<u64> {
        room.seats
            .iter()
            .flatten()
            .filter(|s| !s.is_bot && !s.left)
            .map(|s| &s.player_id)
            .chain(room.spectators.iter().map(|s| &s.player_id))
            .filter_map(|id| self.sessions.get(id))
            .filter(|s| s.connected && s.room_code.as_deref() == Some(room.code.as_str()))
            .filter_map(|s| s.conn)
            .collect()
    }

    fn broadcast_state(&self, code: &str) {
        let Some(room) = self.rooms.get(code) else { return };
        let text = room.state().to_string();
        for c in self.member_conns(room) {
            self.send_conn(c, &text);
        }
    }

    /// The `broadcast()` of a match: every connected human of the room, the spectators too.
    fn broadcast_room(&self, code: &str, match_id: u64, text: &str) {
        if !self.live.contains(&match_id) {
            return;
        }
        let Some(room) = self.rooms.get(code) else { return };
        for c in self.member_conns(room) {
            self.send_conn(c, text);
        }
    }

    /// The `send()` of a match: one human of the room, a player or a spectator.
    fn send_to_player(&self, code: &str, match_id: u64, player_id: &str, text: &str) -> bool {
        if !self.live.contains(&match_id) {
            return false;
        }
        let seated = self.rooms.get(code).is_some_and(|r| match r.seat_of(player_id) {
            Some(s) => !s.is_bot && !s.left,
            None => r.spectator_of(player_id).is_some(),
        });
        if !seated || self.sessions.get(player_id).and_then(|s| s.room_code.as_deref()) != Some(code) {
            return false;
        }
        self.send_session(player_id, text)
    }
}

/// A callback from the engine: act now when the server is free, else leave it for the caller to drain.
fn dispatch(me: &Weak<RefCell<Server>>, outbox: &Rc<RefCell<Vec<Event>>>, ev: Event) -> bool {
    if let Some(rc) = me.upgrade() {
        if let Ok(mut s) = rc.try_borrow_mut() {
            // frames queued before this one go first
            s.drain();
            let delivered = s.apply(ev);
            s.drain();
            return delivered;
        }
    }
    outbox.borrow_mut().push(ev);
    true
}
