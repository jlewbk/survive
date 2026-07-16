// ========== 动物卡牌对战 - 核心游戏逻辑 ==========

const CARD_TYPES = ['tiger', 'hunter', 'wolf', 'sheep', 'dog', 'cat', 'chicken'];
const DEFAULT_CHAIN = ['tiger', 'hunter', 'wolf', 'sheep', 'dog', 'cat', 'chicken'];
const SWAPPED_CHAIN = ['tiger', 'hunter', 'wolf', 'dog', 'sheep', 'cat', 'chicken'];

const INITIAL_HAND = { tiger: 1, hunter: 2, wolf: 1, sheep: 1, dog: 2, cat: 1, chicken: 1 };
const INITIAL_HP = 2;
const PLAY_COST = 1;
const TIGER_DEATH_ROUNDS = 6;

const CARD_META = {
  tiger:   { name: '虎',   emoji: '🐯' },
  hunter:  { name: '猎人', emoji: '🏹' },
  wolf:    { name: '狼',   emoji: '🐺' },
  sheep:   { name: '羊',   emoji: '🐑' },
  dog:     { name: '犬',   emoji: '🐕' },
  cat:     { name: '猫',   emoji: '🐱' },
  chicken: { name: '鸡',   emoji: '🐔' },
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

function createPlayerHand(playerId) {
  const cards = [];
  for (const [type, count] of Object.entries(INITIAL_HAND)) {
    for (let i = 0; i < count; i++) {
      cards.push({
        id: `card-${playerId}-${++cardIdCounter}`,
        type,
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
    players: players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      cards: createPlayerHand(p.id),
      eliminated: false,
      tigerLastPlayedRound: 0, // 0 = 从未打出
    })),
    round: 0,
    phase: 'playing',
    playedCards: {},     // playerId -> cardId
    playersPlayed: [],   // 已出牌的 playerId 列表
    chainSwapped: false,
    totalWolfDeaths: 0,
  };
}

// ========== 战斗结算 ==========

/**
 * 结算一轮战斗
 * @param {object} state - 游戏状态（会被修改）
 * @returns {object} roundResult
 */
function resolveRound(state) {
  const events = [];

  // ---- 收集本回合出牌信息 ----
  const playedEntries = [];
  for (const player of state.players) {
    const cardId = state.playedCards[player.id];
    if (!cardId) continue;
    const card = player.cards.find((c) => c.id === cardId);
    if (card) {
      playedEntries.push({ playerId: player.id, card, player, nickname: player.nickname });
      // 记录老虎最后打出回合
      if (card.type === 'tiger') {
        player.tigerLastPlayedRound = state.round;
      }
    }
  }

  events.push({ type: 'phase', description: `=== 第 ${state.round} 回合 战斗开始 ===` });

  // 先记录出牌事件（暂时不扣血）
  for (const entry of playedEntries) {
    events.push({
      type: 'play', playerId: entry.playerId, nickname: entry.nickname,
      cardType: entry.card.type, cardEmoji: CARD_META[entry.card.type].emoji,
      description: `${entry.nickname} 打出了 ${CARD_META[entry.card.type].emoji}${CARD_META[entry.card.type].name}`,
    });
  }

  // ---- 统计出牌类型 ----
  const tigerCount = playedEntries.filter((e) => e.card.type === 'tiger').length;
  const hunterCount = playedEntries.filter((e) => e.card.type === 'hunter').length;

  // ---- 特殊规则优先判定 ----

  // 1. 双虎清场
  if (tigerCount >= 2) {
    events.push({
      type: 'tiger_clear',
      description: '🐯 双虎齐聚，威震全场！所有卡牌被清除！',
    });
    for (const entry of playedEntries) {
      entry.card.hp = 0;
      if (entry.card.type !== 'tiger') {
        events.push({
          type: 'card_destroyed',
          playerId: entry.playerId, nickname: entry.nickname,
          cardType: entry.card.type,
          description: `${entry.nickname} 的 ${CARD_META[entry.card.type].name} 被虎威震杀`,
        });
      }
    }
    return buildRoundResult(state, events, playedEntries);
  }

  // 2. 猎人互斥（无虎在场，三张牌各扣1血，取代出牌消耗）
  if (hunterCount >= 2 && tigerCount === 0) {
    events.push({
      type: 'hunter_mutual',
      description: '🏹 猎人互斥！所有卡牌失去1血！',
    });
    for (const entry of playedEntries) {
      entry.card.hp -= 1;  // 只扣1血（互斥即消耗，不叠加出牌消耗）
      events.push({
        type: 'damage', playerId: entry.playerId, nickname: entry.nickname,
        cardType: entry.card.type, amount: 1, source: 'hunter_chaos',
        description: `${entry.nickname} 的 ${CARD_META[entry.card.type].name} 受到猎人互斥影响 -1血`,
      });
      if (entry.card.hp <= 0) {
        events.push({
          type: 'card_destroyed',
          playerId: entry.playerId, nickname: entry.nickname,
          cardType: entry.card.type,
          description: `${entry.nickname} 的 ${CARD_META[entry.card.type].name} 在互斥中死亡`,
        });
      }
    }
    // 互斥后跳过正常捕食
    return buildRoundResult(state, events, playedEntries);
  }

  // ---- 正常流程：出牌消耗 + 捕食 ----
  // 出牌消耗
  const prePlayHp = {};
  for (const entry of playedEntries) {
    prePlayHp[entry.card.id] = entry.card.hp;
    entry.card.hp -= PLAY_COST;
    if (entry.card.hp <= 0) {
      events.push({
        type: 'card_destroyed', playerId: entry.playerId, nickname: entry.nickname,
        cardType: entry.card.type, description: `${entry.nickname} 的 ${CARD_META[entry.card.type].name} 因消耗过度而死亡`,
      });
    }
  }

  // 移除已死亡的牌
  let alive = playedEntries.filter((e) => e.card.hp > 0);

  // ---- 狼灭绝检测 (Wolf Extinction) ----
  if (state.totalWolfDeaths >= 3 && !state.chainSwapped) {
    state.chainSwapped = true;
    events.push({
      type: 'chain_swapped',
      description: '🐺→🐑 狼灭绝！与犬地位互换，犬 > 羊！',
    });
  }

  // ---- Step 5: 正常捕食 (Normal Predation + 二打一) ----
  if (alive.length >= 2) {
    const currentChain = getChain(state.chainSwapped);

    // 统计各类型数量
    const typeCount = {};
    for (const entry of alive) {
      typeCount[entry.card.type] = (typeCount[entry.card.type] || 0) + 1;
    }

    // 标记被二打一锁定的目标（这些牌不能攻击）
    const teamupTargetIds = new Set();
    const teamupEvents = [];

    for (const [type, count] of Object.entries(typeCount)) {
      if (count >= 2) {
        const rank = currentChain.indexOf(type);
        const predatorType = rank > 0 ? currentChain[rank - 1] : null;
        if (predatorType && typeCount[predatorType] === 1) {
          // 二打一：两张同等级牌攻击高一级的单张牌
          const predatorEntry = alive.find((e) => e.card.type === predatorType);
          if (predatorEntry) {
            teamupTargetIds.add(predatorEntry.card.id);
            teamupEvents.push({
              type: 'teamup',
              targetPlayerId: predatorEntry.playerId,
              targetNickname: predatorEntry.nickname,
              targetCardType: predatorEntry.card.type,
              attackers: alive.filter((e) => e.card.type === type).map((e) => ({
                playerId: e.playerId,
                nickname: e.nickname,
              })),
              description: `⚔️ 二打一！${alive.filter((e) => e.card.type === type).map((e) => e.nickname).join('和')} 的 ${CARD_META[type].name} 联手攻击 ${predatorEntry.nickname} 的 ${CARD_META[predatorType].name}`,
            });
          }
        }
      }
    }

    // 处理二打一伤害
    for (const te of teamupEvents) {
      events.push(te);
      const predatorEntry = alive.find((e) => e.card.id === te.targetPlayerId ? false : e.card.id);
      // 找到目标牌
      for (const entry of alive) {
        if (entry.playerId === te.targetPlayerId && entry.card.type === te.targetCardType) {
          entry.card.hp -= 1;
          if (entry.card.hp <= 0) {
            events.push({
              type: 'card_destroyed',
              playerId: entry.playerId, nickname: entry.nickname,
              cardType: entry.card.type,
              description: `${entry.nickname} 的 ${CARD_META[entry.card.type].name} 被二打一击败`,
            });
          }
          break;
        }
      }
    }

    // 正常捕食：高rank牌攻击所有低rank牌（被二打一锁定的目标不能攻击）
    for (const entry of alive) {
      if (entry.card.hp <= 0) continue; // 已经死亡
      if (teamupTargetIds.has(entry.card.id)) continue; // 正在被攻击，不能攻击别人

      const attackerRank = currentChain.indexOf(entry.card.type);
      for (const target of alive) {
        if (target.card.hp <= 0) continue;
        if (target.playerId === entry.playerId) continue;
        const targetRank = currentChain.indexOf(target.card.type);
        if (attackerRank < targetRank) {
          // 高rank攻击低rank
          target.card.hp -= 1;
          events.push({
            type: 'attack',
            attackerPlayerId: entry.playerId, attackerNickname: entry.nickname,
            attackerCardType: entry.card.type,
            targetPlayerId: target.playerId, targetNickname: target.nickname,
            targetCardType: target.card.type,
            description: `${entry.nickname} 的 ${CARD_META[entry.card.type].name} → ${target.nickname} 的 ${CARD_META[target.card.type].name}`,
          });
          if (target.card.hp <= 0) {
            events.push({
              type: 'card_destroyed',
              playerId: target.playerId, nickname: target.nickname,
              cardType: target.card.type,
              description: `${target.nickname} 的 ${CARD_META[target.card.type].name} 被击杀`,
            });
          }
        }
      }
    }

    // ---- TODO: 捕食自死 (Predator Self-Death) ----
    // 规则："1血卡牌击杀低等级1血卡牌后，自身也死亡"
    // 当前所有卡牌在出牌消耗后都是1血(2→1)，如果启用会导致每回合全灭。
    // 等后续平衡测试后再决定是否激活。
    // 激活条件建议：攻击前(出牌消耗前)已经是1血(即上一回合受伤存活)的卡牌触发。
    // for (const entry of alive) {
    //   if (entry.card.hp <= 0) continue;
    //   if (prePlayHp[entry.card.id] !== 1) continue;
    //   // ... 捕食自死逻辑
    // }
  }

  // ---- 收尾: 构建结果 ----
  return buildRoundResult(state, events, playedEntries);
}

/**
 * 构建回合结果
 */
function buildRoundResult(state, events, playedEntries) {
  // 更新狼灭绝计数
  for (const entry of playedEntries) {
    if (entry.card.hp <= 0 && entry.card.type === 'wolf') {
      // 检查是否之前已经计过数（避免重复计数）
      // 简单通过检查是否已经被移出玩家手牌来判定
    }
  }

  // 实际死亡计数：遍历所有玩家的狼牌
  let currentWolfDeaths = 0;
  for (const player of state.players) {
    for (const card of player.cards) {
      if (card.type === 'wolf' && card.hp <= 0) {
        currentWolfDeaths++;
      }
    }
  }
  state.totalWolfDeaths = currentWolfDeaths;

  // 检查狼灭绝
  if (state.totalWolfDeaths >= 3 && !state.chainSwapped) {
    state.chainSwapped = true;
    events.push({
      type: 'chain_swapped',
      description: '🐺→🐑 狼灭绝！犬与羊地位互换！',
    });
  }

  // ---- Step 7: 自然死亡检测 ----
  // 老虎超过6回合未出牌则自然死亡
  for (const player of state.players) {
    if (player.eliminated) continue;
    const tigerCard = player.cards.find((c) => c.type === 'tiger' && c.hp > 0);
    if (tigerCard && state.round - player.tigerLastPlayedRound >= TIGER_DEATH_ROUNDS) {
      tigerCard.hp = 0;
      events.push({
        type: 'tiger_death',
        playerId: player.id, nickname: player.nickname,
        description: `💔 ${player.nickname} 的虎因久未出牌（${state.round - player.tigerLastPlayedRound}回合）而自然死亡`,
      });
    }
  }

  // ---- 存活牌回手，淘汰检测 ----
  const survivors = {}; // playerId -> card[]
  const eliminated = [];

  for (const entry of playedEntries) {
    if (!survivors[entry.playerId]) survivors[entry.playerId] = [];
    if (entry.card.hp > 0) {
      survivors[entry.playerId].push(entry.card);
    }
  }

  // 检查各玩家的淘汰状态
  for (const player of state.players) {
    if (player.eliminated) continue;
    // 统计该玩家所有存活卡牌（手牌中未出的 + 战场上存活回来的）
    const aliveCards = player.cards.filter((c) => {
      // 这张牌是否在本回合被打出但存活？
      const playedEntry = playedEntries.find((e) => e.playerId === player.id && e.card.id === c.id);
      if (playedEntry) return playedEntry.card.hp > 0;
      // 未打出的牌，hp>0即为存活
      return c.hp > 0;
    });

    if (aliveCards.length === 0) {
      player.eliminated = true;
      eliminated.push({ id: player.id, nickname: player.nickname });
      events.push({
        type: 'eliminated',
        playerId: player.id, nickname: player.nickname,
        description: `❌ ${player.nickname} 被淘汰！`,
      });
    }
  }

  // ---- 检查游戏结束 ----
  const alivePlayers = state.players.filter((p) => !p.eliminated);
  let gameOver = false;
  let winnerId = null;

  if (alivePlayers.length <= 1) {
    gameOver = true;
    winnerId = alivePlayers.length === 1 ? alivePlayers[0].id : null;
  }

  if (gameOver && winnerId) {
    const winner = state.players.find((p) => p.id === winnerId);
    events.push({
      type: 'game_over',
      winnerId: winnerId,
      winnerNickname: winner ? winner.nickname : '未知',
      description: `🏆 游戏结束！${winner ? winner.nickname : '未知'} 获得胜利！`,
    });
  }

  // ---- 构建回合结果 ----
  const result = {
    round: state.round,
    events,
    gameOver,
    winnerId,
    eliminated: eliminated.map((e) => e.id),
    // 对手信息（公开信息）
    opponents: {},
  };

  for (const player of state.players) {
    result.opponents[player.id] = {
      nickname: player.nickname,
      eliminated: player.eliminated,
      handSize: player.cards.filter((c) => c.hp > 0).length,
    };
  }

  // 个人存活信息（通过单独通道发送）
  result.survivors = survivors;

  // ---- 清理出牌记录，准备下一回合 ----
  state.playedCards = {};
  state.playersPlayed = [];

  // 验证老虎死亡事件按规则触发：在tiger_death之后再次检查
  // 但我们已经在上面检查过了

  return result;
}

// ========== 超时自动出牌 ==========

function autoPlayCard(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return null;

  // 选择手牌中rank最高的（数值最小）存活牌
  const chain = getChain(state.chainSwapped);
  const aliveCards = player.cards.filter((c) => c.hp > 0);
  if (aliveCards.length === 0) return null;

  // 按rank排序，选rank最小的（最高等级）
  aliveCards.sort((a, b) => chain.indexOf(a.type) - chain.indexOf(b.type));
  return aliveCards[0];
}

// ========== 游戏结束检测 (外部调用) ==========

function checkGameOver(state) {
  const alivePlayers = state.players.filter((p) => !p.eliminated);
  if (alivePlayers.length <= 1) {
    return {
      gameOver: true,
      winner: alivePlayers.length === 1 ? alivePlayers[0].id : null,
    };
  }
  return { gameOver: false, winner: null };
}

// ========== 导出 ==========

module.exports = {
  CARD_TYPES,
  CARD_META,
  DEFAULT_CHAIN,
  SWAPPED_CHAIN,
  getChain,
  getRank,
  INITIAL_HP,
  PLAY_COST,
  createPlayerHand,
  createGameState,
  resolveRound,
  autoPlayCard,
  checkGameOver,
};
