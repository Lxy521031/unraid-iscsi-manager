/* iSCSI Manager for Unraid - page logic
 *
 * One JSON "state" document (see include/iscsi_ctl.py) drives the whole page.
 * Every mutation POSTs to include/api.php and receives the fresh state back,
 * so the UI re-renders from a single source of truth after each change.
 */
var iSCSI = (function () {
  'use strict';

  var API_URL = '/plugins/iscsi.manager/include/api.php';
  var POLL_MS = 10000;

  var app, root, state = null, collapsed = {}, pollTimer = null, modalOpen = false;

  // ── small utilities ──────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function attr(s) { return esc(s); }
  function el(id) { return document.getElementById(id); }
  function shortName(iqn) {
    var i = iqn.indexOf(':');
    return i > 0 ? iqn.slice(i + 1) : iqn;
  }
  function plural(n, one, many) { return n + ' ' + ({LUN: '个 LUN', ACL: '条 ACL', portal: '个监听地址', session: '个会话', initiator: '个客户端', 'initiator is': '个客户端'}[one] || one); }
  function fmtBytes(n) {
    n = Number(n) || 0;
    var u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : n) + ' ' + u[i];
  }
  function iqnDefault() {
    var d = new Date();
    var host = (app.dataset.hostname || 'unraid').toLowerCase().replace(/[^a-z0-9-]/g, '');
    var n = (state && state.targets ? state.targets.length : 0) + 1;
    return 'iqn.' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '.unraid.' + host + ':target' + n;
  }

  // ── API ──────────────────────────────────────────────────────────
  function api(action, params) {
    return new Promise(function (resolve, reject) {
      $.ajax({
        type: 'POST', url: API_URL, dataType: 'json', timeout: 120000,
        data: { action: action, params: JSON.stringify(params || {}), csrf_token: window.csrf_token }
      }).done(function (d) {
        if (d && d.ok) {
          if (d.state) { state = d.state; render(); }
          resolve(d);
        } else {
          reject(new Error((d && d.error) || '请求失败'));
        }
      }).fail(function (xhr) {
        var msg = (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText || '请求失败';
        if (xhr.status === 0 && xhr.statusText === 'error') msg = '服务器未响应（登录可能已过期）';
        reject(new Error(msg));
      });
    });
  }

  function refresh(silent) {
    return api('state').catch(function (e) {
      if (!silent) toast(e.message, 'error');
      if (!state) root.innerHTML = '<div class="iscsi-notice error"><b>无法读取 iSCSI 配置。</b> ' + esc(e.message) + '</div>';
    });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || modalOpen) return;
      refresh(true);
    }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  // ── toasts ───────────────────────────────────────────────────────
  function toast(msg, type) {
    var box = document.querySelector('.is-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'is-toasts'; document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'is-toast ' + (type || 'ok');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, type === 'error' ? 7000 : 3500);
    setTimeout(function () { t.remove(); }, type === 'error' ? 7400 : 3900);
  }

  // ── modal ────────────────────────────────────────────────────────
  // opts: {title, body (html), buttons:[{label, cls, onClick(modal) -> promise|void, close:boolean}], wide, onOpen(modal)}
  function modal(opts) {
    closeModal();
    modalOpen = true;
    var ov = document.createElement('div');
    ov.className = 'is-overlay';
    var btns = (opts.buttons || []).map(function (b, i) {
      return '<button type="button" class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + esc(b.label) + '</button>';
    }).join('');
    ov.innerHTML =
      '<div class="is-modal ' + (opts.wide ? 'wide' : '') + '" role="dialog">' +
        '<div class="is-modal-head"><h3>' + esc(opts.title) + '</h3><button type="button" class="x" aria-label="关闭">&times;</button></div>' +
        '<div class="is-modal-body">' + opts.body + '<div class="err" id="is-modal-err"></div></div>' +
        (btns ? '<div class="is-modal-foot">' + btns + '</div>' : '') +
      '</div>';
    document.body.appendChild(ov);
    var m = { el: ov, close: closeModal, err: function (msg) { el('is-modal-err').textContent = msg || ''; } };
    ov.querySelector('.x').addEventListener('click', closeModal);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeModal(); });
    ov.querySelectorAll('.is-modal-foot .btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var b = opts.buttons[+btn.dataset.i];
        if (!b.onClick) { if (b.close !== false) closeModal(); return; }
        m.err('');
        btn.classList.add('working');
        Promise.resolve().then(function () { return b.onClick(m); }).then(function (keep) {
          btn.classList.remove('working');
          if (keep !== true && b.close !== false) closeModal();
        }).catch(function (e) {
          btn.classList.remove('working');
          m.err(e.message || String(e));
        });
      });
    });
    document.addEventListener('keydown', escHandler);
    var first = ov.querySelector('input:not([type=checkbox]), select');
    if (first) setTimeout(function () { first.focus(); first.select && first.select(); }, 30);
    if (opts.onOpen) opts.onOpen(m);
    return m;
  }
  function escHandler(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var ov = document.querySelector('.is-overlay');
    if (ov) ov.remove();
    document.removeEventListener('keydown', escHandler);
    modalOpen = false;
  }
  function confirmModal(title, html, label, action, danger) {
    return modal({
      title: title, body: html,
      buttons: [
        { label: '取消', cls: 'btn-outline' },
        { label: label || '确认', cls: danger === false ? '' : 'btn-danger', onClick: action }
      ]
    });
  }
  function val(id) { var e = el(id); return e ? e.value.trim() : ''; }
  function checked(id) { var e = el(id); return !!(e && e.checked); }

  // ── rendering ────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    var s = state, svc = s.service || {};
    var tpgs = [];
    s.targets.forEach(function (t) { t.tpgs.forEach(function (g) { tpgs.push(g); }); });
    var lunCount = tpgs.reduce(function (n, g) { return n + g.luns.length; }, 0);
    var totalBytes = s.backstores.reduce(function (n, b) { return n + (Number(b.size) || 0); }, 0);
    var sessions = s.sessions || [];

    var html = '';
    html += '<div class="is-cards">' +
      card('目标', s.targets.length, plural(lunCount, 'LUN') + ' 已提供') +
      card('后端存储', s.backstores.length, fmtBytes(totalBytes) + ' 已分配') +
      card('已连接客户端', sessions.length, sessions.length ? uniq(sessions.map(function (x) { return x.alias || shortName(x.initiator); })).slice(0, 3).join(', ') : '无客户端登录') +
      card('配置', svc.saved ? '<span class="badge green">已保存</span>' : '<span class="badge yellow">有未保存的修改</span>',
        (svc.iscsi_module ? '内核目标模块已加载' : '内核目标模块未加载') + ' &middot; rtslib ' + esc(svc.rtslib_version || '?')) +
      '</div>';

    html += '<div class="is-toolbar">' +
      '<button type="button" class="btn" data-act="new-target">+ 新建目标</button>' +
      '<button type="button" class="btn" data-act="new-backstore">+ 新建后端存储</button>' +
      '<span class="spacer"></span>' +
      (svc.saved ? '' : '<button type="button" class="btn btn-outline" data-act="save">保存配置</button>') +
      '<button type="button" class="btn btn-outline" data-act="refresh">刷新</button>' +
      '</div>';

    // targets
    html += '<h3 class="is-h">目标 <span class="count">' + s.targets.length + '</span></h3>';
    if (!s.targets.length) {
      html += '<div class="iscsi-notice info">还没有 iSCSI 目标。请先创建后端存储（要提供给客户端的磁盘或镜像文件），再创建目标，最后将后端存储挂接为目标的 LUN。</div>';
    }
    s.targets.forEach(function (t) { html += renderTarget(t, sessions); });

    // backstores
    html += '<h3 class="is-h">后端存储 <span class="count">' + s.backstores.length + '</span></h3>';
    html += '<div class="is-card" style="padding:0"><div class="is-tablewrap"><table class="is-table"><thead><tr>' +
      '<th>类型</th><th>名称</th><th>存储路径</th><th class="right">容量</th><th>缓存</th><th>使用者</th><th></th></tr></thead><tbody>';
    if (!s.backstores.length) html += '<tr class="empty"><td colspan="7">还没有后端存储。后端存储是目标以 LUN 形式提供给客户端的镜像文件或块设备。</td></tr>';
    s.backstores.forEach(function (b) {
      var used = b.attached.map(function (a) { return '<span class="nowrap"><code>' + esc(shortName(a.target)) + '</code> lun' + a.lun + '</span>'; }).join('<br>');
      var status = b.attached.length ? '<span class="badge gray plain">正在使用</span>' : '<span class="badge green">空闲</span>';
      var missing = (b.type === 'fileio' && b.exists === false) ? ' <span class="badge red">文件不存在</span>' : '';
      html += '<tr>' +
        '<td><span class="badge plain">' + esc(b.type) + '</span></td>' +
        '<td><b>' + esc(b.name) + '</b>' + missing + '</td>' +
        '<td><code>' + esc(b.path) + '</code></td>' +
        '<td class="num right">' + esc(b.size_h) + '</td>' +
        '<td class="muted">' + (b.fua_compat ? '同步直写 · FUA 兼容' : (b.write_back ? '回写' : '直写')) + '</td>' +
        '<td>' + (used || status) + '</td>' +
        '<td class="actions">' + (b.type === 'fileio' && b.io_mode === 'O_DSYNC' ? '<button type="button" class="btn btn-sm btn-ghost" data-act="fua-compat" data-name="' + attr(b.name) + '">' + (b.fua_compat ? '关闭 FUA 兼容' : '启用 FUA 兼容') + '</button>' : '') + '<button type="button" class="btn btn-sm btn-ghost danger" data-act="del-backstore" data-type="' + attr(b.type) + '" data-name="' + attr(b.name) + '">删除</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';

    // sessions
    html += '<h3 class="is-h">已连接客户端 <span class="count">' + sessions.length + '</span></h3>';
    html += '<div class="is-card" style="padding:0"><div class="is-tablewrap"><table class="is-table"><thead><tr>' +
      '<th>客户端</th><th>IQN</th><th>目标</th><th>地址</th><th>LUNs</th><th>状态</th></tr></thead><tbody>';
    if (!sessions.length) html += '<tr class="empty"><td colspan="6">没有已登录的客户端。</td></tr>';
    sessions.forEach(function (x) {
      html += '<tr>' +
        '<td><span class="dot on"></span><b>' + esc(x.alias || '-') + '</b>' + (x.dynamic ? ' <span class="badge gray plain">动态连接</span>' : '') + '</td>' +
        '<td><code>' + esc(x.initiator) + '</code></td>' +
        '<td><code>' + esc(shortName(x.target)) + '</code></td>' +
        '<td class="num">' + esc((x.addresses || []).join(', ') || '-') + '</td>' +
        '<td class="num">' + esc((x.luns || []).slice().sort(function (a, b) { return a - b; }).join(', ') || '-') + '</td>' +
        '<td>' + (x.state === 'LOGGED_IN' ? '<span class="badge green">已登录</span>' : '<span class="badge yellow">' + esc(x.state || '?') + '</span>') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div class="is-foot"><span>配置文件： <code>' + esc(svc.save_file || '') + '</code></span>' +
      '<span>每次修改都会自动保存到配置文件。</span>' +
      '<span>iSCSI Manager ' + esc(app.dataset.version || '') + '</span></div>';

    root.innerHTML = html;
  }

  function card(label, big, sub) {
    return '<div class="is-card"><div class="lbl">' + esc(label) + '</div><div class="big">' + big + '</div><div class="sub">' + sub + '</div></div>';
  }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  function renderTarget(t, sessions) {
    var g = t.tpgs[0];
    if (!g) return '';
    var w = attr(t.wwn);
    var sess = sessions.filter(function (x) { return x.target === t.wwn; });
    var isCollapsed = !!collapsed[t.wwn];
    var badges =
      (g.enabled ? '<span class="badge green">已启用</span>' : '<span class="badge red">已停用</span>') +
      (g.shared ? '<span class="badge orange">共享模式 &middot; 允许任意客户端</span>' : '<span class="badge gray">受限模式 &middot; 仅允许 ACL 中的客户端</span>') +
      (g.auth ? '<span class="badge yellow">CHAP</span>' : '') +
      (sess.length ? '<span class="badge green">' + plural(sess.length, 'session') + '</span>' : '');

    // LUNs
    var luns = '<table class="is-table"><thead><tr><th>LUN</th><th>后端存储</th><th class="right">容量</th><th></th></tr></thead><tbody>';
    if (!g.luns.length) luns += '<tr class="empty"><td colspan="4">还没有 LUN。请挂接后端存储以提供虚拟磁盘。</td></tr>';
    g.luns.forEach(function (l) {
      luns += '<tr><td class="num">lun' + l.index + '</td>' +
        '<td><b>' + esc(l.bs_name) + '</b> <span class="muted">' + esc(l.bs_type) + '</span><br><code class="muted">' + esc(l.path) + '</code></td>' +
        '<td class="num right">' + esc(l.size_h) + '</td>' +
        '<td class="actions"><button type="button" class="btn btn-sm btn-ghost danger" data-act="del-lun" data-wwn="' + w + '" data-lun="' + l.index + '">移除</button></td></tr>';
    });
    luns += '</tbody></table>';

    // ACLs
    var acls = '<table class="is-table"><thead><tr><th>客户端</th><th>访问权限</th><th></th></tr></thead><tbody>';
    if (!g.acls.length) {
      acls += '<tr class="empty"><td colspan="3">' + (g.shared ? '共享模式：所有客户端均可连接。可添加 ACL，为指定主机设置 CHAP 或 LUN 映射。' : '还没有客户端 ACL。添加后，客户端才可连接。') + '</td></tr>';
    }
    g.acls.forEach(function (a) {
      var on = !!a.session;
      var conn = on ? '<div class="sess-line">' + esc(a.session.alias || '') + (a.session.connections || []).map(function (c) { return ' @ ' + esc(c.address); }).join('') + '</div>' : '';
      var mapped = a.mapped_luns.slice().sort(function (x, y) { return x.index - y.index; }).map(function (m) {
        return '<span class="' + (m.write_protect ? 'ro' : '') + '">lun' + m.tpg_lun + (m.write_protect ? ' 只读' : '') + '</span>';
      }).join(', ') || '<span class="muted">未映射任何 LUN</span>';
      acls += '<tr><td><span class="dot ' + (on ? 'on' : '') + '" title="' + (on ? '已登录' : '未连接') + '"></span><code>' + esc(a.node_wwn) + '</code>' + conn + '</td>' +
        '<td><div class="acl-luns">' + mapped + '</div>' + (a.chap ? '<span class="badge yellow">CHAP ' + esc(a.chap_userid) + (a.mutual_chap ? ' +双向验证' : '') + '</span>' : '') + '</td>' +
        '<td class="actions">' +
          '<button type="button" class="btn btn-sm btn-ghost" data-act="chap" data-wwn="' + w + '" data-init="' + attr(a.node_wwn) + '">CHAP</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-act="map" data-wwn="' + w + '" data-init="' + attr(a.node_wwn) + '">映射</button>' +
          '<button type="button" class="btn btn-sm btn-ghost danger" data-act="del-acl" data-wwn="' + w + '" data-init="' + attr(a.node_wwn) + '">移除</button>' +
        '</td></tr>';
    });
    (g.dynamic_sessions || []).forEach(function (name) {
      acls += '<tr><td><span class="dot on"></span><code>' + esc(name) + '</code> <span class="badge gray plain">动态连接</span></td><td class="muted">全部 LUN（共享模式）</td><td class="actions"><button type="button" class="btn btn-sm btn-ghost" data-act="add-acl" data-wwn="' + w + '" data-init="' + attr(name) + '">固定为 ACL</button></td></tr>';
    });
    acls += '</tbody></table>';

    // portals
    var portals = '<table class="is-table"><thead><tr><th>监听地址</th><th></th></tr></thead><tbody>';
    if (!g.portals.length) portals += '<tr class="empty"><td colspan="2">没有监听地址，客户端无法访问此目标。</td></tr>';
    g.portals.forEach(function (p) {
      portals += '<tr><td class="num">' + esc(p.ip) + ':' + esc(p.port) + (p.ip === '0.0.0.0' ? ' <span class="muted">（全部 IPv4 地址）</span>' : '') + '</td>' +
        '<td class="actions"><button type="button" class="btn btn-sm btn-ghost danger" data-act="del-portal" data-wwn="' + w + '" data-ip="' + attr(p.ip) + '" data-port="' + attr(p.port) + '">移除</button></td></tr>';
    });
    portals += '</tbody></table>';

    return '<div class="tgt ' + (isCollapsed ? 'collapsed' : '') + (g.enabled ? '' : ' disabled') + '" data-wwn="' + w + '">' +
      '<div class="tgt-head">' +
        '<button type="button" class="toggle" data-act="toggle" data-wwn="' + w + '" title="收起 / 展开">&#9662;</button>' +
        '<div class="tgt-title"><span class="name">' + esc(shortName(t.wwn)) + '</span><span class="iqn">' + esc(t.wwn) + '</span></div>' +
        '<div class="tgt-badges">' + badges + '</div>' +
        '<div class="tgt-actions">' +
          '<button type="button" class="btn btn-sm btn-outline" data-act="mode" data-wwn="' + w + '" data-mode="' + (g.shared ? 'restricted' : 'shared') + '">' + (g.shared ? '设为受限' : '设为共享') + '</button>' +
          '<button type="button" class="btn btn-sm btn-outline" data-act="enable" data-wwn="' + w + '" data-on="' + (g.enabled ? '0' : '1') + '">' + (g.enabled ? '停用' : '启用') + '</button>' +
          '<button type="button" class="btn btn-sm btn-ghost danger" data-act="del-target" data-wwn="' + w + '">删除</button>' +
        '</div>' +
      '</div>' +
      '<div class="tgt-body">' +
        '<div class="tgt-col"><h4 class="is-h4">LUNs <button type="button" class="btn btn-sm btn-outline" data-act="add-lun" data-wwn="' + w + '">+ 挂接后端存储</button></h4>' + luns + '</div>' +
        '<div class="tgt-col"><h4 class="is-h4">客户端访问控制（ACL） <button type="button" class="btn btn-sm btn-outline" data-act="add-acl" data-wwn="' + w + '">+ 添加客户端</button></h4>' + acls + '</div>' +
        '<div class="tgt-col"><h4 class="is-h4">监听地址 <button type="button" class="btn btn-sm btn-outline" data-act="add-portal" data-wwn="' + w + '">+ 添加</button></h4>' + portals + '</div>' +
      '</div>' +
    '</div>';
  }

  // ── actions ──────────────────────────────────────────────────────
  function findTarget(wwn) { return state.targets.filter(function (t) { return t.wwn === wwn; })[0]; }
  function findAcl(wwn, init) {
    var t = findTarget(wwn);
    return t && t.tpgs[0].acls.filter(function (a) { return a.node_wwn === init; })[0];
  }

  function run(action, params, okMsg) {
    return api(action, params).then(function () { if (okMsg) toast(okMsg); }).catch(function (e) { toast(e.message, 'error'); throw e; });
  }
  function runIn(action, params, okMsg) {
    // same as run() but lets the modal show the error instead of a toast
    return api(action, params).then(function () { if (okMsg) toast(okMsg); });
  }

  var actions = {
    'refresh': function () { refresh().then(function () { toast('已刷新', 'info'); }); },
    'save': function () { run('saveconfig', {}, '配置已保存'); },
    'toggle': function (d) { collapsed[d.wwn] = !collapsed[d.wwn]; render(); },

    'new-target': function () {
      modal({
        title: '创建 iSCSI 目标',
        body:
          '<div class="fg"><label>目标 IQN</label><input type="text" id="f-iqn" class="mono" value="' + attr(iqnDefault()) + '" placeholder="iqn.YYYY-MM.reversed.domain:name"></div>' +
          '<p class="help">留空可由 LIO 自动生成名称。请使用小写英文字母、数字、点、连字符和冒号。</p>' +
          '<div class="fg"><label>访问模式</label><select id="f-mode">' +
            '<option value="restricted">受限：仅允许 ACL 中的客户端连接</option>' +
            '<option value="shared">共享：任意客户端均可连接和写入（集群）</option>' +
          '</select></div>' +
          '<div class="fg inline"><input type="checkbox" id="f-portal" checked><label for="f-portal">监听全部 IPv4 地址，端口 3260</label></div>',
        buttons: [{ label: '取消', cls: 'btn-outline' }, { label: '创建目标', onClick: function () {
          return runIn('create_target', { wwn: val('f-iqn'), access_mode: val('f-mode'), default_portal: checked('f-portal') }, '目标已创建');
        } }]
      });
    },

    'del-target': function (d) {
      var t = findTarget(d.wwn), g = t.tpgs[0];
      var live = state.sessions.filter(function (x) { return x.target === d.wwn; }).length;
      confirmModal('删除目标',
        '<p>删除 <code>' + esc(d.wwn) + '</code>？</p>' +
        '<p class="muted">' + plural(g.luns.length, 'LUN') + ', ' + plural(g.acls.length, 'ACL') + '、' + plural(g.portals.length, 'portal') + '将被移除。后端存储及其数据会保留。</p>' +
        (live ? '<div class="iscsi-notice warn" style="margin:0 0 10px"><b>' + plural(live, 'initiator is', 'initiators are') + '已登录。</b> 这些客户端将立即失去此磁盘。</div><div class="fg inline"><input type="checkbox" id="f-force"><label for="f-force">我已了解，仍然删除</label></div>' : ''),
        '删除目标', function () {
          if (live && !checked('f-force')) throw new Error('请先勾选确认框');
          return runIn('delete_target', { wwn: d.wwn, force: live ? true : false }, '目标已删除');
        });
    },

    'mode': function (d) {
      var toShared = d.mode === 'shared';
      confirmModal(toShared ? '切换为共享模式' : '切换为受限模式',
        toShared
          ? '<p>任何能访问监听地址的客户端都可在没有 ACL 的情况下登录，并<b>读写此目标的全部 LUN</b>。</p><p class="muted">适用于可信网络，以及无需单独维护 ACL 的虚拟化集群。</p>'
          : '<p>仅允许 ACL 中的客户端登录。当前动态连接的客户端会断开。</p>',
        toShared ? '设为共享' : '设为受限',
        function () { return runIn('set_mode', { wwn: d.wwn, mode: d.mode }, '访问模式已更新'); }, toShared);
    },

    'enable': function (d) {
      var on = d.on === '1';
      if (on) return run('set_enabled', { wwn: d.wwn, enabled: true }, '目标已启用');
      confirmModal('停用目标', '<p>停用 <code>' + esc(d.wwn) + '</code>会断开全部客户端连接，但保留配置。</p>', '停用',
        function () { return runIn('set_enabled', { wwn: d.wwn, enabled: false }, '目标已停用'); });
    },

    'new-backstore': function () {
      var free = state.disks.filter(function (x) { return !x.in_use.length; });
      var busy = state.disks.filter(function (x) { return x.in_use.length; });
      var devOpts = free.map(function (x) {
        return '<option value="' + attr(x.path) + '">' + esc(x.path) + ' &middot; ' + esc(x.size_h) + (x.model ? ' &middot; ' + esc(x.model) : '') + (x.fstype ? ' &middot; ' + esc(x.fstype) : '') + '</option>';
      }).join('');
      var busyOpts = busy.map(function (x) {
        return '<option value="" disabled>' + esc(x.path) + ' &middot; ' + esc(x.size_h) + ' &middot; ' + esc(x.in_use.join(', ')) + '</option>';
      }).join('');
      modal({
        title: '创建后端存储',
        body:
          '<div class="fg"><label>类型</label><select id="f-type">' +
            '<option value="fileio">镜像文件（fileio）：共享目录中的文件，按需分配空间</option>' +
            '<option value="block">块设备：整块未分配磁盘或分区</option>' +
          '</select></div>' +
          '<div class="fg"><label>名称</label><input type="text" id="f-name" class="mono" placeholder="vmstore" maxlength="64"></div>' +
          '<div id="f-fileio">' +
            '<div class="fg"><label>镜像文件路径</label><input type="text" id="f-path" class="mono" value="/mnt/user/iscsi/" placeholder="/mnt/user/share/disk.img"></div>' +
            '<div class="fg"><div class="row"><div><label>容量（仅用于新建文件）</label><input type="text" id="f-size" class="mono" placeholder="500G"></div>' +
            '<div><label>缓存</label><select id="f-wb"><option value="0">直写（较安全）</option><option value="1">回写（较快，断电时有数据丢失风险）</option><option value="fua">同步直写＋FUA 兼容（Mac 每次写入模式）</option></select></div></div></div>' +
            '<p class="help">新建镜像为稀疏文件，实际占用空间随客户端写入增长。指定已有镜像可直接复用，并自动识别容量。</p>' +
          '</div>' +
          '<div id="f-block" style="display:none">' +
            '<div class="fg"><label>设备</label><select id="f-dev">' + (devOpts || '<option value="">没有空闲设备</option>') + (busyOpts ? '<optgroup label="正在使用">' + busyOpts + '</optgroup>' : '') + '</select></div>' +
            '<div class="fg inline"><input type="checkbox" id="f-ro"><label for="f-ro">以只读方式提供</label></div>' +
            '<p class="help">整个设备将原样交给客户端使用。客户端创建文件系统会覆盖设备上的已有内容。阵列、存储池及启动 U 盘中的设备不可选。</p>' +
          '</div>',
        onOpen: function () {
          el('f-type').addEventListener('change', function () {
            var f = this.value === 'fileio';
            el('f-fileio').style.display = f ? '' : 'none';
            el('f-block').style.display = f ? 'none' : '';
          });
          el('f-name').addEventListener('input', function () {
            var p = el('f-path');
            if (/\/$/.test(p.value) || /\/[^\/]*\.img$/.test(p.value)) p.value = p.value.replace(/[^\/]*$/, '') + this.value + (this.value ? '.img' : '');
          });
        },
        buttons: [{ label: '取消', cls: 'btn-outline' }, { label: '创建后端存储', onClick: function () {
          var type = val('f-type');
          var p = { type: type, name: val('f-name'), write_back: val('f-wb') === '1', fua_compat: type === 'fileio' && val('f-wb') === 'fua' };
          if (!p.name) throw new Error('请输入名称');
          if (type === 'fileio') { p.path = val('f-path'); p.size = val('f-size'); if (!p.path || /\/$/.test(p.path)) throw new Error('请输入完整的镜像文件路径'); }
          else { p.path = val('f-dev'); p.readonly = checked('f-ro'); if (!p.path) throw new Error('请选择设备'); }
          return runIn('create_backstore', p, '后端存储已创建');
        } }]
      });
    },

    'fua-compat': function (d) {
      var b = state.backstores.filter(function (x) { return x.type === 'fileio' && x.name === d.name; })[0];
      if (!b) return;
      confirmModal(b.fua_compat ? '关闭 FUA 兼容' : '启用 FUA 兼容',
        '<p>修改 <b>' + esc(b.name) + '</b> 的 FUA 能力声明，实际镜像写入仍保持同步直写（O_DSYNC）。请先在客户端断开此磁盘；修改后重新连接。</p>' +
        '<p>启用后可配合 Mac 客户端的“On every write — safest”。镜像内容不会清除。</p>',
        '确认修改', function () { return api('set_fua_compat', { name: b.name, enabled: !b.fua_compat }); });
    },

    'del-backstore': function (d) {
      var b = state.backstores.filter(function (x) { return x.type === d.type && x.name === d.name; })[0];
      if (!b) return;
      if (b.attached.length) {
        return modal({ title: '后端存储正在使用', body: '<p><b>' + esc(b.name) + '</b>已作为 LUN 挂接到 ' + b.attached.map(function (a) { return '<code>' + esc(shortName(a.target)) + '</code>'; }).join(', ') + '。请先移除这些 LUN。</p>', buttons: [{ label: '确定', cls: 'btn-outline' }] });
      }
      confirmModal('删除后端存储',
        '<p>删除后端存储 <b>' + esc(b.name) + '</b> (<code>' + esc(b.path) + '</code>)？</p>' +
        (b.type === 'fileio' ? '<div class="fg inline"><input type="checkbox" id="f-delfile"><label for="f-delfile">同时删除磁盘上的镜像文件（' + esc(b.size_h) + '，无法撤销）</label></div>' : '<p class="muted">设备本身及其数据会保留。</p>'),
        '删除后端存储', function () {
          return runIn('delete_backstore', { type: d.type, name: d.name, delete_file: checked('f-delfile') }, '后端存储已删除');
        });
    },

    'add-lun': function (d) {
      var t = findTarget(d.wwn), g = t.tpgs[0];
      var attached = {};
      g.luns.forEach(function (l) { attached[l.storage_object] = true; });
      var items = state.backstores.map(function (b) {
        var key = '/backstores/' + b.type + '/' + b.name;
        var here = attached[key];
        var elsewhere = b.attached.filter(function (a) { return a.target !== d.wwn; });
        var why = here ? '已挂接到此目标' : (elsewhere.length ? '也挂接到 ' + shortName(elsewhere[0].target) : '');
        return '<label class="' + (here ? 'off' : '') + '"><input type="checkbox" name="f-bs" value="' + attr(b.type + '/' + b.name) + '" ' + (here ? 'disabled' : '') + '> <b>' + esc(b.name) + '</b> <span class="muted">' + esc(b.type) + ' &middot; ' + esc(b.size_h) + '</span>' + (why ? '<span class="why">' + esc(why) + '</span>' : '') + '</label>';
      }).join('');
      modal({
        title: '将后端存储挂接为 LUN',
        body: '<p class="muted mono">' + esc(d.wwn) + '</p>' +
          '<div class="fg"><label>后端存储</label><div class="checklist">' + (items || '<label class="off">还没有后端存储</label>') + '</div></div>' +
          '<p class="help">每个选中的后端存储都会成为独立 LUN，自动编号并映射给现有的全部客户端 ACL。只有使用支持集群的文件系统，才能安全地在多个目标之间共享同一后端存储。</p>',
        buttons: [{ label: '取消', cls: 'btn-outline' }, { label: '挂接', onClick: function () {
          var sel = Array.prototype.map.call(document.querySelectorAll('input[name=f-bs]:checked'), function (x) { return x.value; });
          if (!sel.length) throw new Error('请至少选择一个后端存储');
          return runIn('add_lun', { wwn: d.wwn, backstores: sel }, plural(sel.length, 'LUN') + ' 已挂接');
        } }]
      });
    },

    'del-lun': function (d) {
      var live = state.sessions.filter(function (x) { return x.target === d.wwn && (x.luns || []).indexOf(+d.lun) >= 0; }).length;
      confirmModal('移除 LUN', '<p>移除 <b>LUN ' + esc(d.lun) + '</b>，所属目标：<code>' + esc(shortName(d.wwn)) + '</code>？ 后端存储及其数据会保留。</p>' +
        (live ? '<div class="iscsi-notice warn" style="margin:0"><b>' + plural(live, 'initiator', 'initiators') + '正在使用此 LUN。</b> 这些客户端将立即失去此磁盘。</div>' : ''),
        '移除 LUN', function () { return runIn('delete_lun', { wwn: d.wwn, lun: +d.lun }, 'LUN 已移除'); });
    },

    'add-acl': function (d) {
      var known = uniq(state.sessions.map(function (x) { return x.initiator; }).concat(state.targets.reduce(function (a, t) { return a.concat(t.tpgs[0].acls.map(function (x) { return x.node_wwn; })); }, [])));
      modal({
        title: '添加客户端 ACL',
        body: '<p class="muted mono">' + esc(d.wwn) + '</p>' +
          '<div class="fg"><label>客户端 IQN</label><input type="text" id="f-init" class="mono" list="f-init-list" value="' + attr(d.init || '') + '" placeholder="iqn.1998-01.com.vmware:esxi01-12345678"><datalist id="f-init-list">' + known.map(function (x) { return '<option value="' + attr(x) + '">'; }).join('') + '</datalist></div>' +
          '<p class="help">可在客户端查找 IQN：ESXi 的<i>存储 &rsaquo; 适配器 &rsaquo; iSCSI</i>，Proxmox/Linux 的 <code>/etc/iscsi/initiatorname.iscsi</code>，Windows 的 <i>iSCSI 发起程序 &rsaquo; 配置</i>。现有全部 LUN 会映射到新 ACL。</p>',
        buttons: [{ label: '取消', cls: 'btn-outline' }, { label: '添加 ACL', onClick: function () {
          return runIn('add_acl', { wwn: d.wwn, initiator: val('f-init') }, '客户端已添加');
        } }]
      });
    },

    'del-acl': function (d) {
      var a = findAcl(d.wwn, d.init);
      confirmModal('移除客户端 ACL', '<p>移除 <code>' + esc(d.init) + '</code>，所属目标：<code>' + esc(shortName(d.wwn)) + '</code>？</p>' +
        (a && a.session ? '<div class="iscsi-notice warn" style="margin:0"><b>此客户端当前已登录</b>，操作后将断开连接。</div>' : ''),
        '移除 ACL', function () { return runIn('delete_acl', { wwn: d.wwn, initiator: d.init }, '客户端已移除'); });
    },

    'chap': function (d) {
      var a = findAcl(d.wwn, d.init) || {};
      modal({
        title: 'CHAP 身份验证',
        body: '<dl class="kv"><dt>目标</dt><dd>' + esc(shortName(d.wwn)) + '</dd><dt>客户端</dt><dd>' + esc(d.init) + '</dd></dl>' +
          '<div class="fg"><div class="row"><div><label>CHAP 用户名</label><input type="text" id="f-cu" class="mono" autocomplete="off" value="' + attr(a.chap_userid || '') + '"></div><div><label>CHAP 密码（12 至 16 个字符）</label><input type="text" id="f-cp" class="mono" autocomplete="off"></div></div></div>' +
          '<div class="fg"><div class="row"><div><label>双向 CHAP 用户名（可选）</label><input type="text" id="f-mu" class="mono" autocomplete="off"></div><div><label>双向 CHAP 密码（12 至 16 个字符）</label><input type="text" id="f-mp" class="mono" autocomplete="off"></div></div></div>' +
          '<p class="help">设置 CHAP 会为整个目标启用身份验证，此目标中的每个 ACL 都需要配置凭据。仅可使用英文字母、数字和 <code>. : _ + -</code>。已有密码不会显示。</p>',
        buttons: [
          { label: '取消', cls: 'btn-outline' },
          { label: '清除 CHAP', cls: 'btn-outline', onClick: function () { return runIn('set_chap', { wwn: d.wwn, initiator: d.init, clear: true }, 'CHAP 已清除'); } },
          { label: '设置 CHAP', onClick: function () {
            return runIn('set_chap', { wwn: d.wwn, initiator: d.init, userid: val('f-cu'), password: val('f-cp'), mutual_userid: val('f-mu'), mutual_password: val('f-mp') }, 'CHAP 已更新');
          } }
        ]
      });
    },

    'map': function (d) {
      var a = findAcl(d.wwn, d.init);
      if (!a) return;
      var rows = a.mapped_luns.slice().sort(function (x, y) { return x.index - y.index; }).map(function (m) {
        return '<label><input type="checkbox" data-ml="' + m.index + '" ' + (m.write_protect ? 'checked' : '') + '> lun' + m.tpg_lun + ' <span class="muted">映射为 LUN ' + m.index + '</span><span class="why">只读</span></label>';
      }).join('');
      modal({
        title: 'LUN 映射',
        body: '<dl class="kv"><dt>客户端</dt><dd>' + esc(d.init) + '</dd></dl>' +
          '<div class="fg"><label>勾选 LUN 后，此客户端只能读取该 LUN</label><div class="checklist">' + (rows || '<label class="off">未映射任何 LUN</label>') + '</div></div>',
        buttons: [{ label: '关闭', cls: 'btn-outline' }, { label: '应用', onClick: function () {
          var changes = [];
          a.mapped_luns.forEach(function (m) {
            var cb = document.querySelector('input[data-ml="' + m.index + '"]');
            if (cb && cb.checked !== !!m.write_protect) changes.push({ wwn: d.wwn, initiator: d.init, mapped_lun: m.index, write_protect: cb.checked });
          });
          return changes.reduce(function (p, c) { return p.then(function () { return api('set_mapped_lun_wp', c); }); }, Promise.resolve())
            .then(function () { if (changes.length) toast('映射已更新'); });
        } }]
      });
    },

    'add-portal': function (d) {
      modal({
        title: '添加监听地址',
        body: '<p class="muted mono">' + esc(d.wwn) + '</p>' +
          '<div class="fg"><div class="row"><div style="flex:2"><label>IP 地址</label><input type="text" id="f-ip" class="mono" value="0.0.0.0"></div><div><label>端口</label><input type="number" id="f-port" class="mono" value="3260" min="1" max="65535"></div></div></div>' +
          '<p class="help"><code>0.0.0.0</code> 表示监听全部 IPv4 地址。指定具体地址可将目标限制在某个网络接口上，例如专用存储 VLAN。</p>',
        buttons: [{ label: '取消', cls: 'btn-outline' }, { label: '添加监听地址', onClick: function () {
          return runIn('add_portal', { wwn: d.wwn, ip: val('f-ip'), port: +val('f-port') }, '监听地址已添加');
        } }]
      });
    },

    'del-portal': function (d) {
      confirmModal('移除监听地址', '<p>移除 <code>' + esc(d.ip) + ':' + esc(d.port) + '</code>，所属目标：<code>' + esc(shortName(d.wwn)) + '</code>？ 通过此地址连接的客户端会断开。</p>',
        '移除监听地址', function () { return runIn('delete_portal', { wwn: d.wwn, ip: d.ip, port: +d.port }, '监听地址已移除'); });
    }
  };

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    var fn = actions[btn.dataset.act];
    if (fn) fn(Object.assign({}, btn.dataset));
  }

  // ── bootstrap ────────────────────────────────────────────────────
  function init(appEl) {
    app = appEl;
    root = el('iscsi-root');
    root.addEventListener('click', onClick);
    refresh().then(startPolling);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });
  }

  return { init: init, refresh: refresh, api: api, get state() { return state; } };
})();
