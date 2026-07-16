// ========== SURVIVE · 动物卡牌对战 - 浏览器版战斗引擎 ==========
// 从 server/gameLogic.js 移植，用于人机模式的本地游戏模拟

(function () {
  'use strict';

  // ========== 常量 ==========
  const CARD_TYPES = ['tiger', 'hunter', 'wolf', 'sheep', 'dog', 'cat', 'chicken'];
  const DEFAULT_CHAIN = ['tiger', 'hunter', 'wolf', 'sheep', 'dog', 'cat', 'chicken'];
  const SWAPPED_CHAIN = ['tiger', 'hunter', 'wolf', 'dog', 'sheep', 'cat', 'chicken'];

  const INITIAL_HAND = { tiger: 1, hunter: 2, wolf: 1, sheep: 1, dog: 2, cat: 1, chicken: 1 };
  const INITIAL_HP = 2;
  const PLAY_COST = 1;
  const TIGER_DEATH_ROUNDS = 6;

  const CARD_META = {
    tiger:   { name: '虎',   emoji: '🐯', rank: 'Ⅰ' },
    hunter:  { name: '猎人', emoji: '🏹', rank: 'Ⅱ' },
    wolf:    { name: '狼',   emoji: '🐺', rank: 'Ⅲ' },
    sheep:   { name: '羊',   emoji: '🐑', rank: 'Ⅳ' },
    dog:     { name: '犬',   emoji: '🐕', rank: 'Ⅴ' },
    cat:     { name: '猫',   emoji: '🐱', rank: 'Ⅵ' },
    chicken: { name: '鸡',   emoji: '🐔', rank: 'Ⅶ' },
  };

  // ========== 链/排名工具 ==========
  function getChain(swapped) {
    return swapped ? SWAPPED_CHAIN : DEFAULT_CHAIN;
  }

  function getRank(cardType, swapped) {
    return getChain(swapped).indexOf(cardType);
  }

  // ========== 手牌生成 ==========
  let cardIdCounter = 0;

  function resetCardIdCounter() {
    cardIdCounter = 0;
  }

  function createPlayerHand(playerId) {
    const cards = [];
    for (const [type, count] of Object.entries(INITIAL_HAND)) {
      for (let i = 0; i < count; i++) {
        cards.push({
          id: 'local-card-' + (++cardIdCounter),
          type: type,
          hp: INITIAL_HP,
          maxHp: INITIAL_HP,
        });
      }
    }
    return cards;
  }

  // ========== 游戏状态初始化 ==========
  function createGameState(players) {
    return {
      players: players.map(function (p) {
        return {
          id: p.id,
          nickname: p.nickname,
          cards: createPlayerHand(p.id),
          eliminated: false,
          tigerLastPlayedRound: 0,
        };
      }),
      round: 0,
      phase: 'playing',
      playedCards: {},
      playersPlayed: [],
      chainSwapped: false,
      totalWolfDeaths: 0,
    };
  }

  // ========== 战斗结算 ==========
  function resolveRound(state) {
    const events = [];

    // ---- 收集本回合出牌信息 ----
    const playedEntries = [];
    for (let pi = 0; pi < state.players.length; pi++) {
      const player = state.players[pi];
      const cardId = state.playedCards[player.id];
      if (!cardId) continue;
      const card = player.cards.find(function (c) { return c.id === cardId; });
      if (card) {
        playedEntries.push({ playerId: player.id, card: card, player: player, nickname: player.nickname });
        if (card.type === 'tiger') {
          player.tigerLastPlayedRound = state.round;
        }
      }
    }

    events.push({ type: 'phase', description: '=== 第 ' + state.round + ' 回合 战斗开始 ===' });

    // 先记录出牌事件（暂时不扣血）
    for (let ei = 0; ei < playedEntries.length; ei++) {
      const entry = playedEntries[ei];
      events.push({
        type: 'play',
        playerId: entry.playerId,
        nickname: entry.nickname,
        cardType: entry.card.type,
        cardEmoji: CARD_META[entry.card.type].emoji,
        description: entry.nickname + ' 打出了 ' + CARD_META[entry.card.type].emoji + CARD_META[entry.card.type].name,
      });
    }

    // ---- 统计出牌类型 ----
    const tigerCount = playedEntries.filter(function (e) { return e.card.type === 'tiger'; }).length;
    const hunterCount = playedEntries.filter(function (e) { return e.card.type === 'hunter'; }).length;

    // ---- 特殊规则优先判定 ----

    // 1. 双虎清场
    if (tigerCount >= 2) {
      events.push({
        type: 'tiger_clear',
        description: '🐯 双虎齐聚，威震全场！所有卡牌被清除！',
      });
      for (let ai = 0; ai < playedEntries.length; ai++) {
        const entry = playedEntries[ai];
        entry.card.hp = 0;
        if (entry.card.type !== 'tiger') {
          events.push({
            type: 'card_destroyed',
            playerId: entry.playerId,
            nickname: entry.nickname,
            cardType: entry.card.type,
            description: entry.nickname + ' 的 ' + CARD_META[entry.card.type].name + ' 被虎威震杀',
          });
        }
      }
      return buildRoundResult(state, events, playedEntries);
    }

    // 2. 猎人互斥（无虎在场时，三张牌各扣1血，取代出牌消耗）
    if (hunterCount >= 2 && tigerCount === 0) {
      events.push({
        type: 'hunter_mutual',
        description: '🏹 猎人互斥！所有卡牌失去1血！',
      });
      for (let ai = 0; ai < playedEntries.length; ai++) {
        const entry = playedEntries[ai];
        entry.card.hp -= 1;  // 只扣1血（互斥即消耗，不叠加出牌消耗）
        events.push({
          type: 'damage',
          playerId: entry.playerId,
          nickname: entry.nickname,
          cardType: entry.card.type,
          amount: 1,
          source: 'hunter_chaos',
          description: entry.nickname + ' 的 ' + CARD_META[entry.card.type].name + ' 受到猎人互斥影响 -1血',
        });
        if (entry.card.hp <= 0) {
          events.push({
            type: 'card_destroyed',
            playerId: entry.playerId,
            nickname: entry.nickname,
            cardType: entry.card.type,
            description: entry.nickname + ' 的 ' + CARD_META[entry.card.type].name + ' 在互斥中死亡',
          });
        }
      }
      // 互斥后跳过正常捕食阶段
      return buildRoundResult(state, events, playedEntries);
    }

    // ---- 正常流程：出牌消耗 + 捕食 ----
    // 出牌消耗
    for (let ei = 0; ei < playedEntries.length; ei++) {
      const entry = playedEntries[ei];
      entry.card.hp -= PLAY_COST;
      if (entry.card.hp <= 0) {
        events.push({
          type: 'card_destroyed',
          playerId: entry.playerId,
          nickname: entry.nickname,
          cardType: entry.card.type,
          description: entry.nickname + ' 的 ' + CARD_META[entry.card.type].name + ' 因消耗过度而死亡',
        });
      }
    }

    // 移除已死亡的牌
    let alive = playedEntries.filter(function (e) { return e.card.hp > 0; });

    // ---- 狼灭绝检测 ----
    if (state.totalWolfDeaths >= 3 && !state.chainSwapped) {
      state.chainSwapped = true;
      events.push({
        type: 'chain_swapped',
        description: '🐺→🐑 狼灭绝！与犬地位互换，犬 > 羊！',
      });
    }

    // ---- 正常捕食 + 二打一 ----
    if (alive.length >= 2) {
      const currentChain = getChain(state.chainSwapped);

      // 统计各类型数量
      const typeCount = {};
      for (let ai = 0; ai < alive.length; ai++) {
        const t = alive[ai].card.type;
        typeCount[t] = (typeCount[t] || 0) + 1;
      }

      // 标记被二打一锁定的目标
      const teamupTargetIds = {};
      const teamupEvents = [];

      for (const type in typeCount) {
        if (typeCount[type] >= 2) {
          const rank = currentChain.indexOf(type);
          const predatorType = rank > 0 ? currentChain[rank - 1] : null;
          if (predatorType && typeCount[predatorType] === 1) {
            const predatorEntry = alive.find(function (e) { return e.card.type === predatorType; });
            if (predatorEntry) {
              teamupTargetIds[predatorEntry.card.id] = true;
              const attackers = alive.filter(function (e) { return e.card.type === type; });
              teamupEvents.push({
                type: 'teamup',
                targetPlayerId: predatorEntry.playerId,
                targetNickname: predatorEntry.nickname,
                targetCardType: predatorEntry.card.type,
                attackers: attackers.map(function (e) { return { playerId: e.playerId, nickname: e.nickname }; }),
                description: '⚔️ 二打一！'
                  + attackers.map(function (e) { return e.nickname; }).join('和')
                  + ' 的 ' + CARD_META[type].name
                  + ' 联手攻击 ' + predatorEntry.nickname + ' 的 ' + CARD_META[predatorType].name,
              });
            }
          }
        }
      }

      // 执行二打一伤害
      for (let tei = 0; tei < teamupEvents.length; tei++) {
        const te = teamupEvents[tei];
        events.push(te);
        for (let ai = 0; ai < alive.length; ai++) {
          const entry = alive[ai];
          if (entry.playerId === te.targetPlayerId && entry.card.type === te.targetCardType) {
            entry.card.hp -= 1;
            if (entry.card.hp <= 0) {
              events.push({
                type: 'card_destroyed',
                playerId: entry.playerId,
                nickname: entry.nickname,
                cardType: entry.card.type,
                description: entry.nickname + ' 的 ' + CARD_META[entry.card.type].name + ' 被二打一击败',
              });
            }
            break;
          }
        }
      }

      // 正常捕食：高rank牌攻击所有低rank牌
      for (let ai = 0; ai < alive.length; ai++) {
        const entry = alive[ai];
        if (entry.card.hp <= 0) continue;
        if (teamupTargetIds[entry.card.id]) continue;

        const attackerRank = currentChain.indexOf(entry.card.type);
        for (let ti = 0; ti < alive.length; ti++) {
          const target = alive[ti];
          if (target.card.hp <= 0) continue;
          if (target.playerId === entry.playerId) continue;
          const targetRank = currentChain.indexOf(target.card.type);
          if (attackerRank < targetRank) {
            target.card.hp -= 1;
            events.push({
              type: 'attack',
              attackerPlayerId: entry.playerId,
              attackerNickname: entry.nickname,
              attackerCardType: entry.card.type,
              targetPlayerId: target.playerId,
              targetNickname: target.nickname,
              targetCardType: target.card.type,
              description: entry.nickname + ' 的 ' + CARD_META[entry.card.type].name
                + ' → ' + target.nickname + ' 的 ' + CARD_META[target.card.type].name,
            });
            if (target.card.hp <= 0) {
              events.push({
                type: 'card_destroyed',
                playerId: target.playerId,
                nickname: target.nickname,
                cardType: target.card.type,
                description: target.nickname + ' 的 ' + CARD_META[target.card.type].name + ' 被击杀',
              });
            }
          }
        }
      }
    }

    // ---- 收尾 ----
    return buildRoundResult(state, events, playedEntries);
  }

  function buildRoundResult(state, events, playedEntries) {
    // 狼灭绝计数
    let currentWolfDeaths = 0;
    for (let pi = 0; pi < state.players.length; pi++) {
      const player = state.players[pi];
      for (let ci = 0; ci < player.cards.length; ci++) {
        const card = player.cards[ci];
        if (card.type === 'wolf' && card.hp <= 0) {
          currentWolfDeaths++;
        }
      }
    }
    state.totalWolfDeaths = currentWolfDeaths;

    if (state.totalWolfDeaths >= 3 && !state.chainSwapped) {
      state.chainSwapped = true;
      events.push({
        type: 'chain_swapped',
        description: '🐺→🐑 狼灭绝！犬与羊地位互换！',
      });
    }

    // ---- 自然死亡检测：虎超过6回合未出牌 ----
    for (let pi = 0; pi < state.players.length; pi++) {
      const player = state.players[pi];
      if (player.eliminated) continue;
      const tigerCard = player.cards.find(function (c) { return c.type === 'tiger' && c.hp > 0; });
      if (tigerCard && state.round - player.tigerLastPlayedRound >= TIGER_DEATH_ROUNDS) {
        tigerCard.hp = 0;
        events.push({
          type: 'tiger_death',
          playerId: player.id,
          nickname: player.nickname,
          description: '💔 ' + player.nickname + ' 的虎因久未出牌（'
            + (state.round - player.tigerLastPlayedRound) + '回合）而自然死亡',
        });
      }
    }

    // ---- 存活牌回手，淘汰检测 ----
    const survivors = {};
    const eliminated = [];

    for (let ei = 0; ei < playedEntries.length; ei++) {
      const entry = playedEntries[ei];
      if (!survivors[entry.playerId]) survivors[entry.playerId] = [];
      if (entry.card.hp > 0) {
        survivors[entry.playerId].push(entry.card);
      }
    }

    for (let pi = 0; pi < state.players.length; pi++) {
      const player = state.players[pi];
      if (player.eliminated) continue;

      const aliveCards = player.cards.filter(function (c) {
        const playedEntry = playedEntries.find(function (e) {
          return e.playerId === player.id && e.card.id === c.id;
        });
        if (playedEntry) return playedEntry.card.hp > 0;
        return c.hp > 0;
      });

      if (aliveCards.length === 0) {
        player.eliminated = true;
        eliminated.push({ id: player.id, nickname: player.nickname });
        events.push({
          type: 'eliminated',
          playerId: player.id,
          nickname: player.nickname,
          description: '❌ ' + player.nickname + ' 被淘汰！',
        });
      }
    }

    // ---- 检查游戏结束 ----
    const alivePlayers = state.players.filter(function (p) { return !p.eliminated; });
    let gameOver = false;
    let winnerId = null;

    if (alivePlayers.length <= 1) {
      gameOver = true;
      winnerId = alivePlayers.length === 1 ? alivePlayers[0].id : null;
    }

    if (gameOver && winnerId) {
      const winner = state.players.find(function (p) { return p.id === winnerId; });
      events.push({
        type: 'game_over',
        winnerId: winnerId,
        winnerNickname: winner ? winner.nickname : '未知',
        description: '🏆 游戏结束！' + (winner ? winner.nickname : '未知') + ' 获得胜利！',
      });
    }

    // ---- 构建回合结果 ----
    const result = {
      round: state.round,
      events: events,
      gameOver: gameOver,
      winnerId: winnerId,
      eliminated: eliminated.map(function (e) { return e.id; }),
      opponents: {},
      survivors: survivors,
    };

    for (let pi = 0; pi < state.players.length; pi++) {
      const player = state.players[pi];
      result.opponents[player.id] = {
        nickname: player.nickname,
        eliminated: player.eliminated,
        handSize: player.cards.filter(function (c) { return c.hp > 0; }).length,
      };
    }

    // ---- 清理出牌记录，准备下一回合 ----
    state.playedCards = {};
    state.playersPlayed = [];

    return result;
  }

  // ========== 超时自动出牌 ==========
  function autoPlayCard(state, playerId) {
    const player = state.players.find(function (p) { return p.id === playerId; });
    if (!player || player.eliminated) return null;

    const chain = getChain(state.chainSwapped);
    const aliveCards = player.cards.filter(function (c) { return c.hp > 0; });
    if (aliveCards.length === 0) return null;

    // 按rank排序，选rank最小的（最高等级）
    aliveCards.sort(function (a, b) {
      return chain.indexOf(a.type) - chain.indexOf(b.type);
    });
    return aliveCards[0];
  }

  // ========== 游戏结束检测 ==========
  function checkGameOver(state) {
    const alivePlayers = state.players.filter(function (p) { return !p.eliminated; });
    if (alivePlayers.length <= 1) {
      return {
        gameOver: true,
        winner: alivePlayers.length === 1 ? alivePlayers[0].id : null,
      };
    }
    return { gameOver: false, winner: null };
  }

  // ========== 导出到全局 ==========
  window.GameEngine = {
    CARD_TYPES: CARD_TYPES,
    CARD_META: CARD_META,
    DEFAULT_CHAIN: DEFAULT_CHAIN,
    SWAPPED_CHAIN: SWAPPED_CHAIN,
    getChain: getChain,
    getRank: getRank,
    INITIAL_HP: INITIAL_HP,
    PLAY_COST: PLAY_COST,
    TIGER_DEATH_ROUNDS: TIGER_DEATH_ROUNDS,
    resetCardIdCounter: resetCardIdCounter,
    createPlayerHand: createPlayerHand,
    createGameState: createGameState,
    resolveRound: resolveRound,
    autoPlayCard: autoPlayCard,
    checkGameOver: checkGameOver,
  };

})();
