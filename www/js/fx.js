/* ============================================================
   白日梦 · 轻量粒子/弹性交互动效（纯 JS + CSS，零依赖）
   20261106 新增：点赞/收藏粒子爆炸、未读红点粒子消散、弹性开关、切页过渡。
   统一挂到 window.bmFx，供 app.js / music.js 调用。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 工具：判断低配机（关闭重粒子，保流畅） ---------- */
  function _lowEnd() {
    try {
      const mem = navigator.deviceMemory || 4;
      const cores = navigator.hardwareConcurrency || 4;
      return mem <= 3 || cores <= 4;
    } catch (e) { return false; }
  }

  /* ---------- 1. 粒子爆炸（点赞/收藏）：图标放大回弹 + 四周散开一圈小粒子 ---------- */
  // opts: { color?, count?, r? }
  function burst(el, opts) {
    if (!el) return;
    opts = opts || {};
    const color = opts.color || '#f472b6';
    const count = _lowEnd() ? 8 : (opts.count || 12);
    // 图标放大回弹
    try {
      el.style.transition = 'transform .12s ease';
      el.style.transform = 'scale(1.35)';
      setTimeout(() => {
        el.style.transition = 'transform .3s cubic-bezier(.2,1.6,.4,1)';
        el.style.transform = 'scale(1)';
      }, 110);
    } catch (e) {}

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const baseR = opts.r || Math.max(rect.width, rect.height) * 0.55;

    // 统一画布层
    let layer = document.getElementById('bm-fx-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'bm-fx-layer';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147480000;';
      document.body.appendChild(layer);
    }

    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const r = baseR * (0.28 + Math.random() * 0.5);
      const size = r * 2;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5; // 向四周均匀散开 + 抖动
      const dist = baseR * (1.6 + Math.random() * 1.4);
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      const life = 480 + Math.random() * 320;
      p.style.cssText = [
        'position:fixed',
        'left:' + (cx - size / 2) + 'px',
        'top:' + (cy - size / 2) + 'px',
        'width:' + size + 'px',
        'height:' + size + 'px',
        'border-radius:50%',
        'background:' + (Math.random() < 0.3 ? '#fff' : color),
        'opacity:1',
        'transform:translate(0,0) scale(1)',
        'will-change:transform,opacity',
        'transition:transform ' + (life / 1000) + 's cubic-bezier(.16,.8,.3,1), opacity ' + (life / 1000) + 's ease'
      ].join(';');
      layer.appendChild(p);
      // 下一帧才移动，确保 transition 生效
      requestAnimationFrame(() => requestAnimationFrame(() => {
        p.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.2)';
        p.style.opacity = '0';
      }));
      setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, life + 60);
    }
  }

  /* ---------- 2. 未读红点粒子消散（拖动红点 → 粒子化消散） ---------- */
  // el = 红点元素；onDone = 消散完成后回调（清未读）
  function dissolveBadge(el, onDone) {
    if (!el) { if (onDone) onDone(); return; }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const color = '#f87171';
    const count = _lowEnd() ? 10 : 16;

    let layer = document.getElementById('bm-fx-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'bm-fx-layer';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147480000;';
      document.body.appendChild(layer);
    }

    // 原红点先缩放消失
    el.style.transition = 'transform .18s ease, opacity .18s ease';
    el.style.transform = 'scale(1.25)';
    el.style.opacity = '0';

    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const size = 5 + Math.random() * 7;
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 46;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist - 6; // 略向上飘
      const life = 380 + Math.random() * 320;
      p.style.cssText = [
        'position:fixed',
        'left:' + (cx - size / 2) + 'px',
        'top:' + (cy - size / 2) + 'px',
        'width:' + size + 'px',
        'height:' + size + 'px',
        'border-radius:50%',
        'background:' + (Math.random() < 0.25 ? '#fff' : color),
        'opacity:1',
        'will-change:transform,opacity',
        'transition:transform ' + (life / 1000) + 's cubic-bezier(.2,.7,.4,1), opacity ' + (life / 1000) + 's ease'
      ].join(';');
      layer.appendChild(p);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        p.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.1)';
        p.style.opacity = '0';
      }));
      setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, life + 60);
    }

    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); if (onDone) onDone(); }, 200);
  }

  /* ---------- 3. 弹性开关：旋钮移动时拉长成胶囊 + 到终点回弹 ---------- */
  // 需要开关的旋钮元素传入；type='x'(横向)/'left'(用 left 定位的 knob)
  function elasticKnob(knob, dir) {
    if (!knob) return;
    // 先拉长（向移动方向）
    knob.style.transition = 'none';
    knob.style.transform = (dir === 'left') ? 'scaleX(1.6)' : 'scaleX(1.6)';
    // 下一帧恢复 + 回弹
    requestAnimationFrame(() => requestAnimationFrame(() => {
      knob.style.transition = 'transform .3s cubic-bezier(.2,1.6,.4,1)';
      knob.style.transform = 'scaleX(1)';
    }));
  }

  /* ---------- 4. 切页过渡（底部导航/视图切换丝滑衔接） ---------- */
  // 给进入的 view 加淡入+轻微上移；可选给离开的 view 淡出
  function viewTransition(inEl) {
    if (!inEl) return;
    try {
      inEl.style.transition = 'none';
      inEl.style.opacity = '0';
      inEl.style.transform = 'translateY(8px)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        inEl.style.transition = 'opacity .26s ease, transform .26s cubic-bezier(.16,1,.3,1)';
        inEl.style.opacity = '1';
        inEl.style.transform = 'translateY(0)';
      }));
    } catch (e) {}
  }

  /* ---------- 5. 下拉刷新（聊天导航页） ---------- */
  // el = 滚动容器（scrollTop===0 时下拉触发）；onRefresh = 刷新回调（返回 Promise）
  function bindPullRefresh(el, onRefresh) {
    if (!el) return;
    let startY = 0, pulling = false, armed = false;
    const TH = 62;   // 触发阈值
    let indicator = null;

    function ensureIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement('div');
      indicator.className = 'bm-pull-refresh';
      indicator.innerHTML = '<span class="bm-pr-spinner"></span><span class="bm-pr-text">下拉刷新</span>';
      const parent = el.parentNode;
      if (parent && parent.style && parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
        // 不强制改父定位，指示器用 fixed 定位在列表上方
      }
      document.body.appendChild(indicator);
      return indicator;
    }
    function setIndicator(dist) {
      const ind = ensureIndicator();
      const rect = el.getBoundingClientRect();
      const top = rect.top + Math.min(dist, 90);
      ind.style.top = top + 'px';
      ind.style.opacity = Math.min(1, dist / TH);
      const txt = ind.querySelector('.bm-pr-text');
      if (txt) txt.textContent = dist >= TH ? '松开刷新' : '下拉刷新';
      ind.style.transform = 'translate(-50%,0) scale(' + (1 + Math.min(dist, TH) / TH * 0.15) + ')';
    }
    function resetIndicator(done) {
      if (!indicator) return;
      if (done) {
        const txt = indicator.querySelector('.bm-pr-text');
        if (txt) txt.textContent = '已刷新';
        const sp = indicator.querySelector('.bm-pr-spinner');
        if (sp) sp.style.borderTopColor = '#4cd964';
        setTimeout(() => { if (indicator) { indicator.style.opacity = '0'; } }, 500);
      } else {
        indicator.style.opacity = '0';
      }
    }

    el.addEventListener('touchstart', (e) => {
      if (el.scrollTop > 0) { pulling = false; return; }
      startY = e.touches[0].clientY;
      pulling = true;
      armed = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!pulling || el.scrollTop > 0) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) {
        // 顶部继续下拉才拦截
        if (dy > 8 && !armed) { armed = true; }
        if (armed) {
          setIndicator(dy);
          // 阻尼：实际位移随距离衰减，避免拉太远
        }
      }
    }, { passive: true });

    el.addEventListener('touchend', async (e) => {
      if (!pulling) return;
      pulling = false;
      const dy = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : startY) - startY;
      if (dy >= TH && armed) {
        // 触发刷新
        const ind = ensureIndicator();
        const sp = ind.querySelector('.bm-pr-spinner');
        const txt = ind.querySelector('.bm-pr-text');
        if (sp) sp.style.animation = 'bm-pr-spin .6s linear infinite';
        if (txt) txt.textContent = '刷新中…';
        try {
          if (onRefresh) await onRefresh();
        } catch (e) {}
        if (sp) sp.style.animation = '';
        resetIndicator(true);
      } else {
        resetIndicator(false);
      }
      armed = false;
    }, { passive: true });
  }

  window.bmFx = {
    burst: burst,
    dissolveBadge: dissolveBadge,
    elasticKnob: elasticKnob,
    viewTransition: viewTransition,
    bindPullRefresh: bindPullRefresh,
    lowEnd: _lowEnd
  };
})();
