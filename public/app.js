// ========== Socket.io 连接 ==========
const socket = io('https://survive-b44w.onrender.com');

// ========== 卡牌元数据 ==========
const CARD_META = {
  tiger:   { name: '虎',   emoji: '🐯', rank: 'Ⅰ' },
  hunter:  { name: '猎人', emoji: '🏹', rank: 'Ⅱ' },
  wolf:    { name: '狼',   emoji: '🐺', rank: 'Ⅲ' },
  sheep:   { name: '羊',   emoji: '🐑', rank: 'Ⅳ' },
  dog:     { name: '犬',   emoji: '🐕', rank: 'Ⅴ' },
  cat:     { name: '猫',   emoji: '🐱', rank: 'Ⅵ' },
  chicken: { name: '鸡',   emoji: '🐔', rank: 'Ⅶ' },
};

// ========== 全局状态 ==========
let myNickname = '';
let myPlayerId = null;

const gameState = {
  roomCode: null,
  myHand: [],
  selectedCardId: null,
  hasPlayed: false,
  round: 0,
  timerInterval: null,
  players: [],
};

// ========== DOM 引用 ==========
const pages = {
  home: document.getElementById('page-home'),
  create: document.getElementById('page-create'),
  join: document.getElementById('page-join'),
  lobby: document.getElementById('page-lobby'),
  game: document.getElementById('page-game'),
  ai: document.getElementById('page-ai'),
  gameOver: document.getElementById('page-game-over'),
};

const toastEl = document.getElementById('toast');
let toastTimer = null;

// ========== 工具函数 ==========
function showPage(pageId) {
  Object.values(pages).forEach((p) => p.classList.remove('active'));
  if (pages[pageId]) pages[pageId].classList.add('active');
}

function showToast(message, duration = 3000) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function getCardDisplay(type) {
  const meta = CARD_META[type];
  return meta ? `${meta.emoji} ${meta.name}` : type;
}

// ========== 页面导航 ==========
document.getElementById('btn-create').addEventListener('click', () => showPage('create'));
document.getElementById('btn-join').addEventListener('click', () => showPage('join'));

document.querySelectorAll('#btn-back-home, #btn-back-home2').forEach((btn) => {
  btn.addEventListener('click', () => showPage('home'));
});

document.getElementById('btn-back-to-home').addEventListener('click', () => {
  showPage('home');
});

// ========== 规则弹窗 ==========
const rulesModal = document.getElementById('rules-modal');
function openRules() { rulesModal.classList.add('active'); }
document.getElementById('btn-rules').addEventListener('click', openRules);
document.getElementById('btn-rules-home').addEventListener('click', openRules);
document.getElementById('modal-close').addEventListener('click', () => {
  rulesModal.classList.remove('active');
});
document.getElementById('modal-confirm').addEventListener('click', () => {
  rulesModal.classList.remove('active');
});
rulesModal.addEventListener('click', (e) => {
  if (e.target === rulesModal) rulesModal.classList.remove('active');
});

// ========== 创建房间 ==========
document.getElementById('btn-create-confirm').addEventListener('click', () => {
  const nickname = document.getElementById('input-nickname-create').value.trim();
  if (!nickname) {
    showToast('请输入昵称');
    return;
  }
  myNickname = nickname;
  socket.emit('create-room', { nickname });
});

// ========== 加入房间 ==========
document.getElementById('btn-join-confirm').addEventListener('click', () => {
  const roomCode = document.getElementById('input-room-code').value.trim().toUpperCase();
  const nickname = document.getElementById('input-nickname-join').value.trim();
  if (!roomCode || roomCode.length !== 6) {
    showToast('请输入正确的6位房间码');
    return;
  }
  if (!nickname) {
    showToast('请输入昵称');
    return;
  }
  myNickname = nickname;
  socket.emit('join-room', { roomCode, nickname });
});

// ========== 渲染函数 ==========

