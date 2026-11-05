/* ============================================================================
   白日梦 · 打字卡（Typecard）非输入事件管理 —— eventManager.js
   ----------------------------------------------------------------------------
   职责：负责「非输入事件」的生成与调度 —— card（字卡）、emoji（表情）、pause（停顿）。
   架构红线（2026-10-08）：
     · generator 只做纯输入过程（letter/candidate/pick/delete/punct/done），
       绝不塞入 card/emoji/pause —— 这些事件由本模块统一管理；
     · 本模块产出的「演出事件」绝不进入 session.text，绝不改写最终文本；
     · 事件只是打字过程中随机真实发生的「演出层道具」，最终 text 严格还原原文。

   与 engine 的协作：
     engine 在驱动 generator 时，统计「连续正确上屏字数（pick correct）」，达到随机阈值
     nextEventCount∈[3,8] 时，调用本模块 nextEvent() 生成一个 card 或 emoji 事件（或 pause），
     再交给 ui.play 做演出层渲染。
   限制（单条消息）：
     · card  <= 2
     · emoji <= 1
     · pause 不计数（纯节奏停顿，无上限，但由 engine 决定是否插入）
   ============================================================================ */

(function (global) {
  'use strict';

  // 事件类型常量
  const EVENT = {
    CARD: 'card',
    EMOJI: 'emoji',
    PAUSE: 'pause'
  };

  // 创建一个事件管理器实例（每条消息一个实例，独立计数）
  // opts: {
  //   rng?: () => number        // 可注入随机源（测试用）
  //   cardMax?: number          // 单条字卡上限，默认 2
  //   emojiMax?: number         // 单条表情上限，默认 1
  //   pauseRate?: number        // 触发阈值时，有多大概率生成「纯停顿」而非字卡/表情，默认 0
  // }
  function createManager(opts) {
    const o = opts || {};
    const rng = (typeof o.rng === 'function') ? o.rng : Math.random;
    const CARD_MAX = (o.cardMax !== undefined) ? o.cardMax : 2;
    const EMOJI_MAX = (o.emojiMax !== undefined) ? o.emojiMax : 1;
    const PAUSE_RATE = (o.pauseRate !== undefined) ? o.pauseRate : 0;

    // 已产出计数（单条消息内累计）
    let cardCount = 0;
    let emojiCount = 0;

    const data = global.bmTypecardData;

    // 从资源池随机取一个（安全兜底：无池时返回 null）
    function pickFrom(pool) {
      if (!pool || !pool.length) return null;
      return pool[Math.floor(rng() * pool.length)];
    }

    // 生成下一个「非输入事件」（在连续正确上屏计数达到阈值时由 engine 调用）。
    // 返回 { type: 'card'|'emoji'|'pause', ... } 或 null（本轮无可产出事件时）。
    //
    // 选择策略：
    //   1. 若 card 已满（>=CARD_MAX）且 emoji 已满（>=EMOJI_MAX）→ 返回 null（不再插事件）；
    //   2. 若 pauseRate 命中 → 返回 { type:'pause', duration }（纯停顿）；
    //   3. 否则在「可选的字卡 / 表情」中随机挑一个（优先表情，因为表情限 1、更稀有）；
    //      - 若 emoji 未满且 (随机命中 emoji 或 card 已满) → emoji；
    //      - 否则 card（未满时）。
    function nextEvent() {
      const cardFull = cardCount >= CARD_MAX;
      const emojiFull = emojiCount >= EMOJI_MAX;

      // 两类都满 → 不再产出事件
      if (cardFull && emojiFull) return null;

      // 纯停顿（可选；默认 pauseRate=0 即不主动生成）
      if (rng() < PAUSE_RATE) {
        return {
          type: EVENT.PAUSE,
          duration: 200 + Math.floor(rng() * 300) // 200~500ms 停顿
        };
      }

      // 决定产出 emoji 还是 card
      let wantEmoji;
      if (cardFull) {
        wantEmoji = true;              // card 满了只能出 emoji（若 emoji 没满）
      } else if (emojiFull) {
        wantEmoji = false;             // emoji 满了只能出 card
      } else {
        // 都未满：表情更稀有，给较低概率（~35%），其余出字卡
        wantEmoji = rng() < 0.35;
      }

      if (wantEmoji && !emojiFull) {
        const emoji = pickFrom(data && data.emojiPool);
        if (emoji) {
          emojiCount++;
          return { type: EVENT.EMOJI, emoji: emoji };
        }
        // 表情池为空 → 退化出字卡（若 card 未满）
        if (!cardFull) {
          const card = pickFrom(data && data.cardPool);
          if (card) { cardCount++; return { type: EVENT.CARD, card: card }; }
        }
        return null;
      }

      if (!wantEmoji && !cardFull) {
        const card = pickFrom(data && data.cardPool);
        if (card) { cardCount++; return { type: EVENT.CARD, card: card }; }
        // 字卡池为空 → 退化出表情（若 emoji 未满）
        if (!emojiFull) {
          const emoji = pickFrom(data && data.emojiPool);
          if (emoji) { emojiCount++; return { type: EVENT.EMOJI, emoji: emoji }; }
        }
        return null;
      }

      return null;
    }

    // 重置计数（用于同一引擎复用管理器 / 测试）
    function reset() {
      cardCount = 0;
      emojiCount = 0;
    }

    return {
      EVENT: EVENT,
      nextEvent: nextEvent,
      reset: reset,
      get stats() {
        return { card: cardCount, emoji: emojiCount };
      }
    };
  }

  const eventManager = {
    EVENT: EVENT,
    createManager: createManager
  };

  global.bmTypecardEventManager = eventManager;
})(typeof window !== 'undefined' ? window : this);
