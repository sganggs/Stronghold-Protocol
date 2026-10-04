//! The match engine of the original project, as the Rust code sees it.
//!
//! `engine/glue.js` puts these functions on `globalThis.SP_ENGINE` (it is bundled with the engine by
//! `build-engine.mjs`, and `entry.mjs` loads the bundle on the first use). Text crosses the boundary as
//! JSON strings; a match crosses it as an opaque `JsValue`.

use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// Loads and evaluates the engine bundle. It is not part of the Worker's start: a Worker has a
    /// short time limit to start, and the bundle is 5 MB.
    #[wasm_bindgen(js_name = SP_ENGINE_LOAD, catch)]
    async fn sp_engine_load() -> Result<JsValue, JsValue>;

    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = init, catch)]
    fn js_init() -> Result<String, JsValue>;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = inspect, catch)]
    fn js_inspect(text: &str) -> Result<String, JsValue>;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = sanitizeName, catch)]
    fn js_sanitize_name(raw: &str) -> Result<String, JsValue>;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = checkLoadout, catch)]
    fn js_check_loadout(entries: &str) -> Result<String, JsValue>;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = randomHex)]
    pub fn random_hex(bytes: u32) -> String;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = randomU32)]
    pub fn random_u32() -> u32;

    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = createMatch, catch)]
    pub fn create_match(
        opts: &str,
        send: &js_sys::Function,
        broadcast: &js_sys::Function,
        on_end: &js_sys::Function,
    ) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = matchStart, catch)]
    pub fn match_start(m: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = matchHandle)]
    fn js_match_handle(m: &JsValue, player_id: &str, msg: &str) -> String;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = matchCall)]
    pub fn match_call(m: &JsValue, method: &str, player_id: &str);
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = matchSetLoadout)]
    fn js_match_set_loadout(m: &JsValue, player_id: &str, loadout: &str) -> String;
    #[wasm_bindgen(js_namespace = SP_ENGINE, js_name = matchDispose)]
    pub fn match_dispose(m: &JsValue);
}

/// A refusal: an `ERR` code of `shared/constants.js` and an optional detail for developers.
#[derive(Debug, Clone)]
pub struct Fail {
    pub code: String,
    pub detail: Option<String>,
}

impl Fail {
    pub fn new(code: &str) -> Self {
        Self { code: code.to_string(), detail: None }
    }
    pub fn with(code: &str, detail: &str) -> Self {
        Self { code: code.to_string(), detail: Some(detail.to_string()) }
    }
}

pub type Reply = Result<(), Fail>;

/// The constants the lobby and the session layer need, read from the original project's own modules.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Consts {
    pub protocol_version: i64,
    pub app_version: String,
    pub err_text: std::collections::HashMap<String, String>,
    pub max_seats: usize,
    pub max_spectators: usize,
    pub room_code_len: usize,
    pub code_alphabet: String,
    pub bot_names: Vec<String>,
    pub lobby_grace_ms: u64,
    pub max_rooms: usize,
    pub reconnect_window_ms: u64,
    pub hello_timeout_ms: u64,
    pub solo_resume_ms: u64,
}

/// What `server/net.js` learns about a frame before it acts on it.
#[derive(Debug, Deserialize)]
pub struct Inspected {
    pub t: Option<String>,
    pub rid: Option<u64>,
    pub detail: Option<String>,
}

#[derive(Deserialize)]
struct JsResult {
    error: Option<String>,
    detail: Option<String>,
}

#[derive(Deserialize)]
struct JsLoadout {
    error: Option<String>,
    detail: Option<String>,
    loadout: Option<serde_json::Value>,
}

fn js_err(e: JsValue) -> String {
    e.as_string()
        .or_else(|| js_sys::Reflect::get(&e, &"message".into()).ok().and_then(|m| m.as_string()))
        .unwrap_or_else(|| format!("{e:?}"))
}

fn reply_of(json: &str) -> Reply {
    match serde_json::from_str::<JsResult>(json) {
        Ok(JsResult { error: Some(code), detail }) => Err(Fail { code, detail }),
        Ok(_) => Ok(()),
        Err(_) => Err(Fail::new("INTERNAL")),
    }
}

pub async fn load() -> Result<Consts, String> {
    sp_engine_load().await.map_err(js_err)?;
    let text = js_init().map_err(js_err)?;
    serde_json::from_str(&text).map_err(|e| format!("engine constants: {e}"))
}

pub fn inspect(text: &str) -> Inspected {
    let bad = |detail: &str| Inspected { t: None, rid: None, detail: Some(detail.to_string()) };
    match js_inspect(text) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_else(|_| bad("invalid json")),
        Err(_) => bad("invalid json"),
    }
}

/// The nickname as the server keeps it; `None` when nothing printable is left.
pub fn sanitize_name(raw: &str) -> Option<String> {
    js_sanitize_name(raw).ok().filter(|s| !s.is_empty())
}

/// `room.loadout { entries }` checked against the game data: the loadout as JSON text.
pub fn check_loadout(entries: &serde_json::Value) -> Result<String, Fail> {
    let json = js_check_loadout(&entries.to_string()).map_err(|_| Fail::new("INTERNAL"))?;
    match serde_json::from_str::<JsLoadout>(&json) {
        Ok(JsLoadout { error: Some(code), detail, .. }) => Err(Fail { code, detail }),
        Ok(JsLoadout { loadout: Some(l), .. }) => Ok(l.to_string()),
        _ => Err(Fail::new("BAD_MSG")),
    }
}

pub fn match_handle(m: &JsValue, player_id: &str, msg: &str) -> Reply {
    reply_of(&js_match_handle(m, player_id, msg))
}

pub fn match_set_loadout(m: &JsValue, player_id: &str, loadout: &str) -> Reply {
    reply_of(&js_match_set_loadout(m, player_id, loadout))
}

pub fn describe(e: JsValue) -> String {
    js_err(e)
}