function renderPlayerListWithSelf(players, selfId) {
  const ul = document.getElementById('player-list-ul');
  document.getElementById('player-count').textContent = players.length;
  ul.innerHTML = players
    .map(
      (p) => `
      <li>
        <span class="avatar">${p.nickname[0]}</span>
        <span>${p.nickname}${p.id === selfId ? ' （你）' : ''}</span>
        ${p.id === selfId ? '<span class="host-badge">房主</span>' : ''}
      </li>
    `
    )
    .join('');
}

function renderOpponents() {
  const bar = document.getElementById('opponents-bar');
  bar.innerHTML = gameState.players
    .map((p) => {
      const isMe = p.id === myPlayerId;
      return `
        <div class="opponent-pad ${p.eliminated ? 'eliminated' : ''}" data-player-id="${p.id}">
          <div class="opp-name">${isMe ? '你' : p.nickname}</div>
          <div class="opp-status">
            ${p.eliminated ? '❌ 已淘汰' : `🃏 ${p.handSize}张`}
            <span class="played-mark">✓ 已出</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderHand() {
  const container = document.getElementById('hand-cards');
  if (gameState.myHand.length === 0) {
    container.innerHTML = '<div class="empty-hand">— 手牌已空 —</div>';
    document.getElementById('hand-count').textContent = '0';
    return;
  }

  container.innerHTML = gameState.myHand
    .map((card) => {
      const meta = CARD_META[card.type] || { name: card.type, emoji: '❓', rank: '' };
      const isSelected = gameState.selectedCardId === card.id;
      const isDisabled = gameState.hasPlayed;
      const isLowHp = card.hp <= 1;
      return `
        <div class="card card-${card.type} ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''} ${isLowHp ? 'low-hp' : ''}"
             data-card-id="${card.id}">
          <div class="card-rank">${meta.rank}</div>
          <div class="card-icon">${meta.emoji}</div>
          <div class="card-name">${meta.name}</div>
          <div class="card-hp">
            <span class="hp-heart">❤️</span>
            <span class="hp-value">${card.hp}/${card.maxHp}</span>
          </div>
        </div>
      `;
    })
    .join('');

  document.getElementById('hand-count').textContent = gameState.myHand.length;

  // 绑定点击事件
  if (!gameState.hasPlayed) {
    container.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('click', () => selectCard(el.dataset.cardId));
    });
  }
}

function selectCard(cardId) {
  if (gameState.hasPlayed) return;
  gameState.selectedCardId = cardId;
  renderHand();
  updatePlayButton();
}

function updatePlayButton() {
  const btn = document.getElementById('btn-play-card');
  if (gameState.hasPlayed) {
    btn.disabled = true;
    btn.textContent = '⏳ 等待其他玩家...';
  } else if (gameState.selectedCardId) {
    const card = gameState.myHand.find((c) => c.id === gameState.selectedCardId);
    if (card) {
      btn.disabled = false;
      btn.textContent = `⚔️ 出牌：${getCardDisplay(card.type)}`;
    }
  } else {
    btn.disabled = true;
    btn.textContent = '点击手牌选择一张出牌';
  }
}

function renderBattleResult(data) {
  const container = document.getElementById('battle-events');
  container.innerHTML = data.events
    .map((e) => {
      let icon = '';
      let text = e.description || '';
      let cls = 'battle-event';

      switch (e.type) {
        case 'play':
          icon = '🃏';
          cls += ' play';
          break;
        case 'attack':
          icon = '⚔️';
          cls += ' attack';
          break;
        case 'card_destroyed':
          icon = '💀';
          cls += ' destroyed';
          break;
        case 'tiger_clear':
          icon = '🐯';
          cls += ' special';
          break;
        case 'hunter_mutual':
          icon = '🏹';
          cls += ' special';
          break;
        case 'teamup':
          icon = '⚡';
          cls += ' special';
          break;
        case 'suicide':
          icon = '💥';
          cls += ' special';
          break;
        case 'chain_swapped':
          icon = '🔄';
          cls += ' important';
          break;
        case 'tiger_death':
          icon = '💔';
          cls += ' important';
          break;
        case 'eliminated':
          icon = '❌';
          cls += ' eliminated';
          break;
        case 'game_over':
          icon = '🏆';
          cls += ' important';
          break;
        default:
          cls += '';
      }

      return `<div class="${cls}"><span class="evt-icon">${icon}</span>${text}</div>`;
    })
    .join('');

  document.getElementById('battle-result').style.display = 'block';
  document.getElementById('waiting-overlay').classList.add('hidden');
  document.getElementById('hand-cards').innerHTML = '';
  document.getElementById('hand-count').textContent = '0';
}

function renderStandings(data) {
  const container = document.getElementById('standings');
  const sorted = [...data.standings].sort((a, b) => {
    if (a.id === data.winnerId) return -1;
    if (b.id === data.winnerId) return 1;
    return a.eliminated - b.eliminated;
  });

  container.innerHTML = sorted
    .map((p) => {
      const isWinner = p.id === data.winnerId;
      return `
        <div class="standing-row ${isWinner ? 'winner' : ''}">
          <span class="rank-icon">${isWinner ? '👑' : p.eliminated ? '❌' : '🎮'}</span>
          <span class="standing-name">${p.nickname}${p.id === myPlayerId ? ' (你)' : ''}</span>
          <span class="standing-status">${isWinner ? '🏆 胜者' : p.eliminated ? '淘汰' : `${p.handSize}张`}</span>
        </div>
      `;
    })
    .join('');
}

function startTimer() {
  let seconds = 30;
  const el = document.getElementById('timer-display');
  el.textContent = seconds;
  el.classList.remove('urgent');

  clearInterval(gameState.timerInterval);
  gameState.timerInterval = setInterval(() => {
    seconds--;
    el.textContent = seconds;
    if (seconds <= 5) el.classList.add('urgent');
    if (seconds <= 0) {
      clearInterval(gameState.timerInterval);
      el.textContent = '0';
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(gameState.timerInterval);
}

// ========== Socket.io 事件监听 ==========

// 房间创建成功
socket.on('room-created', (data) => {
  gameState.roomCode = data.roomCode;
  myPlayerId = socket.id;
  document.getElementById('display-room-code').textContent = data.roomCode;
  renderPlayerListWithSelf(data.players, socket.id);
  document.getElementById('room-status').style.display = 'none';
  showPage('lobby');
});

// 房间加入成功
socket.on('room-joined', (data) => {
  gameState.roomCode = data.roomCode;
  myPlayerId = socket.id;
  document.getElementById('display-room-code').textContent = data.roomCode;
  renderPlayerListWithSelf(data.players, socket.id);
  document.getElementById('room-status').style.display = 'none';
  showPage('lobby');
});

// 玩家列表更新
socket.on('players-update', (data) => {
  renderPlayerListWithSelf(data.players, socket.id);
});

// 房间已满
socket.on('room-full', (data) => {
  renderPlayerListWithSelf(data.players, socket.id);
  const statusEl = document.getElementById('room-status');
  statusEl.textContent = data.message;
  statusEl.className = 'status-message-box success';
});

// 有玩家离开
socket.on('player-left', (data) => {
  renderPlayerListWithSelf(data.players, socket.id);
  const statusEl = document.getElementById('room-status');
  statusEl.textContent = data.message;
  statusEl.style.display = 'block';
  statusEl.style.background = 'rgba(255, 193, 7, 0.08)';
  statusEl.style.border = '1px solid rgba(255, 193, 7, 0.2)';
  statusEl.style.color = '#d4a840';
});

// 游戏开始
socket.on('game-started', (data) => {
  gameState.players = data.players;
  myPlayerId = myPlayerId || socket.id;
  showPage('game');
  renderOpponents();
});

// 收到手牌
socket.on('your-hand', (data) => {
  gameState.myHand = data.cards;
  gameState.selectedCardId = null;
  gameState.hasPlayed = false;
  renderHand();
  updatePlayButton();
});

// 回合开始
socket.on('round-start', (data) => {
  gameState.round = data.round;
  document.getElementById('round-number').textContent = data.round;
  document.getElementById('battle-result').style.display = 'none';
  document.getElementById('waiting-overlay').classList.add('hidden');
  startTimer();
});

// 有玩家出牌
socket.on('card-selected', (data) => {
  const oppEl = document.querySelector(`[data-player-id="${data.playerId}"]`);
  if (oppEl) oppEl.classList.add('has-played');
  if (data.remaining !== undefined) {
    document.getElementById('waiting-count').textContent = `已出牌: ${3 - data.remaining}/3`;
  }
  if (data.playerId === myPlayerId) {
    gameState.hasPlayed = true;
    updatePlayButton();
  }
});

// 所有人已出牌
socket.on('all-played', () => {
  stopTimer();
  document.getElementById('waiting-overlay').classList.add('hidden');
});

// 回合结果
socket.on('round-result', (data) => {
  stopTimer();
  gameState.players = Object.entries(data.opponents).map(([id, info]) => ({
    id,
    nickname: info.nickname,
    handSize: info.handSize,
    eliminated: info.eliminated,
  }));
  renderOpponents();
  renderBattleResult(data);
});

// 游戏结束
socket.on('game-over', (data) => {
  stopTimer();
  document.getElementById('waiting-overlay').classList.add('hidden');

  if (data.winnerNickname) {
    document.getElementById('winner-announcement').textContent =
      data.winnerId === myPlayerId
        ? '🏆 你赢了！'
        : `🏆 ${data.winnerNickname} 获胜！`;
  } else {
    document.getElementById('winner-announcement').textContent = '🤝 平局！';
  }

  renderStandings(data);
  showPage('gameOver');
});

// 玩家断线
socket.on('player-forfeited', (data) => {
  showToast(`玩家 ${data.nickname} 已离开游戏`);
  const oppEl = document.querySelector(`[data-player-id="${data.playerId}"]`);
  if (oppEl) {
    oppEl.classList.add('eliminated');
    oppEl.querySelector('.opp-status').textContent = '❌ 已离开';
  }
});

// 出牌按钮
document.getElementById('btn-play-card').addEventListener('click', () => {
  if (!gameState.selectedCardId || gameState.hasPlayed) return;

  socket.emit('play-card', { cardId: gameState.selectedCardId });
  gameState.hasPlayed = true;
  updatePlayButton();

  // 显示等待遮罩
  document.getElementById('waiting-overlay').classList.remove('hidden');
  document.getElementById('waiting-count').textContent = '已出牌: 1/3';

  // 给自己标记已出牌
  const myOppEl = document.querySelector(`[data-player-id="${myPlayerId}"]`);
  if (myOppEl) myOppEl.classList.add('has-played');
});

// 错误处理
socket.on('error', (data) => {
  showToast(data.message);
});

// ========== 回车键快速操作 ==========
document.getElementById('input-nickname-create').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-create-confirm').click();
});
document.getElementById('input-nickname-join').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
});
document.getElementById('input-room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
});

// ================================================================
// 人机模式 · 本地游戏逻辑
// （不修改任何已有代码，完全隔离于联机模式）
// ================================================================

// 人机模式本地状态
const aiGameState = {
  initialized: false,
  game: null,         // GameEngine 的游戏状态
  myPlayerId: null,   // 真人玩家的 ID
  round: 0,
  hasPlayed: false,
  selectedCardId: null,
  timerInterval: null,
};

// ========== 人机模式页面导航 ==========
document.getElementById('btn-ai-mode').addEventListener('click', function () {
  // 如果已在其他 Socket 房间，先断开
  if (socket.connected) {
    socket.disconnect();
  }
  document.getElementById('input-nickname-ai').value = '';
  showPage('ai');
});

document.getElementById('btn-back-ai').addEventListener('click', function () {
  showPage('home');
});

// 人机模式回车
document.getElementById('input-nickname-ai').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') document.getElementById('btn-ai-confirm').click();
});

// ========== 开始人机对战 ==========
document.getElementById('btn-ai-confirm').addEventListener('click', function () {
  const nickname = document.getElementById('input-nickname-ai').value.trim();
  if (!nickname) {
    showToast('请输入昵称');
    return;
  }
  startAiMode(nickname);
});

// ========== 人机模式主入口 ==========
function startAiMode(nickname) {
  // 重置 GameEngine 的卡牌 ID 计数器
  GameEngine.resetCardIdCounter();

  // 构建三个玩家
  const humanId = 'human-player';
  const aiPlayers = AiPlayer.createAiPlayers(2, humanId);
  const allPlayers = [
    { id: humanId, nickname: nickname },
    { id: aiPlayers[0].id, nickname: aiPlayers[0].nickname },
    { id: aiPlayers[1].id, nickname: aiPlayers[1].nickname },
  ];

  // 初始化游戏状态
  const game = GameEngine.createGameState(allPlayers);
  aiGameState.game = game;
  aiGameState.myPlayerId = humanId;
  aiGameState.initialized = true;
  aiGameState.round = 0;
  aiGameState.selectedCardId = null;
  aiGameState.hasPlayed = false;

  // 设置全局 player ID，让 renderOpponents 能正确显示"你"
  myPlayerId = humanId;

  // 更新全局 gameState.players 以便渲染函数使用
  gameState.players = game.players.map(function (p) {
    return {
      id: p.id,
      nickname: p.nickname,
      handSize: p.cards.filter(function (c) { return c.hp > 0; }).length,
      eliminated: false,
    };
  });
  // 切换页面
  showPage('game');
  renderOpponents();

  // 启动第一回合
  startAiRound();
}

// ========== 人机模式回合循环 ==========
function startAiRound() {
  const game = aiGameState.game;
  if (!game) return;

  // 检查是否所有玩家已淘汰
  const alivePlayers = game.players.filter(function (p) { return !p.eliminated; });
  if (alivePlayers.length <= 1) {
    endAiGame(alivePlayers.length === 1 ? alivePlayers[0].id : null);
    return;
  }

  // 增加回合数
  game.round++;
  game.phase = 'select-card';
  game.playedCards = {};
  game.playersPlayed = [];
  aiGameState.round = game.round;
  aiGameState.hasPlayed = false;
  aiGameState.selectedCardId = null;

  // 同步到全局 gameState（selectCard 和 updatePlayButton 依赖它）
  gameState.hasPlayed = false;
  gameState.selectedCardId = null;

  // 更新 UI - 回合信息
  document.getElementById('round-number').textContent = game.round;

  // 隐藏战斗结果，显示等待遮罩
  document.getElementById('battle-result').style.display = 'none';
  document.getElementById('waiting-overlay').classList.add('hidden');

  // 更新对手信息
  updateAiOpponents();

  // 给真人玩家发手牌
  const humanPlayer = game.players.find(function (p) { return p.id === aiGameState.myPlayerId; });
  if (humanPlayer && !humanPlayer.eliminated) {
    const aliveCards = humanPlayer.cards.filter(function (c) { return c.hp > 0; });
    gameState.myHand = aliveCards.map(function (c) {
      return { id: c.id, type: c.type, hp: c.hp, maxHp: c.maxHp };
    });
    gameState.selectedCardId = null;
    gameState.hasPlayed = false;
    renderHand();
    updatePlayButton();
    startAiTimer();
  } else {
    // 真人玩家已被淘汰
    gameState.myHand = [];
    renderHand();
    updatePlayButton();
    // AI 继续自动进行
    autoResolveAiRound();
  }
}

// ========== AI 自动出牌（人类已被淘汰时） ==========
function autoResolveAiRound() {
  const game = aiGameState.game;
  // 让所有未出牌的 AI 出牌
  for (var i = 0; i < game.players.length; i++) {
    var p = game.players[i];
    if (p.eliminated) continue;
    if (game.playersPlayed.indexOf(p.id) !== -1) continue;

    var chosen = null;
    if (p.id === aiGameState.myPlayerId) {
      // 真人玩家：自动选第一张
      var alive = p.cards.filter(function (c) { return c.hp > 0; });
      if (alive.length > 0) chosen = alive[0];
    } else {
      chosen = selectAiCard(p.id, game);
    }

    if (chosen) {
      game.playedCards[p.id] = chosen.id;
      game.playersPlayed.push(p.id);
    }
  }

  // 检查是否所有人都已出牌
  if (game.playersPlayed.length >= game.players.filter(function (p) { return !p.eliminated; }).length) {
    resolveAiBattle();
  }
}

// ========== AI 选牌（返回卡牌对象） ==========
function selectAiCard(playerId, game) {
  var player = game.players.find(function (p) { return p.id === playerId; });
  if (!player || player.eliminated) return null;
  var cardId = AiPlayer.decideCard(player, game);
  if (!cardId) return null;
  // decideCard 返回的是卡牌 ID 字符串，需要找到卡牌对象
  return player.cards.find(function (c) { return c.id === cardId && c.hp > 0; });
}

// ========== 真人玩家出牌 ==========
// 覆盖原有的出牌按钮监听（通过事件委托区分模式）
document.getElementById('btn-play-card').addEventListener('click', function aiPlayHandler() {
  if (!aiGameState.initialized) return; // 联机模式不走这里
  if (aiGameState.hasPlayed) return;
  if (!gameState.selectedCardId) return;

  var game = aiGameState.game;
  var cardId = gameState.selectedCardId;
  var humanId = aiGameState.myPlayerId;

  // 记录出牌
  game.playedCards[humanId] = cardId;
  game.playersPlayed.push(humanId);
  aiGameState.hasPlayed = true;
  gameState.hasPlayed = true;

  // 标记已出牌
  var oppEl = document.querySelector('[data-player-id="' + humanId + '"]');
  if (oppEl) oppEl.classList.add('has-played');

  // 更新UI
  updatePlayButton();

  // 显示等待遮罩
  document.getElementById('waiting-overlay').classList.remove('hidden');
  document.getElementById('waiting-count').textContent = '已出牌: 1/3';

  // AI 玩家依次出牌（带延迟，模拟思考）
  var remaining = [];
  for (var ri = 0; ri < game.players.length; ri++) {
    var p = game.players[ri];
    if (p.id !== humanId && !p.eliminated) {
      remaining.push(p);
    }
  }
  var delay = 0;

  for (var i = 0; i < remaining.length; i++) {
    var aiPlayer = remaining[i];
    (function (aiP, d) {
      setTimeout(function () {
        if (game.playersPlayed.indexOf(aiP.id) !== -1) return;

        var chosen = selectAiCard(aiP.id, game);
        if (chosen) {
          game.playedCards[aiP.id] = chosen.id;
          game.playersPlayed.push(aiP.id);

          var aiEl = document.querySelector('[data-player-id="' + aiP.id + '"]');
          if (aiEl) aiEl.classList.add('has-played');

          var totalAlive = 0;
          for (var pj = 0; pj < game.players.length; pj++) {
            if (!game.players[pj].eliminated) totalAlive++;
          }
          document.getElementById('waiting-count').textContent = '已出牌: ' + game.playersPlayed.length + '/' + totalAlive;

          if (game.playersPlayed.length >= totalAlive) {
            stopAiTimer();
            document.getElementById('waiting-overlay').classList.add('hidden');
            resolveAiBattle();
          }
        }
      }, d);
    })(aiPlayer, delay);

    delay += 600 + Math.random() * 600;
  }
});

// ========== 战斗结算（人机模式） ==========
function resolveAiBattle() {
  var game = aiGameState.game;
  if (!game) return;

  game.phase = 'reveal';

  // 执行战斗结算
  var result = GameEngine.resolveRound(game);

  // 更新对手信息
  updateAiOpponents();

  // 渲染战斗结果
  renderBattleResult(result);

  // 更新手牌（从存活牌中更新）
  var humanId = aiGameState.myPlayerId;
  var humanPlayer = game.players.find(function (p) { return p.id === humanId; });
  if (humanPlayer && !humanPlayer.eliminated) {
    var aliveCards = humanPlayer.cards.filter(function (c) { return c.hp > 0; });
    gameState.myHand = aliveCards.map(function (c) {
      return { id: c.id, type: c.type, hp: c.hp, maxHp: c.maxHp };
    });
  } else {
    gameState.myHand = [];
  }

  // 检查游戏结束
  if (result.gameOver) {
    var winnerPlayer = result.winnerId
      ? game.players.find(function (p) { return p.id === result.winnerId; })
      : null;
    endAiGame(result.winnerId);
    return;
  }

  // 2 秒后下一回合
  setTimeout(function () {
    startAiRound();
  }, 2000);
}

// ========== 游戏结束（人机模式） ==========
function endAiGame(winnerId) {
  stopAiTimer();
  document.getElementById('waiting-overlay').classList.add('hidden');

  var game = aiGameState.game;
  var humanId = aiGameState.myPlayerId;
  var winnerPlayer = winnerId ? game.players.find(function (p) { return p.id === winnerId; }) : null;

  if (winnerPlayer) {
    document.getElementById('winner-announcement').textContent =
      winnerId === humanId
        ? '🏆 你赢了！'
        : '🏆 ' + winnerPlayer.nickname + ' 获胜！';
  } else {
    document.getElementById('winner-announcement').textContent = '🤝 平局！';
  }

  // 构建排行榜
  var standingsData = {
    winnerId: winnerId,
    standings: game.players.map(function (p) {
      return {
        id: p.id,
        nickname: p.nickname,
        eliminated: p.eliminated,
        handSize: p.cards.filter(function (c) { return c.hp > 0; }).length,
      };
    }),
  };

  renderStandings(standingsData);
  showPage('gameOver');

  // 清理状态
  aiGameState.initialized = false;
  aiGameState.game = null;
  myPlayerId = null; // 重置 player ID，避免干扰联机模式
}

// ========== 人机模式辅助函数 ==========

function updateAiOpponents() {
  var game = aiGameState.game;
  if (!game) return;

  gameState.players = game.players.map(function (p) {
    return {
      id: p.id,
      nickname: p.nickname,
      handSize: p.cards.filter(function (c) { return c.hp > 0; }).length,
      eliminated: p.eliminated,
    };
  });
  renderOpponents();
}

function startAiTimer() {
  var seconds = 30;
  var el = document.getElementById('timer-display');
  el.textContent = seconds;
  el.classList.remove('urgent');

  clearInterval(aiGameState.timerInterval);
  aiGameState.timerInterval = setInterval(function () {
    seconds--;
    el.textContent = seconds;
    if (seconds <= 5) el.classList.add('urgent');
    if (seconds <= 0) {
      clearInterval(aiGameState.timerInterval);
      // 超时自动出牌（真人玩家）
      if (aiGameState.initialized && !aiGameState.hasPlayed) {
        handleAiTimeout();
      }
    }
  }, 1000);
}

function stopAiTimer() {
  clearInterval(aiGameState.timerInterval);
}

function handleAiTimeout() {
  if (!aiGameState.initialized || aiGameState.hasPlayed) return;

  var game = aiGameState.game;
  var humanId = aiGameState.myPlayerId;

  // 自动选牌（按等级最高选）
  var humanPlayer = game.players.find(function (p) { return p.id === humanId; });
  if (humanPlayer) {
    var autoCard = GameEngine.autoPlayCard(game, humanId);
    if (autoCard) {
      gameState.selectedCardId = autoCard.id;
      // 触发自动出牌（aiPlayHandler 会从 gameState.selectedCardId 读取）
      document.getElementById('btn-play-card').click();
    }
  }
}

// 返回首页时清理人机模式
document.getElementById('btn-back-to-home').addEventListener('click', function () {
  if (aiGameState.initialized) {
    aiGameState.initialized = false;
    aiGameState.game = null;
    stopAiTimer();
    gameState.myHand = [];
    gameState.selectedCardId = null;
    gameState.players = [];
  }
  showPage('home');
});
