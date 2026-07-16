// ========== SURVIVE · AI玩家决策引擎 ==========
// 基于评分系统，中等难度，带随机性的智能出牌算法

(function () {
  'use strict';

  // ========== AI 配置 ==========
  const CONFIG = {
    // 基础等级分（越高越想保留）
    BASE_SCORE: {
      tiger:   100,
      hunter:  80,
      wolf:    60,
      sheep:   40,
      dog:     30,
      cat:     20,
      chicken: 10,
    },
    // 卡牌价值标签（用于决策参考）
    VALUE_TIER: {
      tiger:    'precious',
      hunter:   'precious',
      wolf:     'valuable',
      sheep:    'normal',
      dog:      'expendable',
      cat:      'expendable',
      chicken:  'expendable',
    },
    // 各等级的随机扰动幅度 (±)
    RANDOM_JITTER: 15,
    // 中等难度：从Top-N中随机选
    TOP_N: 3,
  };

  // ========== 核心决策函数 ==========

  /**
   * AI决定本回合出哪张牌
   * @param {object} playerState - AI玩家的状态 (含 id, cards, tigerLastPlayedRound 等)
   * @param {object} gameState - 完整游戏状态
   * @returns {string|null} 选中的卡牌ID，无牌可出返回null
   */
  function decideCard(playerState, gameState) {
    if (!playerState || playerState.eliminated) return null;

    const aliveCards = playerState.cards.filter(function (c) { return c.hp > 0; });
    if (aliveCards.length === 0) return null;

    // 如果只有一张牌，别无选择
    if (aliveCards.length === 1) return aliveCards[0].id;

    // 紧急情况检查：虎即将饿死
    const tigerCard = aliveCards.find(function (c) { return c.type === 'tiger'; });
    const roundsSinceTigerPlayed = gameState.round - playerState.tigerLastPlayedRound;
    const tigerStarving = tigerCard && roundsSinceTigerPlayed >= 5;

    if (tigerStarving) {
      // 虎处于饿死边缘，强制打出
      return tigerCard.id;
    }

    // ---- 逐张评分 ----
    const scoredCards = aliveCards.map(function (card) {
      return {
        card: card,
        score: evaluateCard(card, playerState, gameState),
      };
    });

    // ---- 按评分降序排列 ----
    scoredCards.sort(function (a, b) { return b.score - a.score; });

    // ---- 中等难度：从 Top-N 中随机选一张 ----
    const topCount = Math.min(CONFIG.TOP_N, scoredCards.length);
    const topN = scoredCards.slice(0, topCount);

    // 带权重随机（评分越高，选中概率越大）
    const totalWeight = topN.reduce(function (sum, item) {
      return sum + Math.max(1, item.score);
    }, 0);

    let rand = Math.random() * totalWeight;
    for (let i = 0; i < topN.length; i++) {
      rand -= Math.max(1, topN[i].score);
      if (rand <= 0) {
        return topN[i].card.id;
      }
    }

    return topN[0].card.id;
  }

  // ========== 卡牌评分函数 ==========

  function evaluateCard(card, playerState, gameState) {
    let score = CONFIG.BASE_SCORE[card.type] || 0;

    // ---- 1. 生存风险 ----
    // HP=1 时打出必定死亡，强烈避免
    if (card.hp <= 1) {
      score -= 80;
    }

    // ---- 2. 虎的饥饿管理 ----
    if (card.type === 'tiger') {
      const roundsSincePlayed = gameState.round - playerState.tigerLastPlayedRound;
      if (roundsSincePlayed >= 4) {
        score += 20 * (roundsSincePlayed - 3);
      }
    }

    // ---- 3. 猎人互斥风险评估 ----
    if (card.type === 'hunter') {
      // 检查其他存活玩家是否有猎人
      let otherHunterCount = 0;
      for (let i = 0; i < gameState.players.length; i++) {
        const p = gameState.players[i];
        if (p.id === playerState.id || p.eliminated) continue;
        const hasHunter = p.cards.some(function (c) { return c.type === 'hunter' && c.hp > 0; });
        if (hasHunter) otherHunterCount++;
      }
      // 场上有其他猎人在 → 打猎人可能触发互斥
      if (otherHunterCount >= 1) {
        score -= 30;
      }
      // 场上已有两只其他猎人的牌（含AI自己）→ 确定会互斥
      if (otherHunterCount >= 2) {
        score -= 40;
      }
    }

    // ---- 4. 二打一潜力评估 ----
    // 检查自己的这张牌是否能与同类型的牌形成二打一
    if (card.hp > 1) { // 只有活的牌才能参与二打一
      const sameTypeCount = playerState.cards.filter(function (c) {
        return c.type === card.type && c.hp > 0 && c.id !== card.id;
      }).length;

      // AI 自己的同类型牌数量
      const selfSameType = sameTypeCount + 1;

      if (selfSameType >= 2) {
        // 检查被克制方是否有高一级的牌可以攻击
        const chain = GameEngine.getChain(gameState.chainSwapped);
        const myRank = chain.indexOf(card.type);
        if (myRank > 0) {
          const predatorType = chain[myRank - 1];
          // 看看其他玩家是否有这个类型
          for (let i = 0; i < gameState.players.length; i++) {
            const p = gameState.players[i];
            if (p.id === playerState.id || p.eliminated) continue;
            const hasPredator = p.cards.some(function (c) { return c.type === predatorType && c.hp > 0; });
            if (hasPredator) {
              score += 40; // 二打一机会，高价值！
              break;
            }
          }
        }
      }
    }

    // ---- 5. 场上威胁评估 ----
    // 检查对方的高等级牌是否对自己的存活构成威胁
    const chain = GameEngine.getChain(gameState.chainSwapped);
    const myRank = chain.indexOf(card.type);
    let threatLevel = 0;

    for (let i = 0; i < gameState.players.length; i++) {
      const p = gameState.players[i];
      if (p.id === playerState.id || p.eliminated) continue;
      for (let ci = 0; ci < p.cards.length; ci++) {
        const oc = p.cards[ci];
        if (oc.hp <= 0) continue;
        const theirRank = chain.indexOf(oc.type);
        if (theirRank < myRank) {
          // 对方有能克制这张牌的牌
          threatLevel++;
        }
      }
    }

    // 如果场上有很多能克制这张牌的牌，降低出这张牌的意愿
    if (threatLevel >= 2) {
      score -= 15 * threatLevel;
    }

    // ---- 6. 低价值牌优先消耗 ----
    const tier = CONFIG.VALUE_TIER[card.type];
    if (tier === 'expendable') {
      score += 15; // 鼓励出低价值牌
    } else if (tier === 'precious') {
      score -= 5;  // 略微倾向保留高价值牌
    }

    // ---- 7. 随机扰动（让AI行为不那么死板） ----
    score += (Math.random() - 0.5) * 2 * CONFIG.RANDOM_JITTER;

    return score;
  }

  // ========== AI 玩家名称列表 ==========
  const AI_NAMES = ['阿尔法', '贝塔'];

  /**
   * 生成本局AI玩家配置
   * @param {number} count - AI玩家数量
   * @param {string} humanId - 真人玩家的ID
   * @returns {Array<{id: string, nickname: string}>}
   */
  function createAiPlayers(count, humanId) {
    const players = [];
    for (let i = 0; i < count; i++) {
      players.push({
        id: 'ai-player-' + (i + 1),
        nickname: AI_NAMES[i] || ('AI-' + (i + 1)),
      });
    }
    return players;
  }

  // ========== 导出 ==========
  window.AiPlayer = {
    decideCard: decideCard,
    createAiPlayers: createAiPlayers,
    AI_NAMES: AI_NAMES,
  };

})();
