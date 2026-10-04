//! The socket backend of the Stronghold Protocol imprint (README.md in this folder).
//!
//! One Durable Object, `GameServer`, is the whole game server: it holds the sockets, the sessions and
//! the rooms (`server.rs`) and runs the match engine of the original project (`engine.rs`). The Worker
//! in front of it only hands `/ws` and `/healthz` to that one object.

use std::cell::RefCell;

use futures_util::StreamExt;
use worker::*;

mod engine;
mod server;

use server::{Server, Shared};

/// The binding of the Durable Object namespace (wrangler.toml).
const BINDING: &str = "GAME";
/// The one instance. The client opens its socket before it knows a room, so rooms cannot be instances.
const INSTANCE: &str = "main";

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    match req.path().as_str() {
        "/ws" | "/healthz" => env.durable_object(BINDING)?.get_by_name(INSTANCE)?.fetch_with_request(req).await,
        _ => Response::error("Not found", 404),
    }
}

#[durable_object]
pub struct GameServer {
    server: RefCell<Option<Shared>>,
    // the object's storage (SQLite) and bindings: step 2 of aldus/WS-STATE.md uses them
    _state: State,
    _env: Env,
}

impl GameServer {
    /// The server, made on the first request: the engine is loaded here, not while the Worker starts.
    async fn server(&self) -> Result<Shared> {
        if let Some(s) = self.server.borrow().as_ref() {
            return Ok(s.clone());
        }
        let consts = engine::load().await.map_err(|e| Error::RustError(format!("engine: {e}")))?;
        // two first requests can both get here: the first server made stays
        let mut slot = self.server.borrow_mut();
        Ok(slot.get_or_insert_with(|| Server::new(consts)).clone())
    }
}

impl DurableObject for GameServer {
    fn new(state: State, env: Env) -> Self {
        Self { server: RefCell::new(None), _state: state, _env: env }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        let server = self.server().await?;
        match req.path().as_str() {
            "/healthz" => Response::from_json(&server.borrow().health()),
            "/ws" => {
                let upgrade = req.headers().get("Upgrade")?.unwrap_or_default();
                if !upgrade.eq_ignore_ascii_case("websocket") {
                    return Response::error("Expected a WebSocket", 426);
                }
                let pair = WebSocketPair::new()?;
                let ws = pair.server;
                // not the hibernation API: the state is in memory, so the object must stay in memory
                // for as long as a socket is open
                ws.accept()?;
                let id = Server::connect(&server, ws.clone());
                wasm_bindgen_futures::spawn_local(async move {
                    if let Ok(mut events) = ws.events() {
                        while let Some(event) = events.next().await {
                            match event {
                                Ok(WebsocketEvent::Message(m)) => Server::frame(&server, id, m.text()),
                                Ok(WebsocketEvent::Close(_)) | Err(_) => break,
                            }
                        }
                    }
                    Server::closed(&server, id);
                });
                Response::from_websocket(pair.client)
            }
            _ => Response::error("Not found", 404),
        }
    }
}
