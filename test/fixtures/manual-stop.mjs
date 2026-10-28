// Test-only preload: Windows child.kill('SIGTERM') forcefully terminates without
// running JS handlers. IPC lets every platform exercise the launcher's own cleanup.
process.once('message', message => {
	if (message !== 'stop') throw new Error('Unexpected manual launcher test message');
	process.disconnect();
	if (!process.emit('SIGTERM')) throw new Error('Manual launcher stop handler is not ready');
});
