/** The primary owns orderly shutdown. Children keep serving until its stop request or IPC disconnection. */
export function ignoreRoomSignals(channel = process) {
  const ignore = () => {};
  channel.on('SIGINT', ignore);
  channel.on('SIGTERM', ignore);
  return () => { channel.off('SIGINT', ignore); channel.off('SIGTERM', ignore); };
}
