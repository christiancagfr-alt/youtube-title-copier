'use strict';

var pathNode = document.getElementById('path');
var statusNode = document.getElementById('status');

function show(text) {
  pathNode.textContent = text || '保存到「下载」文件夹';
}

function note(text) {
  statusNode.textContent = text || '';
}

function send(type, done) {
  var port;
  try {
    port = chrome.runtime.connect({ name: 'yt-settings' });
  } catch (error) {
    note('无法连接下载组件');
    return;
  }
  var settled = false;
  port.onMessage.addListener(function (msg) {
    settled = true;
    done(msg);
  });
  port.onDisconnect.addListener(function () {
    if (!settled) note('请先运行 install-host.ps1，然后重新加载扩展。');
  });
  port.postMessage({ type: type });
}

function apply(msg) {
  if (msg && msg.type === 'directory' && msg.path) {
    show(msg.path);
    note('');
    return;
  }
  if (msg && msg.type === 'cancelled') {
    note('未更改保存位置');
    return;
  }
  note((msg && msg.message) || '无法更改保存位置');
}

document.getElementById('pick').addEventListener('click', function () {
  note('请在弹出的窗口里选择文件夹');
  send('pick-directory', apply);
});

document.getElementById('reset').addEventListener('click', function () {
  send('reset-directory', function (msg) {
    apply(msg);
    if (msg && msg.type === 'directory') note('已恢复为「下载」文件夹');
  });
});

send('get-directory', apply);
