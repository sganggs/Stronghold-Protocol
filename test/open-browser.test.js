// openBrowser(): 用玩家的默认浏览器打开页面，且不会把浏览器拉成提权进程。
// 背景：`rundll32 url.dll,FileProtocolHandler` 继承调用方令牌，从提权终端启动会把 Edge 也拉成提权，之后 Edge 每次
// 都弹「现有实例正在以提升的权限运行」；交给 shell（explorer.exe <url>）则由**已经在运行**的、非提权的 shell 实例
// 转发给默认浏览器。
// 另外这里**故意没有** `cmd /c start "" <url>` 这一档：cmd 会重新解析 /c 之后的整串，URL 里的 `&` 被当成分隔符，
// 浏览器只收到被截断的地址（见最后一条测试）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { browserCommands, openBrowser } from '../scripts/open-browser.mjs';

// 这一档是给 Windows 用的，CI 却在 Linux 上跑：探测「C:\Windows\explorer.exe 在不在」必须能被注入，
// 否则测试就在断言**运行这台机器**的文件系统——Linux 上该路径不存在，测试自然红。
const hasWin = () => true;      // 假装 SystemRoot 下该有的可执行文件都在
const noExplorer = (p) => !/explorer\.exe$/i.test(p); // 只缺 explorer.exe，rundll32 还在
const emptyWin = () => false;   // 假装一个都没找到
const WIN = { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: hasWin };

describe('openBrowser: 默认浏览器 + 不提权', () => {
  test('explorer.exe 在就用它：URL 原样交给 shell，由默认浏览器打开', () => {
    const cmds = browserCommands('http://127.0.0.1:3000/', WIN);
    assert.deepEqual(cmds.map((c) => c.label), ['explorer']);
    assert.equal(cmds[0].cmd, 'C:\\Windows\\explorer.exe', '走 Windows 绝对路径，且分隔符是反斜杠');
    assert.deepEqual(cmds[0].args, ['http://127.0.0.1:3000/'], 'URL 原样交给 shell，由默认浏览器打开');
    // 不能是 rundll32：从提权终端启动时它会把浏览器也提权
    assert.notEqual(cmds[0].label, 'rundll32');
    // 路径必须用 win32 语义拼：Linux 上跑测试时 path.join 是 posix，会拼出 C:\Windows/explorer.exe 这种混合分隔符
    for (const c of cmds) assert.ok(!c.cmd.includes('/'), `${c.cmd} 不该出现正斜杠`);
  });

  test('explorer.exe 不在才退到 rundll32，且只有这一档', () => {
    const cmds = browserCommands('http://x/', { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: noExplorer });
    assert.deepEqual(cmds.map((c) => c.label), ['rundll32']);
    assert.equal(cmds[0].cmd, 'C:\\Windows\\System32\\rundll32.exe');
    assert.deepEqual(cmds[0].args, ['url.dll,FileProtocolHandler', 'http://x/']);
  });

  test('两档都找不到时不猜裸命令名，直接没有候选（调用方只打印地址）', () => {
    assert.deepEqual(browserCommands('http://x/', { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: emptyWin }), []);
    // 没给 SystemRoot 时按默认的 C:\Windows 找绝对路径
    assert.equal(browserCommands('http://x/', { platform: 'win32', env: {}, exists: hasWin })[0].cmd, 'C:\\Windows\\explorer.exe');
    // windir 也认
    assert.equal(browserCommands('http://x/', { platform: 'win32', env: { windir: 'D:\\Win' }, exists: hasWin })[0].cmd, 'D:\\Win\\explorer.exe');
  });

  test('macOS 用 open，无桌面的 Linux 不启动任何东西', () => {
    assert.deepEqual(browserCommands('http://x/', { platform: 'darwin', env: {} }).map((c) => c.label), ['open']);
    assert.deepEqual(browserCommands('http://x/', { platform: 'linux', env: {} }), []);
    assert.deepEqual(browserCommands('http://x/', { platform: 'linux', env: { DISPLAY: ':0' } }).map((c) => c.label), ['xdg-open']);
  });

  test('openBrowser 启动那一档并返回它的名字；spawn 失败是异步 error 事件，不影响返回值', () => {
    const spawned = [];
    let errorListener = false;
    const ok = openBrowser('http://127.0.0.1:3000/', {
      ...WIN,
      spawnImpl: (cmd, args) => {
        spawned.push([cmd, args]);
        // 真实 ChildProcess：ENOENT / EACCES 不是抛出来，而是之后 emit('error')
        return { unref() {}, on(ev) { if (ev === 'error') errorListener = true; } };
      },
    });
    assert.equal(ok, 'explorer');
    assert.deepEqual(spawned, [['C:\\Windows\\explorer.exe', ['http://127.0.0.1:3000/']]]);
    assert.ok(errorListener, '必须挂 error 监听，否则未处理的 error 事件会让启动器崩掉');
  });

  test('没有可用的启动方式时返回 null（调用方只打印地址）', () => {
    assert.equal(openBrowser('http://x/', { platform: 'linux', env: {} }), null);
    assert.equal(openBrowser('http://x/', { platform: 'win32', env: {}, exists: emptyWin }), null);
    // spawn 同步抛错（现实中不该发生）只会被记下来然后继续找下一档，这里没有下一档
    const logged = [];
    assert.equal(openBrowser('http://x/', { ...WIN, spawnImpl: () => { throw new Error('no'); }, log: (m) => logged.push(m) }), null);
    assert.equal(logged.length, 1);
  });

  test('不带 `cmd /c start` 这一档：URL 里的 & 会被 cmd 当成命令分隔符而截断', () => {
    // 房间链接就长这样：`?room=ABCD&name=…`。交给 `cmd /c start "" <url>` 时，cmd 会在 & 处断开，
    // 先执行 `start "" <截断到 & 的地址>`，再拿剩下半截当第二条命令 —— 浏览器打开的是错的地址。
    const url = 'http://127.0.0.1:3000/?room=ABCD&name=me';
    const cmds = browserCommands(url, WIN);
    assert.ok(!cmds.some((c) => /^cmd(\.exe)?$/i.test(c.cmd)), '候选里不该再有 cmd.exe');
    assert.ok(!cmds.some((c) => c.args.includes('start')), '也不该再用 start');
    // 每个候选都把完整 URL 作为**一个 argv 元素**传下去：CreateProcess 直接收参数数组，不经过 cmd 解析
    for (const c of cmds) assert.ok(c.args.includes(url), `${c.label} 必须原样收到完整 URL`);
  });

  test('默认用真实文件系统探测（这台机器上跑得起来就说明探测没被写坏）', () => {
    // 不注入 exists：结果取决于当前主机，但**不该抛异常**，且候选数量与平台一致
    const cmds = browserCommands('http://x/', { platform: process.platform, env: process.env });
    const want = process.platform === 'win32' || process.platform === 'darwin' ? 1
      : (process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? 1 : 0);
    assert.equal(cmds.length, want);
  });
});
